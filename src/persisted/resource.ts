import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { applyPersistedCacheStrategy } from "./cache";
import { createPersistedRecordKeys } from "./keys";

import type {
	CreatePersistedResourceDescriptorOptions,
	PersistedCacheStrategy,
	PersistedMutationOperation,
	PersistedQueryOperation,
	PersistedReadOperationName,
	PersistedResourceDescriptor,
	PersistedTransportAdapter,
	PersistedWriteOperationName
} from "./types";

/**
 * Внутренний тип descriptor-а, гарантированно содержащего нужную read-capability.
 */
type ReadDescriptor<TScope, TArgs, TResult, TOperation extends PersistedReadOperationName> = PersistedResourceDescriptor<
	TScope,
	PersistedTransportAdapter<TScope> & {
		[K in TOperation]-?: PersistedQueryOperation<TScope, TArgs, TResult>;
	}
>;

/**
 * Внутренний тип descriptor-а, гарантированно содержащего нужную write-capability.
 */
type WriteDescriptor<TScope, TInput, TResult, TOperation extends PersistedWriteOperationName> = PersistedResourceDescriptor<
	TScope,
	PersistedTransportAdapter<TScope> & {
		[K in TOperation]-?: PersistedMutationOperation<TScope, TInput, TResult>;
	}
>;

/**
 * Дополнительные настройки доменного mutation-хука.
 */
interface UsePersistedMutationOptions<TScope, TInput, TResult> {
	/**
	 * Позволяет переопределить стандартную cache policy descriptor-а.
	 *
	 * Если передать `null`, базовая strategy ресурса будет отключена.
	 */
	cacheStrategy?: PersistedCacheStrategy<TScope, TInput, TResult> | null;

	/**
	 * Доменный post-success callback, который запускается после cache strategy.
	 */
	onSuccess?: (result: TResult, input: TInput) => void | Promise<void>;
}

/**
 * Проверяет валидность scope и возвращает его в суженном виде.
 */
function assertPersistedScope<TScope, TTransport extends PersistedTransportAdapter<TScope>>(
	descriptor: PersistedResourceDescriptor<TScope, TTransport>,
	scope: TScope | null | undefined
): TScope {
	if (scope !== null && scope !== undefined && (descriptor.isEnabled?.(scope) ?? true)) {
		return scope;
	}

	throw new Error(descriptor.getScopeError?.(scope) ?? "Недостаточно данных scope для persisted-record ресурса.");
}

/**
 * Извлекает read-операцию из descriptor-а и даёт раннюю ошибку, если capability
 * не была подключена.
 */
function assertReadOperation<
	TScope,
	TArgs,
	TResult,
	TOperation extends PersistedReadOperationName,
	TTransport extends PersistedTransportAdapter<TScope>
>(descriptor: PersistedResourceDescriptor<TScope, TTransport>, operationName: TOperation): PersistedQueryOperation<TScope, TArgs, TResult> {
	const operation = descriptor.transport[operationName];
	if (!operation) {
		throw new Error(`Persisted-record ресурс '${descriptor.resource}' не поддерживает операцию '${operationName}'.`);
	}

	return operation as PersistedQueryOperation<TScope, TArgs, TResult>;
}

/**
 * Извлекает write-операцию из descriptor-а и даёт раннюю ошибку, если capability
 * не была подключена.
 */
function assertWriteOperation<
	TScope,
	TInput,
	TResult,
	TOperation extends PersistedWriteOperationName,
	TTransport extends PersistedTransportAdapter<TScope>
>(
	descriptor: PersistedResourceDescriptor<TScope, TTransport>,
	operationName: TOperation
): PersistedMutationOperation<TScope, TInput, TResult> {
	const operation = descriptor.transport[operationName];
	if (!operation) {
		throw new Error(`Persisted-record ресурс '${descriptor.resource}' не поддерживает операцию '${operationName}'.`);
	}

	return operation as PersistedMutationOperation<TScope, TInput, TResult>;
}

/**
 * Строит ключ query/mutation для конкретной операции descriptor-а.
 */
function buildPersistedOperationKey<TScope, TTransport extends PersistedTransportAdapter<TScope>>(
	descriptor: PersistedResourceDescriptor<TScope, TTransport>,
	operationName: PersistedReadOperationName | PersistedWriteOperationName,
	scope: TScope | null | undefined,
	args?: unknown
) {
	return descriptor.keys.operation(operationName, scope, args);
}

