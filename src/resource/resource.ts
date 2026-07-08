import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { applyResourceCacheStrategy } from "./cache";
import { createResourceKeys } from "./keys";

import type {
	CreateResourceDescriptorOptions,
	ResourceDescriptor,
	ResourceMutationInput,
	ResourceMutationOperation,
	ResourceMutationResult,
	ResourceQueryArgs,
	ResourceQueryOperation,
	ResourceQueryResult,
	UseResourceMutationOptions
} from "./types";

function assertResourceScope<TScope, TQueries extends object, TMutations extends object>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	scope: TScope | null | undefined
): TScope {
	if (scope !== null && scope !== undefined && (descriptor.isEnabled?.(scope) ?? true)) {
		return scope;
	}

	throw new Error(descriptor.getScopeError?.(scope) ?? `Недостаточно данных scope для ресурса '${descriptor.resource}'.`);
}

function hasExecuteFunction(value: unknown): value is { readonly execute: (...args: readonly unknown[]) => unknown } {
	return typeof value === "object" && value !== null && "execute" in value && typeof value.execute === "function";
}

function isResourceQueryOperation<TScope, TArgs, TResult>(value: unknown): value is ResourceQueryOperation<TScope, TArgs, TResult> {
	return hasExecuteFunction(value);
}

function isResourceMutationOperation<TScope, TInput, TResult, TDescriptor>(
	value: unknown
): value is ResourceMutationOperation<TScope, TInput, TResult, TDescriptor> {
	return hasExecuteFunction(value);
}

function assertResourceQueryOperation<
	TScope,
	TQueries extends object,
	TMutations extends object,
	TOperationName extends Extract<keyof TQueries, string>
>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operationName: TOperationName
): ResourceQueryOperation<TScope, ResourceQueryArgs<TQueries[TOperationName]>, ResourceQueryResult<TQueries[TOperationName]>> {
	const operation = descriptor.operations.queries[operationName];
	if (
		!isResourceQueryOperation<TScope, ResourceQueryArgs<TQueries[TOperationName]>, ResourceQueryResult<TQueries[TOperationName]>>(
			operation
		)
	) {
		throw new Error(`Ресурс '${descriptor.resource}' не поддерживает read-операцию '${operationName}'.`);
	}

	return operation;
}

function assertResourceMutationOperation<
	TScope,
	TQueries extends object,
	TMutations extends object,
	TOperationName extends Extract<keyof TMutations, string>
>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operationName: TOperationName
): ResourceMutationOperation<
	TScope,
	ResourceMutationInput<TMutations[TOperationName]>,
	ResourceMutationResult<TMutations[TOperationName]>,
	ResourceDescriptor<TScope, TQueries, TMutations>
> {
	const operation = descriptor.operations.mutations[operationName];
	if (
		!isResourceMutationOperation<
			TScope,
			ResourceMutationInput<TMutations[TOperationName]>,
			ResourceMutationResult<TMutations[TOperationName]>,
			ResourceDescriptor<TScope, TQueries, TMutations>
		>(operation)
	) {
		throw new Error(`Ресурс '${descriptor.resource}' не поддерживает write-операцию '${operationName}'.`);
	}

	return operation;
}

function resolveResourceQueryEnabled<TScope, TArgs, TQueries extends object, TMutations extends object>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operation: ResourceQueryOperation<TScope, TArgs, unknown>,
	scope: TScope | null | undefined,
	args: TArgs
) {
	if (!(descriptor.isEnabled?.(scope) ?? true)) {
		return false;
	}

	return operation.isEnabled?.(scope, args) ?? true;
}

/**
 * Создаёт descriptor ресурса с произвольными read/write operation names.
 */
export function createResourceDescriptor<TScope, TQueries extends object = object, TMutations extends object = object>(
	options: CreateResourceDescriptorOptions<TScope, TQueries, TMutations>
): ResourceDescriptor<TScope, TQueries, TMutations> {
	return {
		namespace: options.namespace,
		resource: options.resource,
		keys:
			options.keys ??
			createResourceKeys<TScope, Extract<keyof TQueries | keyof TMutations, string>>({
				namespace: options.namespace,
				resource: options.resource,
				normalizeScope: options.normalizeScope
			}),
		operations: {
			queries: options.operations.queries ?? ({} as TQueries),
			mutations: options.operations.mutations ?? ({} as TMutations)
		},
		isEnabled: options.isEnabled,
		getScopeError: options.getScopeError
	};
}

