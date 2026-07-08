// @vitest-environment jsdom

import { persistedQueryMeta, REACT_QUERY_PERSISTENCE_MAX_AGE } from "@ryuzaki13/react-foundation-lib/query-client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createODataMetadataVersionQueryKey,
	fetchMetadataVersion,
	invalidateODataMetadataQueries,
	odataMetadataVersionQueryOptions
} from "./metadataVersionCheck";
import { configureODataProjectAdapter } from "./odataProjectAdapter";
import { applyODataMetadataVersion, getODataMetadataData, odataMetadataQueryOptions } from "./useODataMetadataQuery";

const demoMetadataXml = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
	<edmx:DataServices xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" m:DataServiceVersion="2.0">
		<Schema Namespace="TEXT_DEMO_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm" xmlns:sap="http://www.sap.com/Protocols/SAPData">
			<EntityType Name="TextEntitySet" sap:label="Демо">
				<Key>
					<PropertyRef Name="ID" />
				</Key>
				<Property Name="ID" Type="Edm.String" Nullable="false" sap:label="Ид." />
			</EntityType>
			<EntityContainer Name="TEXT_DEMO_SRV_Entities" m:IsDefaultEntityContainer="true">
				<EntitySet Name="TextEntitySet" EntityType="TEXT_DEMO_SRV.TextEntitySet" />
			</EntityContainer>
		</Schema>
	</edmx:DataServices>
