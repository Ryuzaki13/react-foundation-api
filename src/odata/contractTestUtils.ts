import type { EntityColumnProperty } from "@ryuzaki13/react-foundation-lib/odata-service";

const ODATA_PARSED_RUNTIME_KIND_BOOLEAN = "boolean";
const ODATA_PARSED_RUNTIME_KIND_NUMBER = "number";
const ODATA_PARSED_RUNTIME_KIND_DATE = "date";
const ODATA_PARSED_RUNTIME_KIND_STRING = "string";

export type ODataParsedRuntimeKind =
	| typeof ODATA_PARSED_RUNTIME_KIND_BOOLEAN
	| typeof ODATA_PARSED_RUNTIME_KIND_NUMBER
	| typeof ODATA_PARSED_RUNTIME_KIND_DATE
	| typeof ODATA_PARSED_RUNTIME_KIND_STRING;

export function inferODataParsedRuntimeKind(column: Pick<EntityColumnProperty, "type" | "abapBooleanLike">): ODataParsedRuntimeKind {
	if (column.abapBooleanLike || column.type === "boolean") {
		return ODATA_PARSED_RUNTIME_KIND_BOOLEAN;
	}

	if (
		column.type === "byte" ||
		column.type === "int" ||
		column.type === "float" ||
		column.type === "decimal" ||
		column.type === "double"
	) {
		return ODATA_PARSED_RUNTIME_KIND_NUMBER;
	}

	if (column.type === "datetime" || column.type === "datetimeOffset" || column.type === "time") {
		return ODATA_PARSED_RUNTIME_KIND_DATE;
	}

	return ODATA_PARSED_RUNTIME_KIND_STRING;
}

export function createODataParsedRuntimeKindMap(columns: EntityColumnProperty[]) {
	return columns.reduce<Record<string, ODataParsedRuntimeKind>>((acc, column) => {
		acc[column.id] = inferODataParsedRuntimeKind(column);
		return acc;
	}, {});
}

export function assertODataParsedContract(columns: EntityColumnProperty[], expected: Record<string, ODataParsedRuntimeKind>) {
	const actual = createODataParsedRuntimeKindMap(columns);

	for (const [key, kind] of Object.entries(expected)) {
		if (!(key in actual)) {
			throw new Error(`Колонка '${key}' отсутствует в metadata`);
		}

		if (actual[key] !== kind) {
			throw new Error(`Колонка '${key}' имеет тип '${actual[key]}', ожидался '${kind}'`);
		}
	}

	return actual;
}
