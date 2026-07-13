import { useODataMetadataQuery } from "./useODataMetadataQuery";

import type { ODataServiceConfig } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Возвращает metadata конкретной OData-сущности по имени сервиса и сущности.
 *
 * Хук не добавляет собственную бизнес-логику и служит публичной тонкой
 * прослойкой над `useODataMetadataQuery(...)`.
 */
export function useODataMetadata(odata: ODataServiceConfig) {
	const { data, dataUpdatedAt = 0, isLoading, isLoadingError } = useODataMetadataQuery({ service: odata.service });
	const metadata = data?.entities[odata.target];

	if (!isLoading && !metadata && data?.functionImports[odata.target]) {
		throw new Error(`OData target '${odata.target}' является FunctionImport и не может использоваться как сущность`);
	}

	if (isLoadingError) {
		throw new Error(`Ошибка загрузки метаданных сервиса ${odata.service}`);
	}

	return { metadata, metadataUpdatedAt: dataUpdatedAt, isLoading };
}
