import { describe, expect, it } from "vitest";

import {
	resolveODataCollectionSwCachePolicy,
	shouldRefreshODataCollectionCache,
	type ODataCollectionResult
} from "./useODataCollectionQuery";
import {
	ODATA_COLLECTION_BUST_SW_CACHE,
	ODATA_COLLECTION_DEFAULT_SW_CACHE,
	type ODataCollectionUpdateItem
} from "./useODataCollectionUpdatesQuery";

function createUpdate(date: Date): ODataCollectionUpdateItem {
	return {
		entityName: "TextEntitySet",
		lastChanged: "20260501071545000007000",
		lastChangedAt: date
	};
}

function createCachedData(cacheUpdatedAt: number): ODataCollectionResult<Record<string, string>> {
	return {
		items: [],
		keyPairs: [],
		keyPairsMap: {},
		separated: {},
		chain: [],
		count: 0,
		cacheUpdatedAt
	};
}

describe("useODataCollectionQuery helpers", () => {
	it("считает справочник устаревшим только при новой записи в списке обновлений", () => {
		const cachedData = createCachedData(new Date(2026, 4, 1, 7, 15, 44).getTime());

		expect(shouldRefreshODataCollectionCache({ update: createUpdate(new Date(2026, 4, 1, 7, 15, 45)) }, cachedData)).toBe(true);
		expect(shouldRefreshODataCollectionCache({ update: createUpdate(new Date(2026, 4, 1, 7, 15, 44)) }, cachedData)).toBe(false);
		expect(shouldRefreshODataCollectionCache({}, cachedData)).toBe(false);
	});

	it("считает первую загрузку требующей bust, если target есть в списке обновлений", () => {
		expect(shouldRefreshODataCollectionCache({ update: createUpdate(new Date(2026, 4, 1, 7, 15, 45)) }, undefined)).toBe(true);
	});

	it("считает справочник устаревшим, если metadata обновилась позже данных справочника", () => {
		const cachedData = createCachedData(new Date(2026, 4, 1, 7, 15, 44).getTime());

		expect(shouldRefreshODataCollectionCache({ metadataUpdatedAt: new Date(2026, 4, 1, 7, 15, 45).getTime() }, cachedData)).toBe(true);
		expect(shouldRefreshODataCollectionCache({ metadataUpdatedAt: new Date(2026, 4, 1, 7, 15, 44).getTime() }, cachedData)).toBe(false);
	});

	it("обновляет открытый справочник, если его кеш старше недельного окна списка обновлений", () => {
		const staleCachedData = createCachedData(new Date(2026, 4, 1, 7, 15, 44).getTime());
		const freshCachedData = createCachedData(new Date(2026, 4, 8, 7, 15, 44).getTime());
		const coverageStartedAt = new Date(2026, 4, 7, 0, 0, 0).getTime();

		expect(shouldRefreshODataCollectionCache({ updatesCoverageStartedAt: coverageStartedAt }, staleCachedData)).toBe(true);
		expect(shouldRefreshODataCollectionCache({ updatesCoverageStartedAt: coverageStartedAt }, freshCachedData)).toBe(false);
	});

	it("переводит ttl-политику SW в bust для подтверждённого обновления", () => {
		expect(resolveODataCollectionSwCachePolicy(ODATA_COLLECTION_DEFAULT_SW_CACHE, true)).toBe(ODATA_COLLECTION_BUST_SW_CACHE);
		expect(resolveODataCollectionSwCachePolicy("ttl=10m;name=custom", true)).toBe("bust=10m;name=custom");
		expect(resolveODataCollectionSwCachePolicy("off", true)).toBe("off");
		expect(resolveODataCollectionSwCachePolicy("ttl=10m;name=custom", false)).toBe("ttl=10m;name=custom");
	});
});