/**
 * Вычисляет итоговый `enabled` для query.
 *
 * Учитываются:
 * - общая policy descriptor-а;
 * - локальная policy самой операции.
 */
function resolvePersistedQueryEnabled<TScope, TArgs>(
	descriptor: PersistedResourceDescriptor<TScope>,
	operation: PersistedQueryOperation<TScope, TArgs, unknown>,
	scope: TScope | null | undefined,
	args: TArgs
) {
	if (!(descriptor.isEnabled?.(scope) ?? true)) {
		return false;
	}

	return operation.isEnabled?.(scope, args) ?? true;
}

/**
 * Собирает `queryOptions` для read-операции descriptor-а.
 */
function buildPersistedQueryOptions<TScope, TArgs, TResult, TOperation extends PersistedReadOperationName>(
	descriptor: ReadDescriptor<TScope, TArgs, TResult, TOperation>,
	operationName: TOperation,
	scope: TScope | null | undefined,
	args: TArgs
) {
	const operation = assertReadOperation(descriptor, operationName) as PersistedQueryOperation<TScope, TArgs, TResult>;
	const enabled = resolvePersistedQueryEnabled(descriptor, operation, scope, args);

	return queryOptions({
		queryKey: buildPersistedOperationKey(descriptor, operationName, scope, args),
		queryFn: ({ client, signal }) => {
			const resolvedScope = assertPersistedScope(descriptor, scope);
			return operation.execute({ scope: resolvedScope, args, client, signal });
		},
		enabled,
		staleTime: operation.staleTime,
		gcTime: operation.gcTime,
		meta: operation.meta
	});
}

/**
 * Общий read-хук для persisted-record операций.
 */
function usePersistedQuery<TScope, TArgs, TResult, TOperation extends PersistedReadOperationName>(
	descriptor: ReadDescriptor<TScope, TArgs, TResult, TOperation>,
	operationName: TOperation,
	scope: TScope | null | undefined,
	args: TArgs
) {
	return useQuery(buildPersistedQueryOptions(descriptor, operationName, scope, args));
}

/**
 * Императивный helper для preload/prefetch сценариев через `QueryClient`.
 */
async function getPersistedQueryData<TScope, TArgs, TResult, TOperation extends PersistedReadOperationName>(
	descriptor: ReadDescriptor<TScope, TArgs, TResult, TOperation>,
	operationName: TOperation,
	scope: TScope | null | undefined,
	args: TArgs,
	queryClient: QueryClient
) {
	return await queryClient.fetchQuery(buildPersistedQueryOptions(descriptor, operationName, scope, args));
}

/**
 * Общий mutation-хук для persisted-record операций.
 *
 * Он выполняет transport-specific мутацию, затем применяет cache strategy и
 * только после этого запускает опциональный доменный `onSuccess`.
 */