</edmx:Edmx>`;

function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false
			}
		}
	});
}

afterEach(() => {
	configureODataProjectAdapter({});
	vi.restoreAllMocks();
});

function configureTestODataProjectAdapter() {
	configureODataProjectAdapter({
		devDp0Service: "TEXT_APP_SRV",
		metadataVersion: {
			service: "TEXT_APP_SRV",
			target: "TEXT_SERVICE_VERSION"
		}
	});
}

describe("odata query persistence", () => {
	it("помечает metadata query как persistable", () => {
		expect(odataMetadataQueryOptions({ service: "TEXT_APP_SRV" }).meta).toBe(persistedQueryMeta);
	});

	it("ограничивает возраст persisted query девяноста днями", () => {
		expect(REACT_QUERY_PERSISTENCE_MAX_AGE).toBe(90 * 24 * 60 * 60 * 1000);
	});

	it("настраивает metadata query на бесконечную свежесть", () => {
		const options = odataMetadataQueryOptions({ service: "TEXT_APP_SRV" });

		expect(options.queryKey).toEqual(["odata", "metadata", { service: "TEXT_APP_SRV" }]);
		expect(options.staleTime).toBe(Infinity);
		expect(options.gcTime).toBe(Infinity);
		expect(options.meta).toBe(persistedQueryMeta);
	});

	it("строит отдельный query key для версии metadata", () => {
		expect(createODataMetadataVersionQueryKey({ service: "TEXT_APP_SRV" })).toEqual([
			"odata",
			"metadata-version",
			{ service: "TEXT_APP_SRV", buildId: __APP_BUILD_ID__ }
		]);
	});

	it("настраивает version-check query как отдельный persisted query", () => {
		configureTestODataProjectAdapter();
		const options = odataMetadataVersionQueryOptions({ service: "TEXT_APP_SRV" });

		expect(options.queryKey).toEqual(["odata", "metadata-version", { service: "TEXT_APP_SRV", buildId: __APP_BUILD_ID__ }]);
		expect(options.staleTime).toBe(1000 * 60 * 60 * 24);
		expect(options.gcTime).toBe(Infinity);
		expect(options.meta).toBe(persistedQueryMeta);
		expect(options.enabled).toBe(true);
	});

	it("загружает версию metadata через сервис генерации TEXT_APP_SRV", async () => {
		configureTestODataProjectAdapter();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					d: {
						results: [
							{
								serviceName: "TEXT_DEMO_SRV",
								lastChanged: "20260513112233000000000"
							}
						]
					}
				}),
				{ headers: { "Content-Type": "application/json" } }
			)
		);

		const result = await fetchMetadataVersion({ service: "TEXT_DEMO_SRV" })({ signal: new AbortController().signal });
		const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
		const requestedSearch = new URL(requestedUrl, "http://localhost").searchParams;

		expect(requestedUrl).toContain("/TEXT_APP_SRV/TEXT_SERVICE_VERSION('TEXT_DEMO_SRV')");
		expect(requestedSearch.get("$filter")).toBeNull();
		expect(result).toEqual({
			service: "TEXT_DEMO_SRV",
			changedAt: new Date(2026, 4, 13, 11, 22, 33),
			version: "2026-05-13T11:22:33"
		});
	});

	it("возвращает пустую версию metadata для некорректного ответа", async () => {
		configureTestODataProjectAdapter();
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ d: { results: [{ serviceName: "TEXT_DEMO_SRV" }] } }), {
				headers: { "Content-Type": "application/json" }
			})
		);

		await expect(fetchMetadataVersion({ service: "TEXT_DEMO_SRV" })({ signal: new AbortController().signal })).resolves.toEqual({
			service: "TEXT_DEMO_SRV",
			changedAt: null,
			version: null
		});
	});

	it("инвалидирует только metadata query указанного сервиса", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(["odata", "metadata", { service: "TEXT_DEMO_SRV" }], "demo");
		queryClient.setQueryData(["odata", "metadata", { service: "TEXT_OTHER_SRV" }], "other");
		queryClient.setQueryData(createODataMetadataVersionQueryKey({ service: "TEXT_DEMO_SRV" }), "version");

		await invalidateODataMetadataQueries(queryClient, "TEXT_DEMO_SRV");

		expect(queryClient.getQueryState(["odata", "metadata", { service: "TEXT_DEMO_SRV" }])?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(["odata", "metadata", { service: "TEXT_OTHER_SRV" }])?.isInvalidated).toBe(false);
		expect(queryClient.getQueryState(createODataMetadataVersionQueryKey({ service: "TEXT_DEMO_SRV" }))?.isInvalidated).toBe(false);
	});

	it("getODataMetadataData проверяет версию и обновляет сохранённые metadata при изменении сервиса", async () => {
		configureTestODataProjectAdapter();
		const queryClient = createTestQueryClient();
		const metadataOptions = { service: "TEXT_DEMO_SRV" };
		queryClient.setQueryData(
			odataMetadataQueryOptions(metadataOptions).queryKey,
			{
				entities: {},
				functionImports: {}
			},
			{ updatedAt: new Date(2026, 4, 13, 11, 22, 33).getTime() }
		);
		queryClient.setQueryData(createODataMetadataVersionQueryKey(metadataOptions), {
			service: "TEXT_DEMO_SRV",
			changedAt: new Date(2026, 4, 13, 11, 22, 33),
			version: "20260513112233"
		});
		await queryClient.invalidateQueries({ queryKey: createODataMetadataVersionQueryKey(metadataOptions) });

		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						d: {
							results: [
								{
									serviceName: "TEXT_DEMO_SRV",
									lastChanged: "20260514010203000000000"
								}
							]
						}
					}),
					{ headers: { "Content-Type": "application/json" } }
				)
			)
			.mockResolvedValueOnce(new Response(demoMetadataXml, { headers: { "Content-Type": "application/xml" } }));

		const metadata = await getODataMetadataData(metadataOptions, queryClient);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(metadata?.entities.TextEntitySet?.title).toBe("Демо");
	});

	it("обновляет metadata только когда версия сервера новее кеша", async () => {
		const queryClient = createTestQueryClient();
		const metadataOptions = { service: "TEXT_DEMO_SRV" };
		queryClient.setQueryData(
			odataMetadataQueryOptions(metadataOptions).queryKey,
			{
				entities: {},
				functionImports: {}
			},
			{ updatedAt: new Date(2026, 4, 13, 11, 22, 33).getTime() }
		);
		const version = {
			service: "TEXT_DEMO_SRV",
			changedAt: new Date(2026, 4, 14, 1, 2, 3),
			version: "20260514010203"
		};

		await applyODataMetadataVersion(queryClient, metadataOptions, version);
		expect(queryClient.getQueryState(odataMetadataQueryOptions(metadataOptions).queryKey)?.isInvalidated).toBe(true);

		queryClient.setQueryData(
			odataMetadataQueryOptions(metadataOptions).queryKey,
			{
				entities: {},
				functionImports: {}
			},
			{ updatedAt: new Date(2026, 4, 14, 1, 2, 4).getTime() }
		);
		await applyODataMetadataVersion(queryClient, metadataOptions, version);

		expect(queryClient.getQueryState(odataMetadataQueryOptions(metadataOptions).queryKey)?.isInvalidated).toBe(false);
	});

	it("не блокирует повторную проверку, если metadata ещё не восстановлена из кеша", async () => {
		const queryClient = createTestQueryClient();
		const metadataOptions = { service: "TEXT_DEMO_SRV" };
		const version = {
			service: "TEXT_DEMO_SRV",
			changedAt: new Date(2026, 4, 14, 1, 2, 3),
			version: "2026-05-14T01:02:03"
		};

		await applyODataMetadataVersion(queryClient, metadataOptions, version);

		expect(queryClient.getQueryState(odataMetadataQueryOptions(metadataOptions).queryKey)).toBeUndefined();

		queryClient.setQueryData(
			odataMetadataQueryOptions(metadataOptions).queryKey,
			{
				entities: {},
				functionImports: {}
			},
			{ updatedAt: new Date(2026, 4, 13, 11, 22, 33).getTime() }
		);
		await applyODataMetadataVersion(queryClient, metadataOptions, version);

		expect(queryClient.getQueryState(odataMetadataQueryOptions(metadataOptions).queryKey)?.isInvalidated).toBe(true);
	});

	it("getODataMetadataData оставляет кеш metadata рабочим при ошибке version-check", async () => {
		configureTestODataProjectAdapter();
		const queryClient = createTestQueryClient();
		const metadataOptions = { service: "TEXT_DEMO_SRV" };
		const cachedMetadata = {
			entities: {},
			functionImports: {}
		};
		queryClient.setQueryData(odataMetadataQueryOptions(metadataOptions).queryKey, cachedMetadata);
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("version-check недоступен"));

		await expect(getODataMetadataData(metadataOptions, queryClient)).resolves.toBe(cachedMetadata);
	});
});
