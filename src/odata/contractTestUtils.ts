import type { EntityColumnProperty } from "@ryuzaki13/react-foundation-lib/odata-service";

export type ODataParsedRuntimeKind = "boolean" | "number" | "date" | "string";

export function inferODataParsedRuntimeKind(column: Pick<EntityColumnProperty, "type" | "abapBooleanLike">): ODataParsedRuntimeKind {
	if (column.abapBooleanLike || column.type === "boolean") {
		return "boolean";
	}

	if (
		column.type === "byte" ||
		column.type === "int" ||
		column.type === "float" ||
		column.type === "decimal" ||
		column.type === "double"
	) {
		return "number";
	}

	if (column.type === "datetime" || column.type === "datetimeOffset" || column.type === "time") {
		return "date";
	}

	return "string";
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
