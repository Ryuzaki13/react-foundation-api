import type { PersistedCacheStrategy, PersistedCacheStrategyContext, PersistedSetQueryDataStrategyOptions } from "./types";

/**
 * Безопасно применяет cache strategy, если она была передана.
 */
export async function applyPersistedCacheStrategy<TScope, TInput, TResult>(
	strategy: PersistedCacheStrategy<TScope, TInput, TResult> | null | undefined,
	context: PersistedCacheStrategyContext<TScope, TInput, TResult>
) {
	await strategy?.onSuccess?.(context);
}

/**
 * Создаёт стратегию, инвалидирующую все query внутри одного scope.
 *
 * Это рекомендуемый default для ресурсов, где мутация может затронуть сразу
 * несколько представлений данных: `list`, `latest`, `history`.
 */
export function createInvalidatePersistedScopeCacheStrategy<TScope, TInput, TResult>(): PersistedCacheStrategy<TScope, TInput, TResult> {
	return {
		onSuccess: async ({ client, descriptor, scope }) => {
			await client.invalidateQueries({ queryKey: descriptor.keys.scope(scope) });
		}
	};
}

/**
 * Создаёт стратегию точечного обновления одного query через `setQueryData`.
 *
 * @example
 * ```ts
 * const strategy = createSetPersistedQueryDataCacheStrategy({
 *   getQueryKey: ({ descriptor, scope }) => descriptor.keys.latest(scope),
 *   update: (_, { result }) => result
 * });
 * ```
 */
export function createSetPersistedQueryDataCacheStrategy<TScope, TInput, TResult, TData>(
	options: PersistedSetQueryDataStrategyOptions<TScope, TInput, TResult, TData>
): PersistedCacheStrategy<TScope, TInput, TResult> {
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
export function composePersistedCacheStrategies<TScope, TInput, TResult>(
	...strategies: Array<PersistedCacheStrategy<TScope, TInput, TResult> | null | undefined>
): PersistedCacheStrategy<TScope, TInput, TResult> {
	return {
		onSuccess: async (context) => {
			for (const strategy of strategies) {
				await strategy?.onSuccess?.(context);
			}
		}
	};
}
