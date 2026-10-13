import { describe, expect, it } from "vitest";

import { createVersionedSnapshotCache } from "./index";

describe("createVersionedSnapshotCache", () => {
	it("возвращает одну опубликованную identity нескольким потребителям", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		const original = Object.freeze({ items: Object.freeze([{ id: "one" }]) });
		expect(cache.publish("scope", "7", original)).toBe(original);
		expect(cache.getExact("scope", "7")).toBe(original);
		expect(cache.getExact("scope", "0007")).toBe(original);
		expect(cache.publish("scope", "007", { items: [{ id: "other" }] })).toBe(original);
	});

	it("не подставляет другую revision или область при exact чтении", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		cache.publish("scope", "20", { value: "current" });
		expect(cache.getExact("scope", "19")).toBeUndefined();
		expect(cache.getExact("scope", "21")).toBeUndefined();
		expect(cache.getExact("other", "20")).toBeUndefined();
	});

	it("сохраняет новую revision после поздней публикации старого DB snapshot", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		const first = { value: "first" };
		const latest = { value: "latest" };
		const delayed = { value: "own old snapshot" };
		cache.publish("scope", "9", first);
		expect(cache.publish("scope", "10", latest)).toBe(latest);
		expect(cache.publish("scope", "9", delayed)).toBe(delayed);
		expect(cache.getExact("scope", "10")).toBe(latest);
		expect(cache.getExact("scope", "9")).toBeUndefined();
	});

	it("сравнивает огромные decimal revisions без потери точности", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 1 });
		const previous = {};
		const latest = {};
		cache.publish("scope", "900719925474099299999999999999999998", previous);
		cache.publish("scope", "900719925474099299999999999999999999", latest);
		expect(cache.publish("scope", "900719925474099299999999999999999998", previous)).toBe(previous);
		expect(cache.getExact("scope", "900719925474099299999999999999999999")).toBe(latest);
	});

	it("сохраняет LRU порядок при успешном чтении, не сканируя снимки", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		const first = {};
		const second = {};
		const third = {};
		cache.publish("first", "1", first);
		cache.publish("second", "1", second);
		cache.getExact("first", "1");
		cache.publish("third", "1", third);
		expect(cache.getExact("second", "1")).toBeUndefined();
		expect(cache.getExact("first", "1")).toBe(first);
		expect(cache.getExact("third", "1")).toBe(third);
	});

	it("публикация новой версии существующей области не вытесняет соседнюю", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		const neighbor = {};
		const latest = {};
		cache.publish("scope", "1", {});
		cache.publish("neighbor", "1", neighbor);
		cache.publish("scope", "2", latest);
		expect(cache.getExact("neighbor", "1")).toBe(neighbor);
		expect(cache.getExact("scope", "2")).toBe(latest);
	});

	it("mismatch и поздняя старая публикация не продлевают удержание новой версии", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		const newestScope = {};
		cache.publish("oldest", "10", {});
		cache.publish("newest", "1", newestScope);
		cache.getExact("oldest", "9");
		cache.publish("oldest", "9", {});
		cache.publish("third", "1", {});
		expect(cache.getExact("oldest", "10")).toBeUndefined();
		expect(cache.getExact("newest", "1")).toBe(newestScope);
	});

	it("одна и та же версия считается повторным использованием при publish", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 2 });
		const retained = {};
		cache.publish("first", "1", retained);
		cache.publish("second", "1", {});
		expect(cache.publish("first", "1", {})).toBe(retained);
		cache.publish("third", "1", {});
		expect(cache.getExact("second", "1")).toBeUndefined();
		expect(cache.getExact("first", "1")).toBe(retained);
	});

	it("разделяет независимые cache instances и допускает произвольные scope keys", () => {
		const first = createVersionedSnapshotCache<object>({ maxEntries: 3 });
		const second = createVersionedSnapshotCache<object>({ maxEntries: 3 });
		const snapshot = {};
		first.publish("__proto__", "0", snapshot);
		first.publish("constructor", "0", snapshot);
		expect(first.getExact("__proto__", "0")).toBe(snapshot);
		expect(first.getExact("constructor", "0")).toBe(snapshot);
		expect(second.getExact("__proto__", "0")).toBeUndefined();
	});

	it("clear освобождает области и позволяет заново заполнить cache", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 1 });
		cache.publish("first", "5", {});
		cache.clear();
		expect(cache.getExact("first", "5")).toBeUndefined();
		const snapshot = {};
		expect(cache.publish("first", "1", snapshot)).toBe(snapshot);
		expect(cache.getExact("first", "1")).toBe(snapshot);
	});

	it("eviction освобождает историю revision, поэтому позднее чтение начинает область заново", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 1 });
		cache.publish("evicted", "10", {});
		cache.publish("neighbor", "1", {});
		expect(cache.getExact("evicted", "10")).toBeUndefined();
		const oldSnapshot = {};
		expect(cache.publish("evicted", "9", oldSnapshot)).toBe(oldSnapshot);
		expect(cache.getExact("evicted", "9")).toBe(oldSnapshot);
		expect(cache.getExact("neighbor", "1")).toBeUndefined();
	});

	it("не читает содержимое opaque snapshot при публикации и exact lookup", () => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 1 });
		const snapshot = Object.freeze({
			get items(): never {
				throw new Error("Cache не должен обходить тело снимка.");
			}
		});
		expect(cache.publish("scope", "1", snapshot)).toBe(snapshot);
		expect(cache.getExact("scope", "1")).toBe(snapshot);
		expect(cache.publish("scope", "1", snapshot)).toBe(snapshot);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		"отклоняет некорректный бюджет %s",
		(maxEntries) => {
			expect(() => createVersionedSnapshotCache({ maxEntries })).toThrow(RangeError);
		}
	);

	it.each(["", "-1", "1.1", "1e3", " 1", "1 ", "+1"])("отклоняет некорректную revision %s", (revision) => {
		const cache = createVersionedSnapshotCache<object>({ maxEntries: 1 });
		expect(() => cache.publish("scope", revision, {})).toThrow(TypeError);
		expect(() => cache.getExact("scope", revision)).toThrow(TypeError);
	});
});
