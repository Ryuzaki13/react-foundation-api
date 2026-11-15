// @vitest-environment jsdom

import { type ServiceMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";
import { createQueryClient, createReactQueryPersister } from "@ryuzaki13/react-foundation-lib/query-client";
import { hashKey, isCancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureODataProjectAdapter } from "./odataProjectAdapter";
import { refreshODataMetadataData } from "./refreshODataMetadataData";
import { fetchMetadata, odataMetadataQueryOptions } from "./useODataMetadataQuery";

const metadataXml = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
	<edmx:DataServices>
		<Schema Namespace="ZDEMO_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
			<EntityType Name="FreshEntity"><Key><PropertyRef Name="ID" /></Key><Property Name="ID" Type="Edm.String" /></EntityType>
			<EntityContainer Name="ZDEMO_SRV_Entities"><EntitySet Name="FreshSet" EntityType="ZDEMO_SRV.FreshEntity" /></EntityContainer>
		</Schema>
	</edmx:DataServices>
</edmx:Edmx>`;

const metadataOptions = { service: "ZDEMO_SRV" };
const cachedMetadata: ServiceMetadata = { entities: {}, functionImports: {} };

function metadataResponse(): Response {
	return new Response(metadataXml, { headers: { "Content-Type": "application/xml" } });
}

function testQueryClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
	configureODataProjectAdapter({});
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("refreshODataMetadataData", () => {
	it("обновляет canonical snapshot через HTTP reload, сохраняя обычные query options", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		const observer = new QueryObserver(client, { ...options, retry: 2 });
		client.setQueryData(options.queryKey, cachedMetadata);
		const query = client.getQueryCache().find({ queryKey: options.queryKey, exact: true });
		const previousOptions = query?.options;
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => metadataResponse());

		const result = await refreshODataMetadataData(metadataOptions, client);

		expect(result?.entities.FreshSet).toBeDefined();
		expect(client.getQueryData(options.queryKey)).toEqual(result);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("reload");
		expect(query?.options.queryFn).toBe(previousOptions?.queryFn);
		expect(query?.options).toMatchObject({ staleTime: Infinity, retry: 2 });
		observer.destroy();
	});

	it("завершает shared recovery после ухода последнего UI-подписчика", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		const observer = new QueryObserver(client, options);
		const unsubscribe = observer.subscribe(() => {});
		let completeRequest: (response: Response) => void = () => {};
		const response = new Promise<Response>((resolve) => {
			completeRequest = resolve;
		});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(response);
		const refresh = refreshODataMetadataData(metadataOptions, client);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		unsubscribe();
		expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
		completeRequest(metadataResponse());

		await expect(refresh).resolves.toHaveProperty("entities.FreshSet");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(client.getQueryCache().find({ queryKey: options.queryKey, exact: true })?.getObserversCount()).toBe(0);
	});

	it("сохраняет возможность явной отмены recovery через QueryClient", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		let completeRequest: (response: Response) => void = () => {};
		const response = new Promise<Response>((resolve) => {
			completeRequest = resolve;
		});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(response);
		const refresh = refreshODataMetadataData(metadataOptions, client);
		const cancelled = expect(refresh).rejects.toSatisfy(isCancelledError);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		await client.cancelQueries({ queryKey: options.queryKey, exact: true });
		await cancelled;
		completeRequest(metadataResponse());

		expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
		expect(client.getQueryData(options.queryKey)).toBe(cachedMetadata);
		expect(client.getQueryCache().find({ queryKey: options.queryKey, exact: true })?.getObserversCount()).toBe(0);
	});

	it("принудительно обновляет snapshot даже с будущим dataUpdatedAt", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata, { updatedAt: Date.now() + 60_000 });
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => metadataResponse());

		await expect(refreshODataMetadataData(metadataOptions, client)).resolves.toHaveProperty("entities.FreshSet");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("reload");
	});

	it("объединяет concurrent refresh по resolved key с custom queryKeyHashFn", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { queryKeyHashFn: (queryKey) => `custom:${hashKey(queryKey)}` } }
		});
		client.setQueryData(odataMetadataQueryOptions(metadataOptions).queryKey, cachedMetadata);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => metadataResponse());

		const first = refreshODataMetadataData(metadataOptions, client);
		const second = refreshODataMetadataData({ ...metadataOptions, baseUrl: "odata" }, client);

		expect(second).toBe(first);
		await Promise.all([first, second]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("дожидается обычного inflight запроса и затем выполняет отдельный reload", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		let completeNormalRequest: (response: Response) => void = () => {};
		const normalResponse = new Promise<Response>((resolve) => {
			completeNormalRequest = resolve;
		});
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockReturnValueOnce(normalResponse)
			.mockImplementation(async () => metadataResponse());
		const normal = client.fetchQuery({ ...options, staleTime: 0 });
		const refresh = refreshODataMetadataData(metadataOptions, client);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock.mock.calls[0]?.[1]?.cache).toBeUndefined();
		completeNormalRequest(metadataResponse());
		await Promise.all([normal, refresh]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
		expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe("reload");
	});

	it("после ошибки предшествующего запроса выполняет собственную reload-попытку", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		let rejectNormalRequest: (error: Error) => void = () => {};
		const normalResponse = new Promise<Response>((_resolve, reject) => {
			rejectNormalRequest = reject;
		});
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockReturnValueOnce(normalResponse)
			.mockImplementation(async () => metadataResponse());
		const failure = new Error("Обычное чтение завершилось ошибкой");
		const normalResult = expect(client.fetchQuery({ ...options, staleTime: 0 })).rejects.toBe(failure);
		const refresh = refreshODataMetadataData(metadataOptions, client);

		rejectNormalRequest(failure);
		await normalResult;
		await expect(refresh).resolves.toHaveProperty("entities.FreshSet");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe("reload");
	});

	it("сохраняет кеш при ошибке reload, не повторяет запрос и освобождает recovery slot", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		const failure = new Error("metadata недоступна");
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(failure)
			.mockImplementation(async () => metadataResponse());

		await expect(refreshODataMetadataData(metadataOptions, client)).rejects.toBe(failure);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(client.getQueryData(options.queryKey)).toBe(cachedMetadata);

		await expect(refreshODataMetadataData(metadataOptions, client)).resolves.toHaveProperty("entities.FreshSet");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("после ошибки recovery не запускает новые запросы на mount, focus и reconnect", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		const failure = new Error("metadata недоступна");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(failure);

		await expect(refreshODataMetadataData(metadataOptions, client)).rejects.toBe(failure);

		const observer = new QueryObserver(client, options);
		const unsubscribe = observer.subscribe(() => {});
		const query = client.getQueryCache().find({ queryKey: options.queryKey, exact: true });
		query?.onFocus();
		query?.onOnline();
		await Promise.resolve();

		expect(query?.state.isInvalidated).toBe(false);
		expect(observer.getCurrentResult().isStale).toBe(false);
		expect(client.getQueryData(options.queryKey)).toBe(cachedMetadata);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("не отменяет внешнюю invalidation, выполненную во время failed recovery", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		client.setQueryData(options.queryKey, cachedMetadata);
		let rejectRequest: (error: Error) => void = () => {};
		const response = new Promise<Response>((_resolve, reject) => {
			rejectRequest = reject;
		});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(response);
		const failure = new Error("metadata недоступна");
		const refresh = refreshODataMetadataData(metadataOptions, client);
		const failed = expect(refresh).rejects.toBe(failure);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
		rejectRequest(failure);
		await failed;

		expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("ограничивает восстановление, если посторонний persister не допускает network request", async () => {
		const persister = vi.fn(async () => cachedMetadata);
		const client = new QueryClient({ defaultOptions: { queries: { persister } } });
		const fetchMock = vi.spyOn(globalThis, "fetch");

		await expect(refreshODataMetadataData(metadataOptions, client)).rejects.toThrow("принудительное чтение metadata");

		expect(persister).toHaveBeenCalledTimes(2);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("при cold cache делает один reload и возвращает canonical options", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => metadataResponse());

		await refreshODataMetadataData(metadataOptions, client);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("reload");
		expect(client.getQueryCache().find({ queryKey: options.queryKey, exact: true })?.options).toMatchObject({ staleTime: Infinity });
	});

	it("после реального IndexedDB restore выполняет reload и сохраняет новый snapshot", async () => {
		vi.stubGlobal("indexedDB", new IDBFactory());
		const persister = createReactQueryPersister();
		if (!persister) throw new Error("Тесту требуется IndexedDB persister");
		const options = odataMetadataQueryOptions(metadataOptions);
		const seedClient = createQueryClient({});
		seedClient.setQueryDefaults(options.queryKey, { meta: options.meta });
		seedClient.setQueryData(options.queryKey, cachedMetadata);
		await persister.persistQueryByKey(options.queryKey, seedClient);
		const client = createQueryClient({});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => metadataResponse());

		const result = await refreshODataMetadataData(metadataOptions, client);

		expect(result?.entities.FreshSet).toBeDefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("reload");
		await vi.waitFor(async () => {
			expect(await persister.retrieveQuery(hashKey(options.queryKey))).toEqual(result);
		});

		const restoredClient = createQueryClient({});
		await expect(restoredClient.fetchQuery(options)).resolves.toEqual(result);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		seedClient.clear();
		client.clear();
		restoredClient.clear();
	});

	it("не перезаписывает новые options наблюдателя после завершения recovery", async () => {
		const client = testQueryClient();
		const options = odataMetadataQueryOptions(metadataOptions);
		const observer = new QueryObserver(client, options);
		client.setQueryData(options.queryKey, cachedMetadata);
		let completeRequest: (response: Response) => void = () => {};
		const response = new Promise<Response>((resolve) => {
			completeRequest = resolve;
		});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(response);
		const refresh = refreshODataMetadataData(metadataOptions, client);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const query = client.getQueryCache().find({ queryKey: options.queryKey, exact: true });
		observer.setOptions({ ...options, staleTime: 1234 });

		completeRequest(metadataResponse());
		await refresh;

		expect(query?.options).toMatchObject({ staleTime: 1234 });
		expect(query?.options.queryFn).toBe(options.queryFn);
		observer.destroy();
	});

	it("пустой service не создаёт query или запрос", async () => {
		const client = testQueryClient();
		const fetchMock = vi.spyOn(globalThis, "fetch");

		await expect(refreshODataMetadataData({ service: "" }, client)).resolves.toBeUndefined();

		expect(client.getQueryCache().getAll()).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("обычный fetchMetadata сохраняет HTTP cache policy по умолчанию", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => metadataResponse());

		await fetchMetadata(metadataOptions)();

		expect(fetchMock.mock.calls[0]?.[1]?.cache).toBeUndefined();
	});
});
