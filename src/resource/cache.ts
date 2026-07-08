import type { ResourceCacheStrategy, ResourceCacheStrategyContext, ResourceSetQueryDataStrategyOptions } from "./types";

/**
 * Безопасно применяет cache strategy, если она была передана.
 */
export async function applyResourceCacheStrategy<TScope, TInput, TResult, TDescriptor>(
	strategy: ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> | null | undefined,
	context: ResourceCacheStrategyContext<TScope, TInput, TResult, TDescriptor>
) {
	await strategy?.onSuccess?.(context);
}

/**
 * Создаёт стратегию, инвалидирующую все query внутри одного scope ресурса.
 */
export function createInvalidateResourceScopeCacheStrategy<
	TScope,
	TInput,
	TResult,
	TDescriptor extends { readonly keys: { scope: (scope: TScope) => readonly unknown[] } }
>(): ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> {
	return {
		onSuccess: async ({ client, descriptor, scope }) => {
			await client.invalidateQueries({ queryKey: descriptor.keys.scope(scope) });
		}
	};
}

/**
 * Создаёт стратегию точечного обновления одного query через `setQueryData`.
 */
export function createSetResourceQueryDataCacheStrategy<TScope, TInput, TResult, TData, TDescriptor>(
	options: ResourceSetQueryDataStrategyOptions<TScope, TInput, TResult, TData, TDescriptor>
): ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> {
	return {
		onSuccess: ({ client, ...context }) => {
			client.setQueryData<TData>(options.getQueryKey({ client, ...context }), (current) =>
				options.update(current, { client, ...context })
			);
		}
	};
}

/**
 * Комбинирует несколько cache strategy в одну последовательную стратегию.
 */
export function composeResourceCacheStrategies<TScope, TInput, TResult, TDescriptor>(
	...strategies: Array<ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> | null | undefined>
): ResourceCacheStrategy<TScope, TInput, TResult, TDescriptor> {
	return {
		onSuccess: async (context) => {
			for (const strategy of strategies) {
				await strategy?.onSuccess?.(context);
			}
		}
	};
}
