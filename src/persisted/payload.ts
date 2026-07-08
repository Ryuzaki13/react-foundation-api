import type { PersistedPayloadCodec } from "./types";

/**
 * Безопасно разбирает JSON payload сохранённой записи.
 *
 * Функция намеренно принимает только строку или `null/undefined`, чтобы нельзя
 * было случайно передать в parser весь record вместо поля `payload`.
 *
 * @example
 * ```ts
 * const payload = parsePersistedJson<{ columns: string[] }>('{"columns":["A","B"]}');
 * // => { columns: ["A", "B"] }
 * ```
 */
export function parsePersistedJson<T>(payload: string | null | undefined): T | null {
	if (!payload) return null;

	try {
		return JSON.parse(payload) as T;
	} catch {
		return null;
	}
}

/**
 * Сериализует доменную полезную нагрузку в JSON-строку.
 *
 * @example
 * ```ts
 * const raw = stringifyPersistedJson({ title: "Demo" });
 * // => '{"title":"Demo"}'
 * ```
 */
export function stringifyPersistedJson<T>(value: T): string {
	return JSON.stringify(value);
}

/**
 * Возвращает готовый codec для хранения payload в виде строки JSON.
 */
export function createPersistedJsonCodec<T>(): PersistedPayloadCodec<T> {
	return {
		parse: parsePersistedJson,
		stringify: stringifyPersistedJson
	};
}
