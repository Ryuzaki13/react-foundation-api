import { persistedQueryMeta } from "@ryuzaki13/react-foundation-lib/query-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureODataProjectAdapter } from "./odataProjectAdapter";
import {
	createODataCollectionUpdatesQueryKey,
	fetchODataCollectionUpdates,
	ODATA_COLLECTION_UPDATES_LOOKBACK_MS,
	ODATA_COLLECTION_UPDATES_SW_CACHE,
	odataCollectionUpdatesQueryOptions
} from "./useODataCollectionUpdatesQuery";

afterEach(() => {
	configureODataProjectAdapter({});
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function configureTestODataProjectAdapter() {
	configureODataProjectAdapter({
		devDp0Service: "TEXT_APP_SRV",
		collectionUpdates: {
			service: "TEXT_APP_SRV",
			target: "TEXT_COLLECTION_UPDATES"
		}
	});
}

describe("useODataCollectionUpdatesQuery", () => {
	it("строит стабильный query key списка обновлённых справочников", () => {
		expect(createODataCollectionUpdatesQueryKey()).toEqual(["odata", "collection-updates", { buildId: __APP_BUILD_ID__ }]);
	});

	it("настраивает persisted query с TTL 4 часа", () => {
		configureTestODataProjectAdapter();
		const options = odataCollectionUpdatesQueryOptions();

		expect(options.queryKey).toEqual(["odata", "collection-updates", { buildId: __APP_BUILD_ID__ }]);
		expect(options.staleTime).toBe(1000 * 60 * 60 * 4);
		expect(options.gcTime).toBe(Infinity);
		expect(options.meta).toBe(persistedQueryMeta);
	});

	it("без endpoint оставляет query активным и завершает его пустым результатом", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch");
		const options = odataCollectionUpdatesQueryOptions();

		const result = await fetchODataCollectionUpdates()({ signal: new AbortController().signal });

		expect(options.enabled).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.items).toEqual([]);
		expect(result.byEntityName).toEqual({});
	});

	it("загружает и нормализует список обновлённых справочников", async () => {
		configureTestODataProjectAdapter();
		const fetchedAt = new Date(2026, 4, 8, 7, 15, 45).getTime();
		vi.useFakeTimers();
		vi.setSystemTime(fetchedAt);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					d: {
						results: [
							{
								entityName: "TextEntitySet",
								lastChanged: "20260501071545000007000"
							}
						]
					}
				}),
				{ headers: { "Content-Type": "application/json" } }
			)
		);

		const result = await fetchODataCollectionUpdates()({ signal: new AbortController().signal });
		const [, init] = fetchMock.mock.calls[0] ?? [];

		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/TEXT_APP_SRV/TEXT_COLLECTION_UPDATES");
		expect(new Headers((init as RequestInit | undefined)?.headers).get("x-sw-cache")).toBe(ODATA_COLLECTION_UPDATES_SW_CACHE);
		expect(result.items).toEqual([
			{
				entityName: "TextEntitySet",
				lastChanged: "20260501071545000007000",
				lastChangedAt: new Date(2026, 4, 1, 7, 15, 45)
			}
		]);
		expect(result.byEntityName.TextEntitySet?.lastChangedAt).toEqual(new Date(2026, 4, 1, 7, 15, 45));
		expect(result.fetchedAt).toBe(fetchedAt);
		expect(result.coverageStartedAt).toBe(fetchedAt - ODATA_COLLECTION_UPDATES_LOOKBACK_MS);
	});
});
