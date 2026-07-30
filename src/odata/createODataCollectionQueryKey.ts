import { odataBaseQueryKey } from "./odataBaseQueryKey";
import { ODataServiceCollectionConfig } from "./types";

/**
 * Версия формы persisted collection snapshot.
 *
 * Версия 2 отделяет прежние записи, порядок `separated` которых зависел от
 * первого consumer, от новой канонической сортировки по code.
 */
const ODATA_COLLECTION_QUERY_VERSION = 2;

export const createODataCollectionBaseQueryKey = () => [...odataBaseQueryKey, "collection"] as const;

export const createODataCollectionQueryKey = ({ service, target, limitedKeys, serverFilter }: ODataServiceCollectionConfig) =>
	[
		...createODataCollectionBaseQueryKey(),
		{ version: ODATA_COLLECTION_QUERY_VERSION, service, target, limitedKeys, serverFilter }
	] as const;
