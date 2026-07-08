import { type ODataFetchFnRequest, type ODataFetchOptions } from "../odata";
import { odataFetchFn } from "../odata/odataFetchFn";
import { BaseURLType } from "../odata/transport";

import { PersistedMutationOperation, PersistedQueryOperation } from "./types";

import type { ODataOperationMethod, ODataServiceConfig, WrappedODataParameters } from "@ryuzaki13/react-foundation-lib/odata-service";
import type { QueryClient, QueryMeta } from "@tanstack/react-query";

/**
 * Полная сигнатура конфигурации `odataQueryFn`.
 */
type PersistedODataEntity<TData> = TData extends (infer TItem)[] ? TItem : TData;
type PersistedODataRequest<
	TMethod extends ODataOperationMethod,
	TBody = unknown,
	TResponse = TBody,
	TEntity = PersistedODataEntity<TResponse>
> = TMethod extends "query"
	? ODataFetchFnRequest<"query", TEntity, TEntity, TEntity>
	: TMethod extends "create"
		? ODataFetchFnRequest<"create", TResponse, TResponse, TBody>
		: TMethod extends "update"
			? ODataFetchFnRequest<"update", TResponse, TResponse, TBody>
			: TMethod extends "delete"
				? ODataFetchFnRequest<"delete", TResponse, TResponse, TEntity>
				: TMethod extends "read"
					? ODataFetchFnRequest<"read", TResponse, TResponse, TEntity>
					: TMethod extends "fi"
						? ODataFetchFnRequest<"fi", TResponse, TResponse, TEntity>
						: never;

/**
 * Контекст низкоуровневого OData executor.
 */
interface PersistedODataExecutorContext {
	client: QueryClient;
	signal?: AbortSignal;
}

/**
 * Низкоуровневая функция выполнения OData-запроса.
 *
 * По умолчанию используется сам `odataQueryFn`, но в тестах или особых
 * сценариях executor можно подменить.
 */
type PersistedODataExecutor<TMethod extends ODataOperationMethod, TBody, TResponse> = (
	method: TMethod,
	request: PersistedODataRequest<TMethod, TBody, TResponse, PersistedODataEntity<TResponse>>,
	context: PersistedODataExecutorContext
) => Promise<{ data: TResponse; totalCount?: number }>;

/**
 * Опции для создания OData query-операции.
 */
interface PersistedODataReadOperationOptions<TScope, TArgs, TResponse, TResult> {
	odata: ODataServiceConfig;
	baseUrl?: BaseURLType;
	buildParams?: (scope: TScope, args: TArgs) => WrappedODataParameters;
	buildOptions?: (scope: TScope, args: TArgs) => ODataFetchOptions<PersistedODataEntity<TResponse>> | undefined;
	buildInit?: (scope: TScope, args: TArgs) => Omit<RequestInit, "signal" | "method" | "body">;
	transform?: (data: TResponse, context: { scope: TScope; args: TArgs }) => TResult;
	executor?: PersistedODataExecutor<"query" | "read", PersistedODataEntity<TResponse>, TResponse>;
	staleTime?: number;
	gcTime?: number;
	meta?: QueryMeta;
	isEnabled?: (scope: TScope | null | undefined, args: TArgs) => boolean;
}

/**
 * Опции для создания OData mutation-операции.
 */
interface PersistedODataWriteOperationSharedOptions<TScope, TInput, TResponse, TResult> {
	odata: ODataServiceConfig;
	baseUrl?: BaseURLType;
	buildOptions?: (scope: TScope, input: TInput) => ODataFetchOptions<PersistedODataEntity<TResponse>> | undefined;
	buildInit?: (scope: TScope, input: TInput) => Omit<RequestInit, "signal" | "method" | "body">;
	transform?: (data: TResponse, context: { scope: TScope; input: TInput }) => TResult;
	cacheStrategy?: PersistedMutationOperation<TScope, TInput, TResult>["cacheStrategy"];
}

type PersistedODataCreateOperationOptions<TScope, TInput, TBody, TResponse, TResult> = PersistedODataWriteOperationSharedOptions<
	TScope,
	TInput,
	TResponse,
	TResult
> & {
	method: "create";
	buildParams?: never;
	bodyMapper: (scope: TScope, input: TInput) => TBody;
	executor?: PersistedODataExecutor<"create", TBody, TResponse>;
};

type PersistedODataUpdateOperationOptions<TScope, TInput, TBody, TResponse, TResult> = PersistedODataWriteOperationSharedOptions<
	TScope,
	TInput,
	TResponse,
	TResult
