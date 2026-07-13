import { useEffect, useMemo } from "react";

import { parseServiceMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";
import { persistedQueryMeta } from "@ryuzaki13/react-foundation-lib/query-client";
import { QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	invalidateODataMetadataQueries,
	ODataMetadataVersionOptions,
	odataMetadataVersionQueryOptions,
	ODataMetadataVersionResult,
	shouldRefreshODataMetadataByVersion
} from "./metadataVersionCheck";
import { odataBaseQueryKey } from "./odataBaseQueryKey";
import { BaseURLType, fetchQueryFn, resolveODataBaseUrl } from "./transport";

import type { ODataServiceConfig } from "@ryuzaki13/react-foundation-lib/odata-service";

type ODataMetadataOptions = Pick<ODataServiceConfig, "service"> & { baseUrl?: BaseURLType };

export function fetchMetadata(options: ODataMetadataOptions) {
	return fetchQueryFn(`/${options.service}/$metadata`, {
		baseUrl: resolveODataBaseUrl(options.service, options.baseUrl),
		init: {
			headers: {
				Accept: "*/*",
				"Content-Type": "application/xml"
			}
		},
		transform: async (data) => {
			try {
				return parseServiceMetadata(await data.text());
			} catch (error) {
				throw new Error(`Сервис ${options.service} содержит необработанную ошибку: ${String(error)}`);
			}
		}
	});
}

export const odataMetadataQueryOptions = (options: ODataMetadataOptions) => {
	const resolvedOptions = {
		service: options.service,
		baseUrl: resolveODataBaseUrl(options.service, options.baseUrl)
	};

	return queryOptions({
		queryKey: [...odataBaseQueryKey, "metadata", resolvedOptions],
		queryFn: fetchMetadata(resolvedOptions),
		meta: persistedQueryMeta,
		enabled: Boolean(options.service),
		/**
		 * Метаданные хранятся без временного протухания.
		 * Актуальность контролируется отдельным version-check query по времени генерации сервиса.
		 */
		staleTime: Infinity,
		gcTime: Infinity
	});
};

/**
 * Применяет результат version-check к metadata query на уровне общего QueryClient.
 * Metadata refetch нужен только если серверная версия новее времени обновления metadata cache.
 */
export async function applyODataMetadataVersion(
	queryClient: QueryClient,
	options: ODataMetadataOptions,
	version: ODataMetadataVersionResult
) {
	if (!options.service) return;

	const metadataQueryKey = odataMetadataQueryOptions(options).queryKey;
	const metadataState = queryClient.getQueryState(metadataQueryKey);
	const shouldRefresh = shouldRefreshODataMetadataByVersion(metadataState, version);

	if (shouldRefresh) {
		await invalidateODataMetadataQueries(queryClient, options.service);
	}
}

export function useODataMetadataQuery(options: ODataMetadataOptions) {
	const queryClient = useQueryClient();
	const metadataOptions = useMemo(() => ({ service: options.service, baseUrl: options.baseUrl }), [options.baseUrl, options.service]);
	const versionOptions = useMemo(() => ({ service: options.service }), [options.service]);
	const versionQuery = useQuery(odataMetadataVersionQueryOptions(versionOptions));
	const metadataQuery = useQuery(odataMetadataQueryOptions(metadataOptions));

	useEffect(() => {
		if (!options.service || !versionQuery.isSuccess) return;

		applyODataMetadataVersion(queryClient, metadataOptions, versionQuery.data);
	}, [metadataOptions, metadataQuery.dataUpdatedAt, options.service, queryClient, versionQuery.data, versionQuery.isSuccess]);

	return metadataQuery;
}

/**
 * Публичный доступ к результату version-check без загрузки самих metadata.
 * Полезно для глобальной диагностики и ручного управления частотой опроса.
 */
export function useODataMetadataVersionQuery(options: ODataMetadataVersionOptions) {
	return useQuery(odataMetadataVersionQueryOptions(options));
}

async function syncODataMetadataVersion(options: ODataMetadataOptions, queryClient: QueryClient) {
	const versionOptions = { service: options.service };

	try {
		const nextVersion = await queryClient.fetchQuery(odataMetadataVersionQueryOptions(versionOptions));
		await applyODataMetadataVersion(queryClient, options, nextVersion);
	} catch {
		// NOTE: Пока держим за правило:
		// Если технический version-check временно недоступен,
		// сохранённые metadata остаются рабочим источником для OData-запросов.
	}
}

export async function getODataMetadataData(options: ODataMetadataOptions, queryClient: QueryClient) {
	if (!options.service) return undefined;
	await queryClient.fetchQuery(odataMetadataQueryOptions(options));
	await syncODataMetadataVersion(options, queryClient);
	return queryClient.fetchQuery(odataMetadataQueryOptions(options));
}
