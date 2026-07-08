import { describe, expect, it } from "vitest";

import { createPersistedRecordKeys } from "./keys";

describe("persisted-record keys", () => {
	it("нормализует scope и аргументы операции", () => {
		const keys = createPersistedRecordKeys<{ appId: string; viewId: string }>({
			namespace: "demo",
			resource: "resource"
		});

		expect(keys.scope({ viewId: "  view  ", appId: " app " })).toEqual(["demo", "resource", { appId: "app", viewId: "view" }]);
		expect(keys.history({ appId: "app", viewId: "view" }, { offset: 10, limit: 5 })).toEqual([
			"demo",
			"resource",
			{ appId: "app", viewId: "view" },
			"history",
			{ limit: 5, offset: 10 }
		]);
	});
});