> & {
	method: "update";
	buildParams: (scope: TScope, input: TInput) => WrappedODataParameters;
	bodyMapper: (scope: TScope, input: TInput) => TBody;
	executor?: PersistedODataExecutor<"update", TBody, TResponse>;
};

type PersistedODataDeleteOperationOptions<TScope, TInput, TResponse, TResult> = PersistedODataWriteOperationSharedOptions<
	TScope,
	TInput,
	TResponse,
	TResult
> & {
	method: "delete";
	buildParams: (scope: TScope, input: TInput) => WrappedODataParameters;
	bodyMapper?: never;
	executor?: PersistedODataExecutor<"delete", never, TResponse>;
};

type PersistedODataWriteOperationOptions<TScope, TInput, TBody, TResponse, TResult> =
	| PersistedODataCreateOperationOptions<TScope, TInput, TBody, TResponse, TResult>
	| PersistedODataUpdateOperationOptions<TScope, TInput, TBody, TResponse, TResult>
	| PersistedODataDeleteOperationOptions<TScope, TInput, TResponse, TResult>;

/**
 * Выполняет OData-запрос через переданный executor или через дефолтный `odataQueryFn`.
 */
async function executePersistedOData<TMethod extends ODataOperationMethod, TBody, TResponse>(
	method: TMethod,
	request: PersistedODataRequest<TMethod, TBody, TResponse, PersistedODataEntity<TResponse>>,
	context: PersistedODataExecutorContext,
	executor?: PersistedODataExecutor<TMethod, TBody, TResponse>
) {
	if (executor) {
		return await executor(method, request, context);
	}

	switch (method) {
		case "query": {
			const response = await odataFetchFn<PersistedODataEntity<TResponse>, PersistedODataEntity<TResponse>>(
				"query",
				request as ODataFetchFnRequest<
					"query",
					PersistedODataEntity<TResponse>,
					PersistedODataEntity<TResponse>,
					PersistedODataEntity<TResponse>
				> & {
					transform?: undefined;
				}
			)(context);

			return response as unknown as {
				data: TResponse;
				totalCount?: number;
			};
		}
		case "create": {
			const response = await odataFetchFn<TResponse, TBody, "create">(
				"create",
				request as ODataFetchFnRequest<"create", TResponse, TResponse, TBody> & {
					transform?: undefined;
				}
			)(context);

			return response as unknown as {
				data: TResponse;
				totalCount?: number;
			};
		}
		case "update": {
			const response = await odataFetchFn<TResponse, TBody, "update">(
				"update",
				request as ODataFetchFnRequest<"update", TResponse, TResponse, TBody> & {
					transform?: undefined;
				}
			)(context);

			return response as unknown as {
				data: TResponse;
				totalCount?: number;
			};
		}
		case "delete": {
			const response = await odataFetchFn<TResponse, PersistedODataEntity<TResponse>, "delete">(
				"delete",
				request as ODataFetchFnRequest<"delete", TResponse, TResponse, PersistedODataEntity<TResponse>> & {
					transform?: undefined;
				}
			)(context);

			return response as unknown as {
				data: TResponse;
				totalCount?: number;
			};
		}
		case "read": {
			const response = await odataFetchFn<TResponse, PersistedODataEntity<TResponse>, "read">(
				"read",
				request as ODataFetchFnRequest<"read", TResponse, TResponse, PersistedODataEntity<TResponse>> & {
					transform?: undefined;
				}
			)(context);

			return response as unknown as {
				data: TResponse;
				totalCount?: number;
			};
		}
		case "fi": {
			const response = await odataFetchFn<TResponse, PersistedODataEntity<TResponse>, "fi">(
				"fi",
				request as ODataFetchFnRequest<"fi", TResponse, TResponse, PersistedODataEntity<TResponse>> & {
					transform?: undefined;
				}
			)(context);

			return response as unknown as {
				data: TResponse;
				totalCount?: number;
			};
		}
	}
}

/**
 * Создаёт query-операцию поверх OData transport.
 *
 * @example
 * ```ts
 * const latestOperation = createPersistedODataQueryOperation({
 *   odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_CONFIG_LATEST" },
 *   buildOptions: (scope) => ({
 *     expression: buildScopeFilters(scope)
 *   }),
 *   transform: (rows) => parsePersistedJson(rows[0]?.payload)
 * });
 * ```
 */
