import { describe, expect, it } from "vitest";

import { createPersistedJsonCodec, parsePersistedJson, stringifyPersistedJson } from "./payload";

describe("persisted-record payload codec", () => {
	it("разбирает и сериализует JSON payload", () => {
		const value = { id: "demo", flags: [1, 2, 3] };

		expect(parsePersistedJson<typeof value>(stringifyPersistedJson(value))).toEqual(value);
	});

	it("возвращает null для пустого и битого payload", () => {
		expect(parsePersistedJson(null)).toBeNull();
		expect(parsePersistedJson(undefined)).toBeNull();
		expect(parsePersistedJson("{broken")).toBeNull();
	});

	it("создаёт codec с ожидаемым контрактом", () => {
		const codec = createPersistedJsonCodec<{ value: string }>();

		expect(codec.stringify({ value: "ok" })).toBe('{"value":"ok"}');
		expect(codec.parse('{"value":"ok"}')).toEqual({ value: "ok" });
	});
});
