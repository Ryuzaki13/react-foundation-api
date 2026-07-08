import { type QueryClient } from "@tanstack/react-query";

import { type ResourceMutationOperation, type ResourceQueryOperation } from "../resource";

/**
 * Минимальный client-safe контракт TanStack Start server function.
 *
 * Shared-слой намеренно не импортирует `@tanstack/react-start`: в `SAP`
 * этот пакет не является зависимостью, а в SSR-проекте конкретная serverFn
 * вызывается с публичной формой `{ data }`.
 */
export type ServerFnTransport<TData, TResponse> = (request: ServerFnTransportRequest<TData>) => Promise<TResponse>;

/**
 * Нормализованная форма вызова serverFn.
 */
export interface ServerFnTransportRequest<TData> {
	readonly data: TData;
}

/**
 * Контекст низкоуровневого serverFn executor.
 */
export interface ServerFnTransportExecutorContext {
	readonly client: QueryClient;
	readonly signal?: AbortSignal;
}

/**
 * Низкоуровневый executor нужен для тестов и нестандартных сценариев, где
 * вызов serverFn должен быть обёрнут дополнительной инфраструктурой проекта.
 */
export type ServerFnTransportExecutor<TData, TResponse> = (
	serverFn: ServerFnTransport<TData, TResponse>,
	request: ServerFnTransportRequest<TData>,
	context: ServerFnTransportExecutorContext
) => Promise<TResponse>;

interface ServerFnQueryOperationBaseOptions<TScope, TArgs, TData, TResponse> {
	readonly serverFn: ServerFnTransport<TData, TResponse>;
	readonly buildData: (scope: TScope, args: TArgs) => TData;
	readonly executor?: ServerFnTransportExecutor<TData, TResponse>;
	readonly staleTime?: number;
	readonly gcTime?: number;
	readonly isEnabled?: (scope: TScope | null | undefined, args: TArgs) => boolean;
}

type ServerFnQueryOperationOptions<TScope, TArgs, TData, TResponse> = ServerFnQueryOperationBaseOptions<TScope, TArgs, TData, TResponse>;

type ServerFnMappedQueryOperationOptions<TScope, TArgs, TData, TResponse, TResult> = ServerFnQueryOperationBaseOptions<
	TScope,
	TArgs,
	TData,
	TResponse
> & {
	readonly transform: (data: TResponse, context: { readonly scope: TScope; readonly args: TArgs }) => TResult;
};

interface ServerFnMutationOperationBaseOptions<TScope, TInput, TData, TResponse> {
	readonly serverFn: ServerFnTransport<TData, TResponse>;
	readonly buildData: (scope: TScope, input: TInput) => TData;
	readonly executor?: ServerFnTransportExecutor<TData, TResponse>;
}

type ServerFnMutationOperationOptions<TScope, TInput, TData, TResponse, TDescriptor> = ServerFnMutationOperationBaseOptions<
	TScope,
	TInput,
	TData,
	TResponse
> & {
	readonly cacheStrategy?: ResourceMutationOperation<TScope, TInput, TResponse, TDescriptor>["cacheStrategy"];
};

type ServerFnMappedMutationOperationOptions<TScope, TInput, TData, TResponse, TResult, TDescriptor> = ServerFnMutationOperationBaseOptions<
	TScope,
	TInput,
	TData,
	TResponse
> & {
	readonly transform: (data: TResponse, context: { readonly scope: TScope; readonly input: TInput }) => TResult;
	readonly cacheStrategy?: ResourceMutationOperation<TScope, TInput, TResult, TDescriptor>["cacheStrategy"];
};

async function executeServerFnTransport<TData, TResponse>(
	serverFn: ServerFnTransport<TData, TResponse>,
	request: ServerFnTransportRequest<TData>,
	context: ServerFnTransportExecutorContext,
	executor?: ServerFnTransportExecutor<TData, TResponse>
) {
	const run =
		executor ??
		((currentServerFn: ServerFnTransport<TData, TResponse>, currentRequest: ServerFnTransportRequest<TData>) =>
			currentServerFn(currentRequest));

	return await run(serverFn, request, context);
}

export function createServerFnQueryOperation<TScope, TArgs, TData, TResponse>(
	options: ServerFnQueryOperationOptions<TScope, TArgs, TData, TResponse>
): ResourceQueryOperation<TScope, TArgs, TResponse>;

export function createServerFnQueryOperation<TScope, TArgs, TData, TResponse, TResult>(
	options: ServerFnMappedQueryOperationOptions<TScope, TArgs, TData, TResponse, TResult>
): ResourceQueryOperation<TScope, TArgs, TResult>;

/**
 * Создаёт read-operation поверх TanStack Start serverFn.
 */
export function createServerFnQueryOperation<TScope, TArgs, TData, TResponse, TResult>(
	options:
		| ServerFnQueryOperationOptions<TScope, TArgs, TData, TResponse>
		| ServerFnMappedQueryOperationOptions<TScope, TArgs, TData, TResponse, TResult>
): ResourceQueryOperation<TScope, TArgs, TResponse | TResult> {
	return {
		isEnabled: options.isEnabled,
		staleTime: options.staleTime,
		gcTime: options.gcTime,
		execute: async ({ scope, args, client, signal }) => {
			const response = await executeServerFnTransport(
				options.serverFn,
				{ data: options.buildData(scope, args) },
				{ client, signal },
				options.executor
			);

			if ("transform" in options) {
				return options.transform(response, { scope, args });
			}

			return response;
		}
	};
}

export function createServerFnMutationOperation<TScope, TInput, TData, TResponse, TDescriptor>(
	options: ServerFnMutationOperationOptions<TScope, TInput, TData, TResponse, TDescriptor>
): ResourceMutationOperation<TScope, TInput, TResponse, TDescriptor>;

export function createServerFnMutationOperation<TScope, TInput, TData, TResponse, TResult, TDescriptor>(
	options: ServerFnMappedMutationOperationOptions<TScope, TInput, TData, TResponse, TResult, TDescriptor>
): ResourceMutationOperation<TScope, TInput, TResult, TDescriptor>;

/**
 * Создаёт write-operation поверх TanStack Start serverFn.
 */
export function createServerFnMutationOperation<TScope, TInput, TData, TResponse, TResult, TDescriptor>(
	options:
		| ServerFnMutationOperationOptions<TScope, TInput, TData, TResponse, TDescriptor>
		| ServerFnMappedMutationOperationOptions<TScope, TInput, TData, TResponse, TResult, TDescriptor>
): ResourceMutationOperation<TScope, TInput, TResponse | TResult, TDescriptor> {
	return {
		cacheStrategy: options.cacheStrategy,
		execute: async ({ scope, input, client }) => {
			const response = await executeServerFnTransport(
				options.serverFn,
				{ data: options.buildData(scope, input) },
				{ client },
				options.executor
			);

			if ("transform" in options) {
				return options.transform(response, { scope, input });
			}

			return response;
		}
	};
}
