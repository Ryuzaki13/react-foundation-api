import { createResourceKeys } from "../resource";

import type { PersistedOperationName, PersistedRecordKeys } from "./types";

/**
 * Создаёт фабрики query key для persisted-record ресурса.
 *
 * @example
 * ```ts
 * const keys = createPersistedRecordKeys<{ appId: string; viewId: string }>({
 *   namespace: "viewConfig",
 *   resource: "view"
 * });
 *
 * keys.latest({ appId: "APP", viewId: "MAIN" });
 * // => ["viewConfig", "view", { appId: "sales", viewId: "CumulativeShipment" }, "latest"]
 * ```
 */
export function createPersistedRecordKeys<TScope>(options: {
	namespace: string;
	resource: string;
	normalizeScope?: (scope: TScope | null | undefined) => unknown;
}): PersistedRecordKeys<TScope> {
	const keys = createResourceKeys<TScope, PersistedOperationName>(options);

	return {
		...keys,
		list: (value) => keys.operation("list", value),
		latest: (value) => keys.operation("latest", value),
		history: (value, args) => keys.operation("history", value, args),
		save: (value) => keys.operation("save", value),
		create: (value) => keys.operation("create", value),
		delete: (value) => keys.operation("delete", value)
	};
}
