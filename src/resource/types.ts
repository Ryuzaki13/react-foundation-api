import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Значение, безопасное для включения в TanStack Query key.
 */
export type ResourceKeyValue =
	| null
	| string
	| number
	| boolean
	| readonly ResourceKeyValue[]
	| {
			readonly [key: string]: ResourceKeyValue;
	  };

/**
 * Фабрика ключей generic-ресурса.
 */
export interface ResourceKeys<TScope, TOperationName extends string = string> {
	readonly all: readonly unknown[];
	scope: (scope: TScope | null | undefined) => readonly unknown[];
	operation: (name: TOperationName, scope: TScope | null | undefined, args?: unknown) => readonly unknown[];
}

/**
 * Контекст read-операции ресурса.
 */
export interface ResourceQueryOperationContext<TScope, TArgs> {
	readonly scope: TScope;
	readonly args: TArgs;
	readonly client: QueryClient;
	readonly signal?: AbortSignal;
}

/**
 * Контекст write-операции ресурса.
 */
export interface ResourceMutationOperationContext<TScope, TInput> {
	readonly scope: TScope;
	readonly input: TInput;
	readonly client: QueryClient;
}

/**
 * Read-операция ресурса с произвольным именем.
 */
export interface ResourceQueryOperation<TScope, TArgs, TResult> {
	execute(context: ResourceQueryOperationContext<TScope, TArgs>): Promise<TResult>;
	isEnabled?(scope: TScope | null | undefined, args: TArgs): boolean;
	readonly staleTime?: number;
	readonly gcTime?: number;
}

/**
 * Контекст cache strategy после успешной write-операции.
 */
export interface ResourceCacheStrategyContext<TScope, TInput, TResult, TDescriptor> {
	readonly client: QueryClient;
	readonly descriptor: TDescriptor;
	readonly scope: TScope;
	readonly input: TInput;
	readonly result: TResult;
}

/**
 * Политика синхронизации TanStack Query cache после write-операции.
 */
export interface ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> {
	onSuccess?(context: ResourceCacheStrategyContext<TScope, TInput, TResult, TDescriptor>): void | Promise<void>;
}

/**
 * Write-операция ресурса с произвольным именем.
 */
export interface ResourceMutationOperation<TScope, TInput, TResult, TDescriptor> {
	execute(context: ResourceMutationOperationContext<TScope, TInput>): Promise<TResult>;
	readonly cacheStrategy?: ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor>;
}

/**
 * Descriptor ресурса: scope policy, query keys и произвольные read/write операции.
 */
export interface ResourceDescriptor<TScope, TQueries extends object = object, TMutations extends object = object> {
	readonly namespace: string;
	readonly resource: string;
	readonly keys: ResourceKeys<TScope, Extract<keyof TQueries | keyof TMutations, string>>;
	readonly operations: {
		readonly queries: TQueries;
		readonly mutations: TMutations;
	};
	readonly isEnabled?: (scope: TScope | null | undefined) => boolean;
	readonly getScopeError?: (scope: TScope | null | undefined) => string | null;
}

/**
 * Параметры создания generic-resource descriptor-а.
 */
export interface CreateResourceDescriptorOptions<TScope, TQueries extends object = object, TMutations extends object = object> {
	readonly namespace: string;
	readonly resource: string;
	readonly operations: {
		readonly queries?: TQueries;
		readonly mutations?: TMutations;
	};
	readonly keys?: ResourceKeys<TScope, Extract<keyof TQueries | keyof TMutations, string>>;
	readonly normalizeScope?: (scope: TScope | null | undefined) => unknown;
	readonly isEnabled?: (scope: TScope | null | undefined) => boolean;
	readonly getScopeError?: (scope: TScope | null | undefined) => string | null;
}

export type ResourceQueryArgs<TOperation> = TOperation extends ResourceQueryOperation<unknown, infer TArgs, unknown> ? TArgs : never;

export type ResourceQueryResult<TOperation> = TOperation extends ResourceQueryOperation<unknown, unknown, infer TResult> ? TResult : never;

export type ResourceMutationInput<TOperation> =
	TOperation extends ResourceMutationOperation<unknown, infer TInput, unknown, unknown> ? TInput : never;

export type ResourceMutationResult<TOperation> =
	TOperation extends ResourceMutationOperation<unknown, unknown, infer TResult, unknown> ? TResult : never;

/**
 * Настройки mutation-хука ресурса.
 */
export interface UseResourceMutationOptions<TScope, TInput, TResult, TDescriptor> {
	readonly cacheStrategy?: ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> | null;
	readonly onSuccess?: (result: TResult, input: TInput) => void | Promise<void>;
}

/**
 * Настройки стратегии точечного обновления одного query.
 */
export interface ResourceSetQueryDataStrategyOptions<TScope, TInput, TResult, TData, TDescriptor> {
	getQueryKey: (context: ResourceCacheStrategyContext<TScope, TInput, TResult, TDescriptor>) => QueryKey;
	update: (current: TData | undefined, context: ResourceCacheStrategyContext<TScope, TInput, TResult, TDescriptor>) => TData;
}
