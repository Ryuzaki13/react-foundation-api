import { useEffect, useMemo, useState } from "react";

import { Query, useQueryClient } from "@tanstack/react-query";

import { createODataCollectionQueryKey } from "./createODataCollectionQueryKey";
import { ODataServiceCollectionConfig } from "./types";

import type { ODataChainsMap } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Используется для получения последовательностей кодов.
 */
export function useODataCollectionChains(params: ODataServiceCollectionConfig[]) {
	const queryClient = useQueryClient();
	const [chains, setChains] = useState<ODataChainsMap>({});

	const trackedKeys = useMemo(() => params.map((p) => createODataCollectionQueryKey(p)), [params]);

	useEffect(() => {
		function updateChains() {
			const newChains: ODataChainsMap = {};

			for (const p of params) {
				const key = createODataCollectionQueryKey(p);
				const cached = queryClient.getQueryData<{ chain: { codeKey: string; count: number }[] }>(key);
				if (cached?.chain) {
					newChains[`${p.service}.${p.target}`] = cached.chain;
				}
			}

			setChains((prev) => {
				// не обновлять стейт, если данные не изменились (во избежание лишних рендеров)
				const same =
					Object.keys(prev).length === Object.keys(newChains).length &&
					Object.entries(newChains).every(([k, v]) => prev[k] === v);
				return same ? prev : newChains;
			});
		}

		// Первичная загрузка (на случай, если данные уже в кэше)
		updateChains();

		// Подписка на изменения кэша
		const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			// Проверяем, затрагивает ли событие один из наших trackedKeys
			if (event?.query) {
				const query = event.query as Query;
				const isTracked = trackedKeys.some((key) => JSON.stringify(key) === JSON.stringify(query.queryKey));
				if (isTracked) {
					updateChains();
				}
			}
		});

		return unsubscribe;
	}, [params, queryClient, trackedKeys]);

	return chains;
}
