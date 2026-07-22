import { parseDate } from "@ryuzaki13/react-foundation-lib/formatters";
import { persistedQueryMeta } from "@ryuzaki13/react-foundation-lib/query-client";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { odataBaseQueryKey } from "./odataBaseQueryKey";
import { odataFetch } from "./odataFetch";
import { getODataProjectAdapter, resolveODataBaseUrl } from "./odataProjectAdapter";

const COLLECTION_UPDATES_BUILD_ID = __APP_BUILD_ID__;
const COLLECTION_UPDATES_STALE_TIME = 1000 * 60 * 60 * 4;
export const ODATA_COLLECTION_UPDATES_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 7;
export const ODATA_COLLECTION_DEFAULT_SW_CACHE = "ttl=forever;name=ref";
export const ODATA_COLLECTION_BUST_SW_CACHE = "bust=forever;name=ref";
export const ODATA_COLLECTION_UPDATES_SW_CACHE = "ttl=4h;name=ref-updates";

interface ODataCollectionUpdateRecord {
	entityName: string;
	lastChanged: string;
}

export interface ODataCollectionUpdateItem extends ODataCollectionUpdateRecord {
	lastChangedAt: Date | null;
}

export interface ODataCollectionUpdatesResult {
	items: ODataCollectionUpdateItem[];
	byEntityName: Record<string, ODataCollectionUpdateItem>;
	fetchedAt: number;
	coverageStartedAt: number;
}

export interface ODataCollectionUpdatesOptions {
	staleTime?: number;
}

export const createODataCollectionUpdatesQueryKey = () =>
	[...odataBaseQueryKey, "collection-updates", { buildId: COLLECTION_UPDATES_BUILD_ID }] as const;

function normalizeCollectionUpdateRecord(record: ODataCollectionUpdateRecord): ODataCollectionUpdateItem {
	return {
		...record,
		lastChangedAt: parseDate(record.lastChanged)
	};
}

function normalizeCollectionUpdates(records: ODataCollectionUpdateRecord[], fetchedAt: number): ODataCollectionUpdatesResult {
	const items = records.map(normalizeCollectionUpdateRecord);
	const byEntityName = items.reduce<Record<string, ODataCollectionUpdateItem>>((acc, item) => {
		if (item.entityName) {
			acc[item.entityName] = item;
		}

		return acc;
	}, {});

	return { items, byEntityName, fetchedAt, coverageStartedAt: fetchedAt - ODATA_COLLECTION_UPDATES_LOOKBACK_MS };
}

/**
 * Загружает компактный список справочников, изменённых за последние 7 дней.
 * Сам список живёт отдельно от данных справочников и управляет их точечной инвалидацией.
 */
export function fetchODataCollectionUpdates() {
	return async ({ signal }: { signal: AbortSignal }): Promise<ODataCollectionUpdatesResult> => {
		const requestStartedAt = Date.now();
		const endpoint = getODataProjectAdapter().collectionUpdates;
		if (!endpoint) return normalizeCollectionUpdates([], requestStartedAt);

		const response = await odataFetch<ODataCollectionUpdateRecord, ODataCollectionUpdateRecord[]>(
			`/${endpoint.service}/${endpoint.target}`,
			{
				baseUrl: resolveODataBaseUrl(endpoint.service, endpoint.baseUrl),
				swCache: ODATA_COLLECTION_UPDATES_SW_CACHE
			},
			{ signal }
		);

		return normalizeCollectionUpdates(response.data, Math.max(requestStartedAt, Date.now()));
	};
}

/**
 * Описывает общий TanStack Query со списком обновлённых справочников.
 * Query сохраняется в IndexedDB и дополнительно кешируется Service Worker на короткий TTL.
 *
 * При отсутствии endpoint queryFn возвращает пустой успешный результат без сетевого запроса.
 * Query должен оставаться активным, потому что зависимые справочники ждут его завершения.
 */
export const odataCollectionUpdatesQueryOptions = (options: ODataCollectionUpdatesOptions = {}) =>
	queryOptions({
		queryKey: createODataCollectionUpdatesQueryKey(),
		queryFn: fetchODataCollectionUpdates(),
		meta: persistedQueryMeta,
		staleTime: options.staleTime ?? COLLECTION_UPDATES_STALE_TIME,
		gcTime: Infinity
	});

export function useODataCollectionUpdatesQuery(options: ODataCollectionUpdatesOptions = {}) {
	return useQuery(odataCollectionUpdatesQueryOptions(options));
}