function usePersistedMutation<TScope, TInput, TResult, TOperation extends PersistedWriteOperationName>(
	descriptor: WriteDescriptor<TScope, TInput, TResult, TOperation>,
	operationName: TOperation,
	scope: TScope | null | undefined,
	options?: UsePersistedMutationOptions<TScope, TInput, TResult>
) {
	const client = useQueryClient();
	const operation = assertWriteOperation(descriptor, operationName) as PersistedMutationOperation<TScope, TInput, TResult>;

	return useMutation({
		mutationKey: buildPersistedOperationKey(descriptor, operationName, scope),
		mutationFn: async (input: TInput) => {
			const resolvedScope = assertPersistedScope(descriptor, scope);
			return await operation.execute({ scope: resolvedScope, input, client });
		},
		onSuccess: async (result, input) => {
			const resolvedScope = assertPersistedScope(descriptor, scope);
			const cacheStrategy = options?.cacheStrategy === undefined ? operation.cacheStrategy : options.cacheStrategy;

			await applyPersistedCacheStrategy(cacheStrategy, {
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

/**
 * Создаёт descriptor persisted-record ресурса.
 *
 * @example
 * ```ts
 * const resource = createPersistedResourceDescriptor({
 *   namespace: "viewConfig",
 *   resource: "view",
 *   normalizeScope: (scope) => ({
 *     appId: scope?.appId?.trim() ?? "",
 *     viewId: scope?.viewId?.trim() ?? ""
 *   }),
 *   isEnabled: (scope) => Boolean(scope?.appId && scope?.viewId),
 *   transport: {
 *     latest: createPersistedODataQueryOperation({ ... })
 *   }
 * });
 * ```
 */
export function createPersistedResourceDescriptor<
	TScope,
	TTransport extends PersistedTransportAdapter<TScope> = PersistedTransportAdapter<TScope>
>(options: CreatePersistedResourceDescriptorOptions<TScope, TTransport>): PersistedResourceDescriptor<TScope, TTransport> {
	return {
		namespace: options.namespace,
		resource: options.resource,
		keys: createPersistedRecordKeys({
			namespace: options.namespace,
			resource: options.resource,
			normalizeScope: options.normalizeScope
		}),
		transport: options.transport,
		isEnabled: options.isEnabled,
		getScopeError: options.getScopeError
	};
}

/**
 * Подключает capability `list` к `useQuery`.
 */
export function usePersistedListQuery<TScope, TResult>(
	descriptor: ReadDescriptor<TScope, void, TResult, "list">,
	scope: TScope | null | undefined
) {
	return usePersistedQuery(descriptor, "list", scope, undefined);
}

/**
 * Подключает capability `latest` к `useQuery`.
 */
export function usePersistedLatestQuery<TScope, TResult>(
	descriptor: ReadDescriptor<TScope, void, TResult, "latest">,
	scope: TScope | null | undefined
) {
	return usePersistedQuery(descriptor, "latest", scope, undefined);
}

/**
 * Подключает capability `history` к `useQuery`.
 */
export function usePersistedHistoryQuery<TScope, TArgs, TResult>(
	descriptor: ReadDescriptor<TScope, TArgs, TResult, "history">,
	scope: TScope | null | undefined,
	args: TArgs
) {
	return usePersistedQuery(descriptor, "history", scope, args);
}

/**
 * Императивно загружает capability `list` через `QueryClient`.
 */
export async function getPersistedListData<TScope, TResult>(
	descriptor: ReadDescriptor<TScope, void, TResult, "list">,
	scope: TScope | null | undefined,
	queryClient: QueryClient
) {
	return await getPersistedQueryData(descriptor, "list", scope, undefined, queryClient);
}

/**
 * Императивно загружает capability `latest` через `QueryClient`.
 */
export async function getPersistedLatestData<TScope, TResult>(
	descriptor: ReadDescriptor<TScope, void, TResult, "latest">,
	scope: TScope | null | undefined,
	queryClient: QueryClient
) {
	return await getPersistedQueryData(descriptor, "latest", scope, undefined, queryClient);
}

/**
 * Императивно загружает capability `history` через `QueryClient`.
 */
export async function getPersistedHistoryData<TScope, TArgs, TResult>(
	descriptor: ReadDescriptor<TScope, TArgs, TResult, "history">,
	scope: TScope | null | undefined,
	args: TArgs,
	queryClient: QueryClient
) {
	return await getPersistedQueryData(descriptor, "history", scope, args, queryClient);
}

/**
 * Подключает capability `save` к `useMutation`.
 */
export function usePersistedSaveMutation<TScope, TInput, TResult>(
	descriptor: WriteDescriptor<TScope, TInput, TResult, "save">,
	scope: TScope | null | undefined,
	options?: UsePersistedMutationOptions<TScope, TInput, TResult>
) {
	return usePersistedMutation(descriptor, "save", scope, options);
}

/**
 * Подключает capability `create` к `useMutation`.
 */
export function usePersistedCreateMutation<TScope, TInput, TResult>(
	descriptor: WriteDescriptor<TScope, TInput, TResult, "create">,
	scope: TScope | null | undefined,
	options?: UsePersistedMutationOptions<TScope, TInput, TResult>
) {
	return usePersistedMutation(descriptor, "create", scope, options);
}

/**
 * Подключает capability `delete` к `useMutation`.
 */
export function usePersistedDeleteMutation<TScope, TInput, TResult>(
	descriptor: WriteDescriptor<TScope, TInput, TResult, "delete">,
	scope: TScope | null | undefined,
	options?: UsePersistedMutationOptions<TScope, TInput, TResult>
) {
	return usePersistedMutation(descriptor, "delete", scope, options);
}
