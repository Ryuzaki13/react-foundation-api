import { type ServiceMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";
import { CancelledError, QueryObserver, type QueryClient, type QueryKey } from "@tanstack/react-query";

import { fetchMetadata, odataMetadataQueryOptions, type ODataMetadataOptions } from "./useODataMetadataQuery";

const metadataRefreshes = new WeakMap<QueryClient, Map<string, Promise<ServiceMetadata>>>();

/**
 * Предшествующее чтение могло использовать HTTP cache или восстанавливать IndexedDB.
 * Его завершение освобождает canonical query для отдельного network reload.
 */
async function waitForMetadataRequest(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
	const query = queryClient.getQueryCache().find({ queryKey, exact: true });
	if (!query || query.state.fetchStatus === "idle" || !query.promise) return;

	try {
		await query.promise;
	} catch {
		// Ошибка предыдущего чтения уже принадлежит его Query lifecycle.
		// Recovery всё равно выполняет собственную единственную network-попытку.
	}
}

async function fetchFreshMetadata(options: ODataMetadataOptions, queryClient: QueryClient): Promise<ServiceMetadata> {
	const canonicalOptions = odataMetadataQueryOptions(options);
	const fetchFresh = fetchMetadata({ ...options, cache: "reload" });
	const fetchState: { request?: { signal: AbortSignal; result: Promise<ServiceMetadata> } } = {};
	const queryFn = ({ signal }: { signal: AbortSignal }) => {
		fetchState.request = { signal, result: fetchFresh({ signal }) };
		return fetchState.request.result;
	};

	// Первый fetch может восстановить persisted snapshot; второй обязан вызвать
	// network request. Посторонний persister или сброс Query не создаёт вечный цикл.
	for (let attempt = 0; attempt < 2 && !fetchState.request; attempt += 1) {
		await waitForMetadataRequest(queryClient, canonicalOptions.queryKey);
		if (fetchState.request) break;

		const query = queryClient.getQueryCache().build(queryClient, queryClient.defaultQueryOptions(canonicalOptions));
		const previousOptions = query.options;
		const previousState = query.state;
		let invalidatedDuringRefresh = false;
		const stopTrackingInvalidation = queryClient.getQueryCache().subscribe((event) => {
			if (event.type === "updated" && event.query === query && event.action.type === "invalidate") {
				invalidatedDuringRefresh = true;
			}
		});
		const recoveryObserver = new QueryObserver(queryClient, { ...previousOptions, queryKey: query.queryKey, enabled: false });

		// Recovery принадлежит общему QueryClient: уход последнего UI-подписчика
		// не отменяет попытку. Явный cancelQueries по-прежнему прерывает transport.
		const stopObserving = recoveryObserver.subscribe(() => {});

		try {
			// Прямой Query.fetch обновляет snapshot независимо от dataUpdatedAt без invalidation.
			// Ошибка recovery не делает прежний свежий кеш stale для mount/focus/reconnect.
			await query.fetch(queryClient.defaultQueryOptions({ ...canonicalOptions, queryFn, retry: false }));
		} catch (error) {
			// TanStack помечает background error как invalidation. У ограниченной
			// recovery-попытки сохраняем прежнюю свежесть, не стирая чужую invalidation,
			// новые data или саму ошибку запроса.
			if (
				previousState.data !== undefined &&
				!previousState.isInvalidated &&
				!invalidatedDuringRefresh &&
				query.state.data === previousState.data &&
				query.state.dataUpdateCount === previousState.dataUpdateCount &&
				query.state.error === error &&
				query.state.fetchStatus === "idle"
			) {
				query.setState({ isInvalidated: false });
			}

			throw error;
		} finally {
			stopTrackingInvalidation();
			stopObserving();

			const currentQuery = queryClient
				.getQueryCache()
				.get<ServiceMetadata, Error, ServiceMetadata, typeof query.queryKey>(query.queryHash);

			// Observer может сменить options во время запроса. Возвращаем только свои
			// временные overrides, сохраняя более новое решение внешнего владельца.
			if (currentQuery === query && query.options.queryFn === queryFn) {
				query.setOptions(previousOptions);
			}
		}
	}

	if (!fetchState.request) {
		throw new Error(`Не удалось выполнить принудительное чтение metadata сервиса ${options.service}`);
	}

	// Query может вернуть прежние data после cancelQueries({ revert: true }).
	// Для forced refresh отмена не является успешным network-результатом.
	if (fetchState.request.signal.aborted) throw new CancelledError({ revert: true });

	return fetchState.request.result;
}

/**
 * Принудительно перечитывает metadata одного сервиса с HTTP cache: "reload".
 *
 * Обновляет существующий Query snapshot, поэтому сохраняются persistence,
 * broadcast и доступ к прежним data при ошибке. Одновременные вызовы одного
 * QueryClient разделяют попытку; автоматические повторы и выбор recovery-причины
 * остаются у вызывающего сценария. Пустой service не создаёт запрос.
 */
export function refreshODataMetadataData(options: ODataMetadataOptions, queryClient: QueryClient): Promise<ServiceMetadata | undefined> {
	if (!options.service) return Promise.resolve(undefined);

	const canonicalOptions = queryClient.defaultQueryOptions(odataMetadataQueryOptions(options));
	let refreshes = metadataRefreshes.get(queryClient);
	if (!refreshes) {
		refreshes = new Map();
		metadataRefreshes.set(queryClient, refreshes);
	}

	const pending = refreshes.get(canonicalOptions.queryHash);
	if (pending) return pending;

	const refresh = fetchFreshMetadata(options, queryClient).finally(() => {
		refreshes.delete(canonicalOptions.queryHash);
	});
	refreshes.set(canonicalOptions.queryHash, refresh);

	return refresh;
}
