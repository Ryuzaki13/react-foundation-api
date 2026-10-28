import { createResourceKeys } from "../resource";

import {
	PERSISTED_OPERATION_LIST,
	PERSISTED_OPERATION_LATEST,
	PERSISTED_OPERATION_HISTORY,
	PERSISTED_OPERATION_SAVE,
	PERSISTED_OPERATION_CREATE,
	PERSISTED_OPERATION_DELETE
} from "./persistedOperationConstants";

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
		list: (value) => keys.operation(PERSISTED_OPERATION_LIST, value),
		latest: (value) => keys.operation(PERSISTED_OPERATION_LATEST, value),
		history: (value, args) => keys.operation(PERSISTED_OPERATION_HISTORY, value, args),
		save: (value) => keys.operation(PERSISTED_OPERATION_SAVE, value),
		create: (value) => keys.operation(PERSISTED_OPERATION_CREATE, value),
		delete: (value) => keys.operation(PERSISTED_OPERATION_DELETE, value)
	};
}