/**
 * Создаёт read-operation без привязки к transport.
 */
export function createResourceQueryOperation<TScope, TArgs, TResult>(operation: ResourceQueryOperation<TScope, TArgs, TResult>) {
	return operation;
}

/**
 * Создаёт write-operation без привязки к transport.
 */
export function createResourceMutationOperation<TScope, TInput, TResult, TDescriptor>(
	operation: ResourceMutationOperation<TScope, TInput, TResult, TDescriptor>
) {
	return operation;
}

/**
 * Собирает `queryOptions` для read-операции ресурса.
 */
export function buildResourceQueryOptions<
	TScope,
	TQueries extends object,
	TMutations extends object,
	TOperationName extends Extract<keyof TQueries, string>
>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operationName: TOperationName,
	scope: TScope | null | undefined,
	args: ResourceQueryArgs<TQueries[TOperationName]>
) {
	const operation = assertResourceQueryOperation(descriptor, operationName);
	const enabled = resolveResourceQueryEnabled(descriptor, operation, scope, args);

	return queryOptions({
		queryKey: descriptor.keys.operation(operationName as Extract<keyof TQueries | keyof TMutations, string>, scope, args),
		queryFn: ({ client, signal }) => {
			const resolvedScope = assertResourceScope(descriptor, scope);
			return operation.execute({ scope: resolvedScope, args, client, signal });
		},
		enabled,
		staleTime: operation.staleTime,
		gcTime: operation.gcTime
	});
}

/**
 * Подключает read-операцию ресурса к `useQuery`.
 */
export function useResourceQuery<
	TScope,
	TQueries extends object,
	TMutations extends object,
	TOperationName extends Extract<keyof TQueries, string>
>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operationName: TOperationName,
	scope: TScope | null | undefined,
	args: ResourceQueryArgs<TQueries[TOperationName]>
) {
	return useQuery(buildResourceQueryOptions(descriptor, operationName, scope, args));
}

/**
 * Императивно загружает read-операцию ресурса через `QueryClient`.
 */
export async function getResourceQueryData<
	TScope,
	TQueries extends object,
	TMutations extends object,
	TOperationName extends Extract<keyof TQueries, string>
>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operationName: TOperationName,
	scope: TScope | null | undefined,
	args: ResourceQueryArgs<TQueries[TOperationName]>,
	queryClient: QueryClient
) {
	return await queryClient.fetchQuery(buildResourceQueryOptions(descriptor, operationName, scope, args));
}

/**
 * Подключает write-операцию ресурса к `useMutation`.
 */
export function useResourceMutation<
	TScope,
	TQueries extends object,
	TMutations extends object,
	TOperationName extends Extract<keyof TMutations, string>
>(
	descriptor: ResourceDescriptor<TScope, TQueries, TMutations>,
	operationName: TOperationName,
	scope: TScope | null | undefined,
	options?: UseResourceMutationOptions<
		TScope,
		ResourceMutationInput<TMutations[TOperationName]>,
		ResourceMutationResult<TMutations[TOperationName]>,
		ResourceDescriptor<TScope, TQueries, TMutations>
	>
) {
	const client = useQueryClient();
	const operation = assertResourceMutationOperation(descriptor, operationName);

	return useMutation({
		mutationKey: descriptor.keys.operation(operationName as Extract<keyof TQueries | keyof TMutations, string>, scope),
		mutationFn: async (input: ResourceMutationInput<TMutations[TOperationName]>) => {
			const resolvedScope = assertResourceScope(descriptor, scope);
			return await operation.execute({ scope: resolvedScope, input, client });
		},
		onSuccess: async (result, input) => {
			const resolvedScope = assertResourceScope(descriptor, scope);
			const cacheStrategy = options?.cacheStrategy === undefined ? operation.cacheStrategy : options.cacheStrategy;

			await applyResourceCacheStrategy(cacheStrategy, {
				client,
				descriptor,
				scope: resolvedScope,
				input,
				result
			});
			await options?.onSuccess?.(result, input);
		}
	});
}
