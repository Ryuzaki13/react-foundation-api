import { useMemo } from "react";

import {
	type TableColumnDef,
	type TableColumnFormattingMetaInput,
	createTableColumnVisibilityFromODataMetadata,
	createTableColumnsFromODataMetadata,
	enrichTableColumnsWithODataFormatting,
	resolveStableColumnId
} from "@ryuzaki13/react-foundation-lib/table";

import { useODataMetadata } from "./useODataMetadata";

import type { EntityColumnProperty, EntityMetadata, ODataServiceConfig } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Собирает visibility-state только для тех leaf-колонок, которые сопоставились с metadata.
 */
function collectMatchedColumnVisibility<TData extends object>(
	columns: readonly TableColumnDef<TData>[],
	visibilityById: Readonly<Record<string, boolean>>
): Record<string, boolean> {
	const matchedVisibility: Record<string, boolean> = {};

	const visitLeafColumns = (nestedColumns: readonly TableColumnDef<TData>[]) => {
		for (const column of nestedColumns) {
			if ("columns" in column && Array.isArray(column.columns) && column.columns.length > 0) {
				visitLeafColumns(column.columns as TableColumnDef<TData>[]);
				continue;
			}

			const columnId = resolveStableColumnId(column);
			if (!columnId || !(columnId in visibilityById)) {
				continue;
			}

			matchedVisibility[columnId] = visibilityById[columnId];
		}
	};

	visitLeafColumns(columns);

	return matchedVisibility;
}

/**
 * Конфиг hook-адаптера колонок в режиме `build`.
 */
export interface UseODataTableColumnsBuildConfig extends Pick<ODataServiceConfig, "service" | "target"> {
	/**
	 * Режим генерации колонок только по metadata.
	 */
	mode: "build";
	/**
	 * Позволяет определить видимость колонки при генерации.
	 */
	resolveVisible?: (column: EntityColumnProperty) => boolean;
	/**
	 * Позволяет переопределить заголовок колонки при генерации.
	 */
	resolveHeader?: (column: EntityColumnProperty) => string;
	/**
	 * Позволяет сразу навесить formatting-конфиг на generated column.
	 */
	resolveFormatting?: (column: EntityColumnProperty) => TableColumnFormattingMetaInput | undefined;
}

/**
 * Конфиг hook-адаптера колонок в режиме `enrich`.
 */
export interface UseODataTableColumnsEnrichConfig<TData extends object> extends Pick<ODataServiceConfig, "service" | "target"> {
	/**
	 * Режим обогащения уже существующих колонок.
	 */
	mode: "enrich";
	/**
	 * Существующий набор колонок для дозаполнения `meta.formatting.role/type`.
	 */
	columns: readonly TableColumnDef<TData>[];
}

/**
 * Универсальный конфиг hook-адаптера колонок.
 */
export type UseODataTableColumnsConfig<TData extends object = Record<string, unknown>> =
	UseODataTableColumnsBuildConfig | UseODataTableColumnsEnrichConfig<TData>;

/**
 * Результат работы hook-адаптера колонок.
 */
export interface UseODataTableColumnsResult<TData extends object> {
	/**
	 * Итоговый набор колонок для `Table` или `TreeTable`.
	 */
	columns: TableColumnDef<TData>[];
	/**
	 * Стартовая карта видимости колонок для TanStack Table.
	 */
	defaultColumnVisibility: Record<string, boolean> | undefined;
	/**
	 * Метаданные сущности, если они уже загружены.
	 */
	metadata: EntityMetadata | undefined;
	/**
	 * Признак загрузки metadata.
	 */
	isLoading: boolean;
}

/**
 * Возвращает колонки для `Table`/`TreeTable` на основе OData metadata.
 *
 * В режиме `build` генерирует базовый набор колонок из `metadata.columns`.
 * В режиме `enrich` дозаполняет уже существующие колонки typed-formatting контекстом.
 */
export function useODataTableColumns<TData extends object = Record<string, unknown>>(
	config: UseODataTableColumnsConfig<TData>
): UseODataTableColumnsResult<TData> {
	const { metadata, isLoading } = useODataMetadata(config);

	const columns = useMemo(() => {
		if (!metadata) {
			return config.mode === "build" ? [] : [...config.columns];
		}

		if (config.mode === "build") {
			return createTableColumnsFromODataMetadata<TData>(metadata.columns, {
				resolveHeader: config.resolveHeader,
				resolveFormatting: config.resolveFormatting
			});
		}

		return enrichTableColumnsWithODataFormatting(config.columns, metadata.columns);
	}, [config, metadata]);

	const defaultColumnVisibility = useMemo(() => {
		if (!metadata) {
			return undefined;
		}

		if (config.mode === "build") {
			return createTableColumnVisibilityFromODataMetadata(metadata.columns, {
				resolveVisible: config.resolveVisible
			});
		}

		const visibilityById = createTableColumnVisibilityFromODataMetadata(metadata.columns);

		return collectMatchedColumnVisibility(config.columns, visibilityById);
	}, [config, metadata]);

	return {
		columns,
		defaultColumnVisibility,
		metadata,
		isLoading
	};
}
