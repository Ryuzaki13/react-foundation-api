import { createErrorReportQueue, ERROR_REPORT_QUEUE_LEASE_MS, type ErrorReportPayload } from "@ryuzaki13/react-foundation-lib/error-report";
import { indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { createErrorReportDeliveryCoordinator } from "./deliveryCoordinator";
import { ErrorReportDeliveryHttpError } from "./deliveryFailure";

const INITIAL_NOW = new Date("2026-09-09T06:00:00.000Z");

function createPayload(index = 1): ErrorReportPayload {
	return {
		payloadVersion: 1,
		application: "ru.education-system",
		reportId: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
		sessionId: "10000000-0000-4000-8000-000000000001",
		createdUtc: INITIAL_NOW.toISOString(),
		category: "runtime",
		source: "coordinator-test",
		error: { name: "Error", message: `Ошибка ${index}` },
		environment: { mode: "production", buildId: "commit-sha" },
		breadcrumbs: []
	};
}

function createQueue() {
	const queue = createErrorReportQueue({ indexedDB, dbName: `delivery-coordinator-${crypto.randomUUID()}` });
	if (!queue) throw new Error("IndexedDB queue не создана в тесте");
	return queue;
}

describe("createErrorReportDeliveryCoordinator", () => {
	it("подтверждает успешную доставку и удаляет queue record", async () => {
		const queue = createQueue();
		const adapter = vi.fn().mockResolvedValue(undefined);
		await queue.enqueue(createPayload(), INITIAL_NOW);
		const coordinator = createErrorReportDeliveryCoordinator({
			queue,
			adapter,
			ownerId: "tab-1",
			now: () => INITIAL_NOW
		});

		await expect(coordinator.flush()).resolves.toEqual({
			delivered: 1,
			retried: 0,
			discarded: 0,
			leaseLost: 0,
			storageFailures: 0
		});
		expect(adapter).toHaveBeenCalledOnce();
		expect(adapter.mock.calls[0]?.[1]).toMatchObject({ attemptCount: 1, signal: expect.any(AbortSignal) });
		await expect(queue.getRecords(INITIAL_NOW)).resolves.toEqual([]);
	});

	it("удаляет terminal 4xx и не сохраняет response text", async () => {
		const queue = createQueue();
		const events = vi.fn();
		await queue.enqueue(createPayload(), INITIAL_NOW);
		const coordinator = createErrorReportDeliveryCoordinator({
			queue,
			adapter: vi.fn().mockRejectedValue(new ErrorReportDeliveryHttpError(422)),
			ownerId: "tab-1",
			now: () => INITIAL_NOW,
			onEvent: events
		});

		await expect(coordinator.flush()).resolves.toMatchObject({ discarded: 1, retried: 0 });
		expect(events).toHaveBeenCalledWith({ type: "discarded", reportId: createPayload().reportId, httpStatus: 422 });
		await expect(queue.getRecords(INITIAL_NOW)).resolves.toEqual([]);
	});

	it("переносит retryable failure по exponential policy", async () => {
		const queue = createQueue();
		await queue.enqueue(createPayload(), INITIAL_NOW);
		const coordinator = createErrorReportDeliveryCoordinator({
			queue,
			adapter: vi.fn().mockRejectedValue(new TypeError("network offline")),
			ownerId: "tab-1",
			now: () => INITIAL_NOW,
			random: () => 0.5
		});

		await expect(coordinator.flush()).resolves.toMatchObject({ retried: 1 });
		await expect(queue.getRecords(INITIAL_NOW)).resolves.toMatchObject([
			{
				nextAttemptUtc: new Date(INITIAL_NOW.getTime() + 5_000).toISOString(),
				attemptCount: 1,
				lease: undefined,
				lastFailure: { kind: "network" }
			}
		]);
	});

	it("повторяет reportId после потерянного acknowledgement", async () => {
		const queue = createQueue();
		const acknowledge = queue.acknowledge;
		let shouldFailAcknowledgement = true;
		let currentNow = INITIAL_NOW;
		await queue.enqueue(createPayload(), currentNow);
		const adapter = vi.fn().mockResolvedValue(undefined);
		const coordinator = createErrorReportDeliveryCoordinator({
			queue: {
				...queue,
				acknowledge: async (...args) => {
					if (shouldFailAcknowledgement) {
						shouldFailAcknowledgement = false;
						throw new DOMException("write failed", "UnknownError");
					}
					return acknowledge(...args);
				}
			},
			adapter,
			ownerId: "tab-1",
			now: () => currentNow
		});

		await expect(coordinator.flush()).resolves.toMatchObject({ delivered: 0, storageFailures: 1 });
		currentNow = new Date(INITIAL_NOW.getTime() + ERROR_REPORT_QUEUE_LEASE_MS + 1);
		await expect(coordinator.flush()).resolves.toMatchObject({ delivered: 1 });
		expect(adapter).toHaveBeenCalledTimes(2);
		expect(adapter.mock.calls[0]?.[0].reportId).toBe(adapter.mock.calls[1]?.[0].reportId);
	});

	it("обрывает зависший adapter раньше lease и планирует timeout retry", async () => {
		const queue = createQueue();
		await queue.enqueue(createPayload(), INITIAL_NOW);
		const adapter = vi.fn(
			(_body, context) =>
				new Promise<void>((_resolve, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason)))
		);
		const coordinator = createErrorReportDeliveryCoordinator({
			queue,
			adapter,
			ownerId: "tab-1",
			now: () => INITIAL_NOW,
			deliveryTimeoutMs: 5,
			leaseDurationMs: 50,
			random: () => 0.5
		});

		await expect(coordinator.flush()).resolves.toMatchObject({ retried: 1 });
		await expect(queue.getRecords(INITIAL_NOW)).resolves.toMatchObject([{ lastFailure: { kind: "timeout" } }]);
	});

	it("возвращает storage-error из enqueue без исключения и recursion context", async () => {
		const queue = createQueue();
		const events = vi.fn();
		const coordinator = createErrorReportDeliveryCoordinator({
			queue: { ...queue, enqueue: vi.fn().mockRejectedValue(new DOMException("quota", "QuotaExceededError")) },
			adapter: vi.fn(),
			onEvent: events
		});

		await expect(coordinator.enqueue(createPayload())).resolves.toEqual({ status: "storage-error" });
		expect(events).toHaveBeenCalledWith({ type: "storage-failure", stage: "enqueue" });
	});
});
