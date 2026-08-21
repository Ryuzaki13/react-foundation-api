import { describe, expect, it } from "vitest";

import { projectODataCollectionSortByText } from "./projectODataCollectionSort";

import type { ODataCollectionResult } from "./useODataCollectionQuery";
import type { CollectionItem } from "@ryuzaki13/react-foundation-lib/odata-service";

function createSource(): ODataCollectionResult<CollectionItem> {
	const first = { CODE: "01", TEXT: "Я" };
	const second = { CODE: "02", TEXT: "А" };
	const withoutTextPair = [{ OTHER: "01" }, { OTHER: "02" }];

	return {
		items: [second, first],
		keyPairs: [{ codeKey: "CODE", textKey: "TEXT" }],
		keyPairsMap: { CODE: "TEXT" },
		separated: {
			CODE: [first, second],
			OTHER: withoutTextPair
		},
		chain: [{ codeKey: "CODE", count: 2 }],
		count: 2,
		cacheUpdatedAt: 1
	};
}

describe("projectODataCollectionSortByText", () => {
	it("сортирует массивы ссылок по text и не мутирует канонический snapshot", () => {
		const source = createSource();
		const projected = projectODataCollectionSortByText(source);

		expect(projected).not.toBe(source);
		expect(projected.separated).not.toBe(source.separated);
		expect(projected.separated.CODE).not.toBe(source.separated.CODE);
		expect(projected.separated.CODE.map((item) => item.CODE)).toEqual(["02", "01"]);
		expect(source.separated.CODE.map((item) => item.CODE)).toEqual(["01", "02"]);

		expect(projected.separated.CODE[0]).toBe(source.separated.CODE[1]);
		expect(projected.separated.OTHER).toBe(source.separated.OTHER);
		expect(projected.items).toBe(source.items);
		expect(projected.keyPairs).toBe(source.keyPairs);
		expect(projected.keyPairsMap).toBe(source.keyPairsMap);
		expect(projected.chain).toBe(source.chain);
	});

	it("разделяет готовую text-проекцию между observer одного snapshot", () => {
		const source = createSource();

		expect(projectODataCollectionSortByText(source)).toBe(projectODataCollectionSortByText(source));
	});

	it("возвращает исходный snapshot, если сортируемых уровней нет", () => {
		const source = createSource();
		const withoutSortableLevels = {
			...source,
			keyPairsMap: {},
			separated: {
				OTHER: source.separated.OTHER
			}
		};

		expect(projectODataCollectionSortByText(withoutSortableLevels)).toBe(withoutSortableLevels);
	});
});
