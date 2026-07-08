import { httpFetchPayload } from "../http";

import type { PersistedMutationOperation, PersistedQueryOperation } from "./types";

/**
 * Нормализованная форма REST-запроса, передаваемая executor-у.
 */
interface PersistedRestRequest {
	url: string;
	init?: RequestInit;
	baseUrl?: string;
}

/**
 * Низкоуровневый REST executor.
 *
 * Executor можно подменить в тестах и спец-сценариях. Если executor не задан,
 * адаптер использует чистый HTTP transport и требует явный parser ответа.
 */
type PersistedRestExecutor<TResponse> = (request: PersistedRestRequest) => Promise<TResponse>;

/**
 * Parser внешнего HTTP payload. REST-слой не приводит `unknown` к доменному типу
 * самостоятельно, чтобы не маскировать контракт endpoint-а.
 */
type PersistedRestResponseParser<TResponse> = (payload: unknown) => TResponse;

/**
 * Базовые опции для создания REST read-операции.
 */
interface PersistedRestReadOperationBaseOptions<TScope, TArgs, TResponse> {
	baseUrl?: string;
	buildUrl: (scope: TScope, args: TArgs) => string;
	buildInit?: (scope: TScope, args: TArgs) => RequestInit;
	parseResponse?: PersistedRestResponseParser<TResponse>;
	executor?: PersistedRestExecutor<TResponse>;
	staleTime?: number;
	gcTime?: number;
	isEnabled?: (scope: TScope | null | undefined, args: TArgs) => boolean;
}

type PersistedRestReadOperationOptions<TScope, TArgs, TResponse> = PersistedRestReadOperationBaseOptions<TScope, TArgs, TResponse>;

type PersistedRestMappedReadOperationOptions<TScope, TArgs, TResponse, TResult> = PersistedRestReadOperationBaseOptions<
	TScope,
	TArgs,
	TResponse
> & {
	transform: (data: TResponse, context: { scope: TScope; args: TArgs }) => TResult;
};

/**
 * Базовые опции для создания REST write-операции.
 */
interface PersistedRestWriteOperationBaseOptions<TScope, TInput, TResponse> {
	baseUrl?: string;
	buildUrl: (scope: TScope, input: TInput) => string;
	method: "POST" | "PUT" | "DELETE";
	buildInit?: (scope: TScope, input: TInput) => Omit<RequestInit, "method" | "body">;
	bodyMapper?: (scope: TScope, input: TInput) => unknown;
	parseResponse?: PersistedRestResponseParser<TResponse>;
	executor?: PersistedRestExecutor<TResponse>;
}

type PersistedRestWriteOperationOptions<TScope, TInput, TResponse> = PersistedRestWriteOperationBaseOptions<TScope, TInput, TResponse> & {
	cacheStrategy?: PersistedMutationOperation<TScope, TInput, TResponse>["cacheStrategy"];
};

type PersistedRestMappedWriteOperationOptions<TScope, TInput, TResponse, TResult> = PersistedRestWriteOperationBaseOptions<
	TScope,
	TInput,
	TResponse
> & {
	transform: (data: TResponse, context: { scope: TScope; input: TInput }) => TResult;
	cacheStrategy?: PersistedMutationOperation<TScope, TInput, TResult>["cacheStrategy"];
};

/**
 * Выполняет REST-запрос через executor или нейтральный HTTP transport.
 */
async function executePersistedRest<TResponse>(
	request: PersistedRestRequest,
	options: {
		executor?: PersistedRestExecutor<TResponse>;
		parseResponse?: PersistedRestResponseParser<TResponse>;
	}
) {
	if (options.executor) {
		return await options.executor(request);
	}

	if (!options.parseResponse) {
		throw new Error("REST persisted operation requires executor or parseResponse.");
	}

	const payload = await httpFetchPayload(request.url, {
		baseUrl: request.baseUrl,
		init: request.init
	});

	return options.parseResponse(payload);
}

/**
 * Создаёт read-операцию поверх обычного REST endpoint.
 */
export function createPersistedRestQueryOperation<TScope, TArgs, TResponse>(
	options: PersistedRestReadOperationOptions<TScope, TArgs, TResponse>
): PersistedQueryOperation<TScope, TArgs, TResponse>;

export function createPersistedRestQueryOperation<TScope, TArgs, TResponse, TResult>(
	options: PersistedRestMappedReadOperationOptions<TScope, TArgs, TResponse, TResult>
): PersistedQueryOperation<TScope, TArgs, TResult>;

export function createPersistedRestQueryOperation<TScope, TArgs, TResponse, TResult>(
	options:
		| PersistedRestReadOperationOptions<TScope, TArgs, TResponse>
		| PersistedRestMappedReadOperationOptions<TScope, TArgs, TResponse, TResult>
): PersistedQueryOperation<TScope, TArgs, TResponse | TResult> {
	return {
		isEnabled: options.isEnabled,
		staleTime: options.staleTime,
		gcTime: options.gcTime,
		execute: async ({ scope, args, signal }) => {
			const data = await executePersistedRest<TResponse>(
				{
					url: options.buildUrl(scope, args),
					baseUrl: options.baseUrl,
					init: {
						...options.buildInit?.(scope, args),
						signal
					}
				},
				{
					executor: options.executor,
					parseResponse: options.parseResponse
				}
			);

			if ("transform" in options) {
				return options.transform(data, { scope, args });
			}

			return data;
		}
	};
}

/**
 * Создаёт write-операцию поверх обычного REST endpoint.
 *
 * @example
 * ```ts
 * const savePreset = createPersistedRestMutationOperation({
 *   buildUrl: () => "/api/config-presets",
 *   method: "PUT",
 *   bodyMapper: (scope, input) => ({
 *     userId: scope.userId,
 *     payload: input.payload
 *   })
 * });
 * ```
 */
export function createPersistedRestMutationOperation<TScope, TInput, TResponse>(
	options: PersistedRestWriteOperationOptions<TScope, TInput, TResponse>
): PersistedMutationOperation<TScope, TInput, TResponse>;

export function createPersistedRestMutationOperation<TScope, TInput, TResponse, TResult>(
	options: PersistedRestMappedWriteOperationOptions<TScope, TInput, TResponse, TResult>
): PersistedMutationOperation<TScope, TInput, TResult>;

export function createPersistedRestMutationOperation<TScope, TInput, TResponse, TResult>(
	options:
		| PersistedRestWriteOperationOptions<TScope, TInput, TResponse>
		| PersistedRestMappedWriteOperationOptions<TScope, TInput, TResponse, TResult>
): PersistedMutationOperation<TScope, TInput, TResponse | TResult> {
	return {
		cacheStrategy: options.cacheStrategy,
		execute: async ({ scope, input }) => {
			const payload = options.bodyMapper?.(scope, input);
			const data = await executePersistedRest<TResponse>(
				{
					url: options.buildUrl(scope, input),
					baseUrl: options.baseUrl,
					init: {
						method: options.method,
						headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
						...options.buildInit?.(scope, input),
						body: payload === undefined ? undefined : JSON.stringify(payload)
					}
				},
				{
					executor: options.executor,
					parseResponse: options.parseResponse
				}
			);

			if ("transform" in options) {
				return options.transform(data, { scope, input });
			}

			return data;
		}
	};
}
