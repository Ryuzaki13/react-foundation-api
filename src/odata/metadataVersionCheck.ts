import { formatDateAsODataDatetime, parseDate } from "@ryuzaki13/react-foundation-lib/formatters";
import { persistedQueryMeta } from "@ryuzaki13/react-foundation-lib/query-client";
import { QueryClient, queryOptions, QueryState } from "@tanstack/react-query";

import { odataBaseQueryKey } from "./odataBaseQueryKey";
import { odataFetch } from "./odataFetch";
import { getODataProjectAdapter, normalizeODataServiceName, resolveODataBaseUrl } from "./odataProjectAdapter";

import type { ODataServiceConfig } from "@ryuzaki13/react-foundation-lib/odata-service";

const METADATA_VERSION_BUILD_ID = __APP_BUILD_ID__;
const METADATA_VERSION_STALE_TIME = 1000 * 60 * 60 * 24;

export interface ODataMetadataVersionOptions extends Pick<ODataServiceConfig, "service"> {
	staleTime?: number;
}

interface ODataMetadataVersionRecord {
	serviceName: string;
	lastChanged: string;
}

export interface ODataMetadataVersionResult {
	service: string;
	changedAt: Date | null;
	version: string | null;
}

function selectMetadataVersionRecord(records: ODataMetadataVersionRecord[] | ODataMetadataVersionRecord | undefined) {
	if (!records) return undefined;
	return Array.isArray(records) ? records[0] : records;
}

export const createODataMetadataVersionQueryKey = ({ service }: Pick<ODataServiceConfig, "service">) =>
	[...odataBaseQueryKey, "metadata-version", { service, buildId: METADATA_VERSION_BUILD_ID }] as const;

function createEmptyMetadataVersionResult(service: string): ODataMetadataVersionResult {
	return {
		service,
		changedAt: null,
		version: null
	};
}

/**
 * Загружает время последней генерации OData-сервиса из технического CDS.
 * Эти данные не заменяют metadata, а служат версией для точечной инвалидации metadata query.
 */
export function fetchMetadataVersion(options: Pick<ODataServiceConfig, "service">) {
	return async ({ signal }: { signal: AbortSignal }): Promise<ODataMetadataVersionResult> => {
		const endpoint = getODataProjectAdapter().metadataVersion;
		if (!endpoint) return createEmptyMetadataVersionResult(options.service);

		const response = await odataFetch<ODataMetadataVersionRecord, ODataMetadataVersionRecord[]>(
			`/${endpoint.service}/${endpoint.target}('${normalizeODataServiceName(options.service)}')`,
			{
				baseUrl: resolveODataBaseUrl(endpoint.service, endpoint.baseUrl)
			},
			{ signal }
		);

		const record = selectMetadataVersionRecord(response.data);
		const changedAt = parseDate(record?.lastChanged);

		return {
			service: options.service,
			changedAt,
			version: changedAt ? formatDateAsODataDatetime(changedAt) : null
		};
	};
}

/**
 * Описывает отдельный TanStack Query для версии metadata.
 * Query хранится отдельно от самих metadata, чтобы частоту проверки можно было регулировать независимо.
 */
export const odataMetadataVersionQueryOptions = (options: ODataMetadataVersionOptions) =>
	queryOptions({
		queryKey: createODataMetadataVersionQueryKey(options),
		queryFn: fetchMetadataVersion(options),
		meta: persistedQueryMeta,
		enabled: Boolean(options.service && getODataProjectAdapter().metadataVersion),
		staleTime: options.staleTime ?? METADATA_VERSION_STALE_TIME,
		gcTime: Infinity
	});

/**
 * Инвалидирует только metadata query указанного сервиса.
 * Version-check query и metadata других сервисов при этом остаются нетронутыми.
 * Повторная инвалидация не отменяет уже запущенный refetch: один сервис может
 * одновременно использоваться несколькими hooks, а результат version-check у них общий.
 */
export function invalidateODataMetadataQueries(queryClient: QueryClient, service: string) {
	return queryClient.invalidateQueries(
		{
			predicate: (query) => {
				const [baseKey, queryType, queryOptionsValue] = query.queryKey;
				if (baseKey !== odataBaseQueryKey[0] || queryType !== "metadata") return false;
				if (!queryOptionsValue || typeof queryOptionsValue !== "object") return false;

				return "service" in queryOptionsValue && queryOptionsValue.service === service;
			}
		},
		{ cancelRefetch: false }
	);
}

export function shouldRefreshODataMetadataByVersion(
	metadataState: QueryState<unknown, Error> | undefined,
	version: ODataMetadataVersionResult
) {
	if (metadataState?.data === undefined) return false;
	if (!version.changedAt) return false;
	return version.changedAt.getTime() > metadataState.dataUpdatedAt;
}
