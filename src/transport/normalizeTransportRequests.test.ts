import { describe, expect, it } from "vitest";

import { normalizeTransportRequests } from "./normalizeTransportRequests";

describe("normalizeTransportRequests", () => {
	it("нормализует список запросов инструментальных средств", () => {
		expect(
			normalizeTransportRequests(
				[
					{ id: "DP0K970962", description: "Развертка не фифо", isDefaultRequest: false },
					{ id: "DP0K970966", description: " MIME типы ", isDefaultRequest: true }
				],
				"workbench"
			)
		).toEqual([
			{
				id: "DP0K970962",
				text: "Развертка не фифо",
				isDefaultRequest: false,
				type: "workbench"
			},
			{
				id: "DP0K970966",
				text: "MIME типы",
				isDefaultRequest: true,
				type: "workbench"
			}
		]);
	});

	it("отбрасывает пустые id и дубликаты", () => {
		expect(
			normalizeTransportRequests(
				[
					{ id: " ", description: "Пустой" },
					{ id: "DP0K973740", description: "CT" },
					{ id: "DP0K973740", description: "Дубликат" }
				],
				"customizing"
			)
		).toEqual([
			{
				id: "DP0K973740",
				text: "CT",
				isDefaultRequest: false,
				type: "customizing"
			}
		]);
	});

	it("сохраняет пустое описание пустой строкой", () => {
		expect(normalizeTransportRequests([{ id: "DP0K973740", description: "   " }], "customizing")).toEqual([
			{
				id: "DP0K973740",
				text: "",
				isDefaultRequest: false,
				type: "customizing"
			}
		]);
	});
});
