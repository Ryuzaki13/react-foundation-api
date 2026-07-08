import { odataBaseQueryKey } from "./odataBaseQueryKey";
import { ODataServiceCollectionConfig } from "./types";

export const createODataCollectionBaseQueryKey = () => [...odataBaseQueryKey, "collection"] as const;

export const createODataCollectionQueryKey = ({ service, target, limitedKeys, serverFilter }: ODataServiceCollectionConfig) =>
	[...createODataCollectionBaseQueryKey(), { service, target, limitedKeys, serverFilter }] as const;
