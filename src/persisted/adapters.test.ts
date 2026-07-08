import { createFilterEqual } from "@ryuzaki13/react-foundation-lib/odata-service";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
	createServerFnMutationOperation,
	createServerFnQueryOperation,
	type ServerFnTransport,
	type ServerFnTransportRequest
} from "../server-fn";

import { createInvalidatePersistedScopeCacheStrategy, createSetPersistedQueryDataCacheStrategy } from "./cache";
import { createPersistedODataMutationOperation, createPersistedODataQueryOperation } from "./odata";
import { createPersistedResourceDescriptor } from "./resource";
import { createPersistedRestMutationOperation, createPersistedRestQueryOperation } from "./rest";

describe("persisted-record adapters", () => {
	function isRestRow(value: unknown): value is { readonly id: string } {
		return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string";
	}

	function parseRestListResponse(payload: unknown): { readonly data: readonly { readonly id: string }[] } {
		if (typeof payload !== "object" || payload === null || !("data" in payload) || !Array.isArray(payload.data)) {
			throw new Error("Некорректный REST payload.");
		}

		if (!payload.data.every(isRestRow)) {
			throw new Error("Некорректная REST строка.");
		}

		return { data: payload.data };
	}

	it("собирает OData query request и маппит ответ", async () => {
		const executor = vi.fn(async () => ({ data: [{ appId: "one" }, { appId: "two" }] }));
		const operation = createPersistedODataQueryOperation<{ appId: string }, { limit: number }, { appId: string }[], string[]>({
			odata: { service: "SERVICE", target: "ENTITY" },
			buildOptions: (scope, args) => ({
				top: args.limit,
				expression: {
					and: true,
					filters: [createFilterEqual("appId", scope.appId)]
				}
			}),
			transform: (data) => data.map((item) => item.appId.toUpperCase()),
			executor
		});

		const result = await operation.execute({
			scope: { appId: "APP" },
			args: { limit: 2 },
			client: new QueryClient()
		});

		expect(result).toEqual(["ONE", "TWO"]);
		expect(executor).toHaveBeenCalledWith(
			"query",
			expect.objectContaining({
				odata: { service: "SERVICE", target: "ENTITY" },
				options: expect.objectContaining({ top: 2 })
			}),
			expect.any(Object)
		);
	});

	it("собирает OData mutation request c params и body", async () => {
		const executor = vi.fn(async (request) => ({ data: { ok: true, request } }));
		const operation = createPersistedODataMutationOperation<
			{ appId: string },
			{ variantId: string; payload: string },
			{ ok: boolean; request: unknown },
			boolean
		>({
			odata: { service: "SERVICE", target: "ENTITY" },
			method: "update",
			buildParams: (_, input) => ({
				variantId: { value: input.variantId }
			}),
			bodyMapper: (_, input) => input,
			transform: (data) => data.ok,
			executor
		});

		const result = await operation.execute({
			scope: { appId: "APP" },
			input: { variantId: "VAR-1", payload: "{}" },
			client: new QueryClient()
		});

		expect(result).toBe(true);
		expect(executor).toHaveBeenCalledWith(
			"update",
			expect.objectContaining({
				params: { variantId: { value: "VAR-1" } },
				body: { variantId: "VAR-1", payload: "{}" }
			}),
			expect.any(Object)
		);
	});

	it("собирает REST query и mutation requests", async () => {
		const queryExecutor = vi.fn(async () => ({ data: [{ id: "1" }] }));
		const mutationExecutor = vi.fn(async (request) => request);

		const queryOperation = createPersistedRestQueryOperation<{ userId: string }, void, { data: Array<{ id: string }> }, string[]>({
			buildUrl: (scope) => `/api/demo/list?userId=${scope.userId}`,
			transform: (data) => data.data.map((item) => item.id),
			executor: queryExecutor
		});
		const mutationOperation = createPersistedRestMutationOperation<
			{ userId: string },
			{ payload: { name: string } },
			{ url: string; init?: RequestInit },
			string
		>({
			buildUrl: () => "/api/demo",
			method: "PUT",
			bodyMapper: (_, input) => input.payload,
			transform: (data) => data.url,
			executor: mutationExecutor
		});

		const queryResult = await queryOperation.execute({
			scope: { userId: "USER" },
			args: undefined,
			client: new QueryClient()
		});
		const mutationResult = await mutationOperation.execute({
			scope: { userId: "USER" },
			input: { payload: { name: "Preset" } },
			client: new QueryClient()
		});

		expect(queryResult).toEqual(["1"]);
		expect(queryExecutor).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "/api/demo/list?userId=USER"
			})
		);
		expect(mutationResult).toBe("/api/demo");
		expect(mutationExecutor).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "/api/demo",
				init: expect.objectContaining({
					method: "PUT",
					body: JSON.stringify({ name: "Preset" })
				})
			})
		);
	});

	it("выполняет REST query через чистый HTTP transport и явный parser", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ data: [{ id: "2" }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" }
				})
		);
		vi.stubGlobal("fetch", fetchMock);

		try {
			const queryOperation = createPersistedRestQueryOperation<
				{ userId: string },
				void,
				{ readonly data: readonly { readonly id: string }[] }
			>({
				baseUrl: "https://example.test",
				buildUrl: (scope) => `/api/demo/list?userId=${scope.userId}`,
				parseResponse: parseRestListResponse
			});

			const result = await queryOperation.execute({
				scope: { userId: "USER" },
				args: undefined,
				client: new QueryClient()
			});

			expect(result).toEqual({ data: [{ id: "2" }] });
			expect(fetchMock).toHaveBeenCalledWith(
				"https://example.test/api/demo/list?userId=USER",
				expect.objectContaining({ signal: undefined })
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("вызывает serverFn query и mutation через переносимый data-контракт", async () => {
		type Scope = {
			readonly appId: string;
		};
		type QueryArgs = {
			readonly limit: number;
		};
		type QueryData = {
			readonly appId: string;
			readonly limit: number;
		};
		type QueryResponse = {
			readonly rows: readonly {
				readonly id: string;
			}[];
		};
		type MutationInput = {
			readonly recordId: string;
			readonly payload: string;
		};
		type MutationData = {
			readonly appId: string;
			readonly recordId: string;
			readonly payload: string;
		};
		type MutationResponse = {
			readonly savedId: string;
			readonly revision: number;
		};

		const queryClient = new QueryClient();
		const queryServerFn = vi.fn(async ({ data }: { readonly data: QueryData }): Promise<QueryResponse> => ({
			rows: [{ id: `${data.appId}:${data.limit}` }]
		}));
		const mutationServerFn = vi.fn(async ({ data }: { readonly data: MutationData }): Promise<MutationResponse> => ({
			savedId: `${data.appId}:${data.recordId}`,
			revision: data.payload.length
		}));
		const queryExecutor = vi.fn(
			async (
				serverFn: ServerFnTransport<QueryData, QueryResponse>,
				request: ServerFnTransportRequest<QueryData>
			): Promise<QueryResponse> => await serverFn(request)
		);

		const queryOperation = createServerFnQueryOperation<Scope, QueryArgs, QueryData, QueryResponse, readonly string[]>({
			serverFn: queryServerFn,
			buildData: (scope, args) => ({
				appId: scope.appId,
				limit: args.limit
			}),
			transform: (response) => response.rows.map((row) => row.id),
			executor: queryExecutor
		});
		const mutationOperation = createServerFnMutationOperation<Scope, MutationInput, MutationData, MutationResponse, string, unknown>({
			serverFn: mutationServerFn,
			buildData: (scope, input) => ({
				appId: scope.appId,
				recordId: input.recordId,
				payload: input.payload
			}),
			transform: (response) => response.savedId
		});

		const queryResult = await queryOperation.execute({
			scope: { appId: "APP" },
			args: { limit: 3 },
			client: queryClient
		});
		const mutationResult = await mutationOperation.execute({
			scope: { appId: "APP" },
			input: { recordId: "REC", payload: "data" },
			client: queryClient
		});

		expect(queryResult).toEqual(["APP:3"]);
		expect(mutationResult).toBe("APP:REC");
		expect(queryServerFn).toHaveBeenCalledWith({ data: { appId: "APP", limit: 3 } });
		expect(mutationServerFn).toHaveBeenCalledWith({ data: { appId: "APP", recordId: "REC", payload: "data" } });
		expect(queryExecutor).toHaveBeenCalledWith(
			queryServerFn,
			{ data: { appId: "APP", limit: 3 } },
			expect.objectContaining({ client: queryClient })
		);
	});

	it("применяет cache strategies для invalidate и setQueryData", async () => {
		const client = new QueryClient();
		const descriptor = createPersistedResourceDescriptor({
			namespace: "demo",
			resource: "resource",
			normalizeScope: (scope: { id: string } | null | undefined) => scope ?? { id: "" },
			transport: {}
		});
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		client.setQueryData(descriptor.keys.latest({ id: "scope-1" }), { count: 1 });

		await createInvalidatePersistedScopeCacheStrategy<{ id: string }, void, void>().onSuccess?.({
			client,
			descriptor,
			scope: { id: "scope-1" },
			input: undefined,
			result: undefined
		});
		await createSetPersistedQueryDataCacheStrategy<{ id: string }, void, { value: number }, { count: number }>({
			getQueryKey: ({ descriptor: currentDescriptor, scope }) => currentDescriptor.keys.latest(scope),
			update: (_, context) => ({ count: context.result.value })
		}).onSuccess?.({
			client,
			descriptor,
			scope: { id: "scope-1" },
			input: undefined,
			result: { value: 5 }
		});

		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: descriptor.keys.scope({ id: "scope-1" }) });
		expect(client.getQueryData(descriptor.keys.latest({ id: "scope-1" }))).toEqual({ count: 5 });
	});
});
