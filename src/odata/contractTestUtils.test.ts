import { describe, expect, it } from "vitest";

import { assertODataParsedContract, createODataParsedRuntimeKindMap } from "./contractTestUtils";

import type { EntityColumnProperty } from "@ryuzaki13/react-foundation-lib/odata-service";

const columns: EntityColumnProperty[] = [
	{
		id: "FLAG",
		label: "FLAG",
		type: "string",
		originalType: "Edm.String",
		maxLength: 1,
		abapBooleanLike: true,
		semanticType: "none",
		sortable: true,
		filterable: true,
		role: "dimension"
	},
	{
		id: "AMOUNT",
		label: "AMOUNT",
		type: "decimal",
		originalType: "Edm.Decimal",
		semanticType: "none",
		sortable: true,
		filterable: true,
		role: "measure"
	},
	{
		id: "AEDAT",
		label: "AEDAT",
		type: "datetime",
		originalType: "Edm.DateTime",
		semanticType: "none",
		sortable: true,
		filterable: true,
		role: "dimension"
	}
];

describe("contractTestUtils", () => {
	it("строит карту parsed runtime-типов по metadata", () => {
		expect(createODataParsedRuntimeKindMap(columns)).toEqual({
			FLAG: "boolean",
			AMOUNT: "number",
			AEDAT: "date"
		});
	});

	it("проверяет ожидаемый parsed-контракт", () => {
		expect(() =>
			assertODataParsedContract(columns, {
				FLAG: "boolean",
				AMOUNT: "number",
				AEDAT: "date"
			})
		).not.toThrow();
	});

	it("падает при расхождении контракта с metadata", () => {
		expect(() =>
			assertODataParsedContract(columns, {
				FLAG: "string"
			})
		).toThrow("Колонка 'FLAG' имеет тип 'boolean', ожидался 'string'");
	});
});
