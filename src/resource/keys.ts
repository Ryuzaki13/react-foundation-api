import type { ResourceKeys, ResourceKeyValue } from "./types";

/**
 * Рекурсивно нормализует значение для стабильного query key.
 */
export function normalizeResourceKeyValue(value: unknown): ResourceKeyValue {
	if (value === null || value === undefined) return null;

	if (typeof value === "string") {
		return value.trim();
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => normalizeResourceKeyValue(item));
	}

	if (typeof value === "object") {
		return Object.keys(value)
			.sort()
			.reduce<Record<string, ResourceKeyValue>>((acc, key) => {
				acc[key] = normalizeResourceKeyValue((value as Record<string, unknown>)[key]);
				return acc;
			}, {});
	}

	return String(value);
}

const defaultNormalizeScope = <TScope>(scope: TScope | null | undefined) => normalizeResourceKeyValue(scope ?? null);

/**
 * Создаёт фабрики query key для ресурса с произвольными operation names.
 */
export function createResourceKeys<TScope, TOperationName extends string = string>(options: {
	readonly namespace: string;
	readonly resource: string;
	readonly normalizeScope?: (scope: TScope | null | undefined) => unknown;
}): ResourceKeys<TScope, TOperationName> {
	const all = [options.namespace, options.resource] as const;
	const normalizeScope = options.normalizeScope ?? defaultNormalizeScope<TScope>;

	const scope = (value: TScope | null | undefined) => [...all, normalizeResourceKeyValue(normalizeScope(value))] as const;
	const operation = (name: TOperationName, value: TScope | null | undefined, args?: unknown) =>
		args === undefined ? ([...scope(value), name] as const) : ([...scope(value), name, normalizeResourceKeyValue(args)] as const);

	return {
		all,
		scope,
		operation
	};
}