export function createPersistedODataQueryOperation<TScope, TArgs, TResponse, TResult = TResponse>(
	options: PersistedODataReadOperationOptions<TScope, TArgs, TResponse, TResult>
): PersistedQueryOperation<TScope, TArgs, TResult> {
	return {
		isEnabled: options.isEnabled,
		staleTime: options.staleTime,
		gcTime: options.gcTime,
		meta: options.meta,
		execute: async ({ scope, args, client, signal }) => {
			const response = await executePersistedOData<"query", PersistedODataEntity<TResponse>, TResponse>(
				"query",
				{
					odata: options.odata,
					params: options.buildParams?.(scope, args),
					options: {
						baseUrl: options.baseUrl,
						...options.buildOptions?.(scope, args)
					},
					init: options.buildInit?.(scope, args)
				} as PersistedODataRequest<"query", PersistedODataEntity<TResponse>, TResponse>,
				{ client, signal },
				options.executor
			);

			if (options.transform) {
				return options.transform(response.data, { scope, args });
			}

			return response.data as unknown as TResult;
		}
	};
}

export function createPersistedODataReadOperation<TScope, TArgs, TResponse, TResult = TResponse>(
	options: PersistedODataReadOperationOptions<TScope, TArgs, TResponse, TResult>
): PersistedQueryOperation<TScope, TArgs, TResult> {
	return {
		isEnabled: options.isEnabled,
		staleTime: options.staleTime,
		gcTime: options.gcTime,
		meta: options.meta,
		execute: async ({ scope, args, client, signal }) => {
			const response = await executePersistedOData<"read", PersistedODataEntity<TResponse>, TResponse>(
				"read",
				{
					odata: options.odata,
					params: options.buildParams?.(scope, args),
					options: {
						baseUrl: options.baseUrl,
						...options.buildOptions?.(scope, args)
					},
					init: options.buildInit?.(scope, args)
				} as PersistedODataRequest<"read", PersistedODataEntity<TResponse>, TResponse>,
				{ client, signal },
				options.executor
			);

			if (options.transform) {
				return options.transform(response.data, { scope, args });
			}

			return response.data as unknown as TResult;
		}
	};
}

/**
 * Создаёт mutation-операцию поверх OData transport.
 *
 * @example
 * ```ts
 * const saveOperation = createPersistedODataMutationOperation({
 *   odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_VARIANT" },
 *   method: "PUT",
 *   buildParams: (_, input) => ({
 *     variantId: { value: input.variantId }
 *   }),
 *   bodyMapper: (_, input) => input
 * });
 * ```
 */
export function createPersistedODataMutationOperation<TScope, TInput, TResponse, TResult = TResponse, TBody = unknown>(
	options: PersistedODataWriteOperationOptions<TScope, TInput, TBody, TResponse, TResult>
): PersistedMutationOperation<TScope, TInput, TResult> {
	return {
		cacheStrategy: options.cacheStrategy,
		execute: async ({ scope, input, client }) => {
			const response =
				options.method === "delete"
					? await executePersistedOData<"delete", never, TResponse>(
							options.method,
							{
								odata: options.odata,
								params: options.buildParams(scope, input),
								options: {
									baseUrl: options.baseUrl,
									...options.buildOptions?.(scope, input)
								},
								init: options.buildInit?.(scope, input)
							} as PersistedODataRequest<"delete", never, TResponse, PersistedODataEntity<TResponse>>,
							{ client },
							options.executor
						)
					: options.method === "update"
						? await executePersistedOData<"update", TBody, TResponse>(
								options.method,
								{
									odata: options.odata,
									params: options.buildParams(scope, input),
									body: options.bodyMapper(scope, input),
									options: {
										baseUrl: options.baseUrl,
										...options.buildOptions?.(scope, input)
									},
									init: options.buildInit?.(scope, input)
								} as PersistedODataRequest<"update", TBody, TResponse, PersistedODataEntity<TResponse>>,
								{ client },
								options.executor
							)
						: await executePersistedOData<"create", TBody, TResponse>(
								options.method,
								{
									odata: options.odata,
									body: options.bodyMapper(scope, input),
									options: {
										baseUrl: options.baseUrl,
										...options.buildOptions?.(scope, input)
									},
									init: options.buildInit?.(scope, input)
								} as PersistedODataRequest<"create", TBody, TResponse, PersistedODataEntity<TResponse>>,
								{ client },
								options.executor
							);

			if (options.transform) {
				return options.transform(response.data, { scope, input });
			}

			return response.data as unknown as TResult;
		}
	};
}
