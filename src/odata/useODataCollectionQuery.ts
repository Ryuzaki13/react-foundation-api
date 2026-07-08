import { useEffect, useMemo } from "react";

import { buildSeparatedArrays, type CollectionItem, type CollectionPair } from "@ryuzaki13/react-foundation-lib/odata";
import { persistedQueryMeta } from "@ryuzaki13/react-foundation-lib/query-client";
import { useQuery, useQueryClient, UseQueryResult } from "@tanstack/react-query";

import { createODataCollectionQueryKey } from "./createODataCollectionQueryKey";
import { fetchCollectionData } from "./fetchCollectionData";
import { ODataCollectionConfig } from "./types";
import {
	ODATA_COLLECTION_BUST_SW_CACHE,
	ODATA_COLLECTION_DEFAULT_SW_CACHE,
	ODataCollectionUpdateItem,
	useODataCollectionUpdatesQuery
} from "./useODataCollectionUpdatesQuery";
import { useODataEntity } from "./useODataEntity";

export interface ODataCollectionResult<T extends CollectionItem> {
	items: T[];
	keyPairs: CollectionPair[];
	keyPairsMap: Record<string, string>;
	separated: Record<string, T[]>;
	chain: { codeKey: string; count: number }[];
	count: number;
	cacheUpdatedAt: number;
}

interface ODataCollectionCacheRefreshContext {
	update?: ODataCollectionUpdateItem;
	metadataUpdatedAt?: number;
	updatesCoverageStartedAt?: number;
}

export function resolveODataCollectionSwCachePolicy(swCache: string, shouldBust: boolean) {
	if (!shouldBust) return swCache;

	const normalized = swCache.trim().toLowerCase();
	if (normalized === "off" || normalized.startsWith("bust=")) return swCache;
	if (normalized.startsWith("ttl=")) return swCache.replace(/^\s*ttl=/i, "bust=");

	return ODATA_COLLECTION_BUST_SW_CACHE;
}

function isUsableTimestamp(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Определяет, нужно ли обновить конкретный справочник по списку изменений.
 * Сравнение идёт с cacheUpdatedAt, который сохраняется вместе с данными справочника.
 */
export function shouldRefreshODataCollectionCache<T extends CollectionItem>(
	context: ODataCollectionCacheRefreshContext,
	cachedData: ODataCollectionResult<T> | undefined
) {
	const cacheUpdatedAt = cachedData?.cacheUpdatedAt ?? 0;
	const updateChangedAt = context.update?.lastChangedAt?.getTime();

	if (isUsableTimestamp(updateChangedAt)) {
		if (!cachedData || !cacheUpdatedAt) return true;
		if (updateChangedAt > cacheUpdatedAt) return true;
	}

	if (isUsableTimestamp(context.metadataUpdatedAt)) {
		if (!cachedData || !cacheUpdatedAt) return true;
		if (context.metadataUpdatedAt > cacheUpdatedAt) return true;
	}

	/**
	 * Бэкенд отдаёт список изменений справочников только за последнюю неделю.
	 * Если локальный справочник старше этого окна, отсутствие target в списке
	 * больше не доказывает актуальность, поэтому обновляем только открытый справочник.
	 */
	if (isUsableTimestamp(context.updatesCoverageStartedAt)) {
		if (!cachedData || !cacheUpdatedAt) return true;
		if (cacheUpdatedAt < context.updatesCoverageStartedAt) return true;
	}

	return false;
}

/**
 * Универсальный хук для получения данных из OData сервиса.
 * Заменяет функционал TextDataService из SAP UI5.
 */
export function useODataCollectionQuery<T extends CollectionItem>(odata: ODataCollectionConfig): UseQueryResult<ODataCollectionResult<T>> {
	const {
		service,
		target,
		limitedKeys,
		excludeEmpty,
		sortByCode,
		serverFilter,
		clientFilter,
		swCache = ODATA_COLLECTION_DEFAULT_SW_CACHE
	} = odata;
	const queryClient = useQueryClient();
	const { actions, metadata, metadataUpdatedAt, isLoading } = useODataEntity(odata);
	const updatesQuery = useODataCollectionUpdatesQuery();

	const queryKey = useMemo(
		() => createODataCollectionQueryKey({ service, target, limitedKeys, serverFilter }),
		[service, target, limitedKeys, serverFilter]
	);
	const cachedData = queryClient.getQueryData<ODataCollectionResult<T>>(queryKey);
	const collectionUpdate = updatesQuery.data?.byEntityName[target];
	const shouldBustCollectionCache = shouldRefreshODataCollectionCache(
		{
			update: collectionUpdate,
			metadataUpdatedAt,
			updatesCoverageStartedAt: updatesQuery.data?.coverageStartedAt
		},
		cachedData
	);
	const effectiveSwCache = resolveODataCollectionSwCachePolicy(swCache, shouldBustCollectionCache);
	const updatesReady = updatesQuery.isError || (updatesQuery.isSuccess && !updatesQuery.isFetching);

	useEffect(() => {
		if (!cachedData || !shouldBustCollectionCache) return;

		void queryClient.invalidateQueries({ queryKey });
	}, [cachedData, queryClient, queryKey, shouldBustCollectionCache]);

	return useQuery({
		queryKey,
		queryFn: async ({ signal }) => {
			const requestStartedAt = Date.now();
			const selectKeys = limitedKeys ? [...limitedKeys] : actions.getKeys();
			const keyPairs = actions.getKeyPairs();
			const keyPairsMap = actions.getKeyPairsMap();

			if (limitedKeys) {
				for (const k of limitedKeys) {
					const keyText = keyPairsMap[k];
					if (keyText && !selectKeys.includes(keyText)) {
						selectKeys.push(keyText);
					}
				}
			}

			const { items } = await fetchCollectionData<T>({
				url: `/${service}/${target}`,
				query: {
					select: selectKeys,
					expression: serverFilter,
					swCache: effectiveSwCache
				},
				signal
			});

			let filterdItems = items;
			if (clientFilter) {
				filterdItems = items.filter(clientFilter);
			}

			const separated = buildSeparatedArrays<T>(filterdItems, keyPairs, excludeEmpty, sortByCode);

			// Рассчитать порядок от меньшего к большему
			const chain = keyPairs
				.map((pair) => ({ codeKey: pair.codeKey, count: separated[pair.codeKey].length }))
				.sort((a, b) => a.count - b.count);

			return {
				items: filterdItems,
				keyPairs,
				keyPairsMap,
				separated,
				chain,
				count: filterdItems.length,
				cacheUpdatedAt: Math.max(requestStartedAt, Date.now(), collectionUpdate?.lastChangedAt?.getTime() ?? 0, metadataUpdatedAt)
			};
		},
		enabled: Boolean(!isLoading && metadata && service && target && updatesReady),
		meta: persistedQueryMeta,
		/**
		 * Клиентский кеш можно держать не долго, чтобы он мог чаще дергать SW
		 */
		staleTime: 1000 * 60 * 60 * 2,
		/**
		 * Если справочник не используется более часа, то можно из памяти выгрузить.
		 */
		gcTime: 1000 * 60 * 60 * 1
	});
}
