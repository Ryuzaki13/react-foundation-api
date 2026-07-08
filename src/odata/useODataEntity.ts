import { useMemo } from "react";

import { buildEntityPath, type ODataServiceConfig, type ODataValue } from "@ryuzaki13/react-foundation-lib/odata-service";

import { useODataMetadata } from "./useODataMetadata";

import type { CollectionPair } from "@ryuzaki13/react-foundation-lib/odata";

const throwErrorText = "Использование actions недопустимо до окончания загрузки metadata";

// function throwNoMetadata() {
// 	if (__DEV__) {
// 		throw new Error(throwErrorText);
// 	}
// 	return undefined;
// }

export type ODataEntity = Omit<ReturnType<typeof useODataEntity>, "isLoading">;

export function useODataEntity(odata: ODataServiceConfig) {
	const { metadata, metadataUpdatedAt, isLoading } = useODataMetadata(odata);

	const actions = useMemo(() => {
		const getEntityPath = (values: Record<string, ODataValue> = {}) => {
			if (!metadata) throw new Error(throwErrorText);
			return buildEntityPath(metadata, odata, values);
		};
		const getKeys = () => {
			if (!metadata) throw new Error(throwErrorText);
			return metadata.columns?.map((c) => c.id);
		};
		const getKeyPairs = () => {
			if (!metadata) throw new Error(throwErrorText);
			return metadata.columns
				?.filter((c) => c.semanticType === "code" && c.linkedColumnId)
				.map((c) => ({ codeKey: c.id, textKey: c.linkedColumnId }) as CollectionPair);
		};
		const getKeyPairsMap = () => {
			if (!metadata) throw new Error(throwErrorText);
			const pairs: Record<string, string> = {};

			for (const column of metadata.columns ?? []) {
				if (column.semanticType === "code" && column.linkedColumnId) {
					pairs[column.id] = column.linkedColumnId;
				}
			}

			return pairs;
		};

		return {
			/**
			 * Получить строку запроса `/service/entity(parameters)/Results`
			 */
			getEntityPath,
			/**
			 * Получить все ключи сущности
			 */
			getKeys,
			/**
			 * Получить список ключей в формате `{ codeKey, textKey }`
			 */
			getKeyPairs,
			/**
			 * Получить словать ключей в формате `{ code: text }`
			 */
			getKeyPairsMap
		};
	}, [odata, metadata]);

	return { config: odata, metadata, metadataUpdatedAt, isLoading, actions };
}
