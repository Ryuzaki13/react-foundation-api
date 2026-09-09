// @vitest-environment jsdom

import { createErrorReportQueue, type ErrorReportPayload } from "@ryuzaki13/react-foundation-lib/error-report";
import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createErrorReportDeliveryCoordinator } from "./deliveryCoordinator";

function createPayload(index: number): ErrorReportPayload {
	return {
		payloadVersion: 1,
		application: "ru.education-system",
		reportId: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
		sessionId: "10000000-0000-4000-8000-000000000001",
		createdUtc: "2026-09-09T06:00:00.000Z",
		category: "runtime",
		source: "browser-lifecycle-test",
		error: { name: "Error", message: `Ошибка ${index}` },
		environment: { mode: "production", buildId: "commit-sha" },
		breadcrumbs: []
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("browser delivery lifecycle", () => {
	it("отправляет при navigator.onLine=false и использует online event только для ускорения", async () => {
		Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
		const queue = createErrorReportQueue({ indexedDB, dbName: `delivery-browser-${crypto.randomUUID()}` });
		if (!queue) throw new Error("IndexedDB queue не создана в тесте");
		await queue.enqueue(createPayload(1));
		const adapter = vi.fn().mockResolvedValue(undefined);
		const coordinator = createErrorReportDeliveryCoordinator({ queue, adapter, idlePollMs: 60_000 });
		const stop = coordinator.start();

		await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
		await queue.enqueue(createPayload(2));
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(2));

		stop();
	});
});
