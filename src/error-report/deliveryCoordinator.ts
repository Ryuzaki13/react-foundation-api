import { uuidv4 } from "@ryuzaki13/react-foundation-lib/crypto";
import {
	ERROR_REPORT_QUEUE_LEASE_MS,
	type ErrorReportPayload,
	type ErrorReportQueue,
	type ErrorReportQueueEnqueueResult,
	type ErrorReportQueueRecord,
	type ErrorReportQueueTransitionResult
} from "@ryuzaki13/react-foundation-lib/error-report";

import { createErrorReportDeliveryBody, type ErrorReportDeliveryBody } from "./deliveryBody";
import { classifyErrorReportDeliveryFailure, ErrorReportDeliveryTimeoutError } from "./deliveryFailure";
import { calculateErrorReportRetryDelay } from "./retryPolicy";

export const ERROR_REPORT_DELIVERY_TIMEOUT_MS = 20 * 1_000;
export const ERROR_REPORT_DELIVERY_IDLE_POLL_MS = 30 * 1_000;
export const ERROR_REPORT_DELIVERY_MAX_BATCH_SIZE = 10;

export type ErrorReportDeliveryContext = {
	readonly signal: AbortSignal;
	readonly attemptCount: number;
};

export type ErrorReportDeliveryAdapter = (body: ErrorReportDeliveryBody, context: ErrorReportDeliveryContext) => Promise<void>;

export type ErrorReportDeliveryCoordinatorEvent =
	| { readonly type: "delivered"; readonly reportId: string }
	| { readonly type: "retry-scheduled"; readonly reportId: string; readonly nextAttemptUtc: string }
	| { readonly type: "discarded"; readonly reportId: string; readonly httpStatus?: number }
	| { readonly type: "lease-lost"; readonly reportId: string; readonly stage: "acknowledge" | "reschedule" | "discard" }
	| { readonly type: "storage-failure"; readonly stage: "enqueue" | "lease" | "acknowledge" | "reschedule" | "discard" | "schedule" };

export type ErrorReportDeliveryFlushResult = {
	readonly delivered: number;
	readonly retried: number;
	readonly discarded: number;
	readonly leaseLost: number;
	readonly storageFailures: number;
};

export type ErrorReportDeliveryEnqueueResult = ErrorReportQueueEnqueueResult | { readonly status: "storage-error" };

export type CreateErrorReportDeliveryCoordinatorOptions = {
	readonly queue: ErrorReportQueue;
	readonly adapter: ErrorReportDeliveryAdapter;
	readonly ownerId?: string;
	readonly leaseDurationMs?: number;
	readonly deliveryTimeoutMs?: number;
	readonly idlePollMs?: number;
	readonly maxBatchSize?: number;
	readonly now?: () => Date;
	readonly random?: () => number;
	readonly onEvent?: (event: ErrorReportDeliveryCoordinatorEvent) => void;
};

export type ErrorReportDeliveryCoordinator = {
	readonly enqueue: (payload: ErrorReportPayload) => Promise<ErrorReportDeliveryEnqueueResult>;
	readonly flush: () => Promise<ErrorReportDeliveryFlushResult>;
	readonly wake: () => void;
	readonly start: () => () => void;
	readonly stop: () => void;
};

function emptyFlushResult(): ErrorReportDeliveryFlushResult {
	return { delivered: 0, retried: 0, discarded: 0, leaseLost: 0, storageFailures: 0 };
}

function addResult(result: ErrorReportDeliveryFlushResult, field: keyof ErrorReportDeliveryFlushResult): ErrorReportDeliveryFlushResult {
	return { ...result, [field]: result[field] + 1 };
}

function assertPositiveDuration(name: string, value: number) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} должен быть положительной длительностью`);
}

function assertPositiveCount(name: string, value: number) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} должен быть положительным целым числом`);
}

function isUpdated(result: ErrorReportQueueTransitionResult) {
	return result === "updated";
}

/**
 * Создаёт browser delivery lifecycle поверх durable queue. Coordinator не
 * знает endpoint/auth и не считает navigator.onLine доказательством сети.
 */
export function createErrorReportDeliveryCoordinator(options: CreateErrorReportDeliveryCoordinatorOptions): ErrorReportDeliveryCoordinator {
	const ownerId = options.ownerId ?? uuidv4();
	const leaseDurationMs = options.leaseDurationMs ?? ERROR_REPORT_QUEUE_LEASE_MS;
	const deliveryTimeoutMs = options.deliveryTimeoutMs ?? ERROR_REPORT_DELIVERY_TIMEOUT_MS;
	const idlePollMs = options.idlePollMs ?? ERROR_REPORT_DELIVERY_IDLE_POLL_MS;
	const maxBatchSize = options.maxBatchSize ?? ERROR_REPORT_DELIVERY_MAX_BATCH_SIZE;
	const now = options.now ?? (() => new Date());
	const random = options.random ?? Math.random;

	assertPositiveDuration("Lease duration", leaseDurationMs);
	assertPositiveDuration("Delivery timeout", deliveryTimeoutMs);
	assertPositiveDuration("Idle poll", idlePollMs);
	assertPositiveCount("Batch size", maxBatchSize);
	if (deliveryTimeoutMs >= leaseDurationMs) {
		throw new Error("Delivery timeout должен быть меньше lease duration");
	}

	let started = false;
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let flushPromise: Promise<ErrorReportDeliveryFlushResult> | undefined;
	let flushRequested = false;
	let nextWakeUtc: string | undefined;
	let activeController: AbortController | undefined;

	const emit = (event: ErrorReportDeliveryCoordinatorEvent) => {
		try {
			options.onEvent?.(event);
		} catch {
			// Observer diagnostics не должны ломать delivery и создавать рекурсивный report.
		}
	};

	const schedule = (wakeUtc?: string) => {
		if (!started) return;
		if (pollTimer) clearTimeout(pollTimer);

		const nowMs = now().getTime();
		const wakeMs = wakeUtc ? Date.parse(wakeUtc) : Number.NaN;
		const delay = Number.isFinite(wakeMs) ? Math.min(idlePollMs, Math.max(0, wakeMs - nowMs)) : idlePollMs;
		pollTimer = setTimeout(() => {
			pollTimer = undefined;
			coordinator.wake();
		}, delay);
	};

	const deliver = async (record: ErrorReportQueueRecord) => {
		const controller = new AbortController();
		activeController = controller;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await Promise.race([
				options.adapter(createErrorReportDeliveryBody(record.payload), {
					signal: controller.signal,
					attemptCount: record.attemptCount
				}),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => {
						controller.abort();
						reject(new ErrorReportDeliveryTimeoutError());
					}, deliveryTimeoutMs);
				})
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			if (activeController === controller) activeController = undefined;
		}
	};

	const recordLeaseLost = (
		result: ErrorReportDeliveryFlushResult,
		reportId: string,
		stage: Extract<ErrorReportDeliveryCoordinatorEvent, { type: "lease-lost" }>["stage"]
	) => {
		emit({ type: "lease-lost", reportId, stage });
		return addResult(result, "leaseLost");
	};

	const runFlush = async () => {
		let result = emptyFlushResult();

		for (let index = 0; index < maxBatchSize; index += 1) {
			let record: ErrorReportQueueRecord | undefined;
			try {
				record = await options.queue.leaseNext({ ownerId, now: now(), leaseDurationMs });
			} catch {
				emit({ type: "storage-failure", stage: "lease" });
				result = addResult(result, "storageFailures");
				break;
			}
			if (!record) break;

			try {
				await deliver(record);
				try {
					const transition = await options.queue.acknowledge(record.reportId, ownerId);
					if (isUpdated(transition)) {
						emit({ type: "delivered", reportId: record.reportId });
						result = addResult(result, "delivered");
					} else {
						result = recordLeaseLost(result, record.reportId, "acknowledge");
					}
				} catch {
					emit({ type: "storage-failure", stage: "acknowledge" });
					result = addResult(result, "storageFailures");
					break;
				}
			} catch (error) {
				const failure = classifyErrorReportDeliveryFailure(error);
				if (failure.policy === "terminal") {
					try {
						const transition = await options.queue.discard(record.reportId, ownerId);
						if (isUpdated(transition)) {
							emit({ type: "discarded", reportId: record.reportId, httpStatus: failure.httpStatus });
							result = addResult(result, "discarded");
						} else {
							result = recordLeaseLost(result, record.reportId, "discard");
						}
					} catch {
						emit({ type: "storage-failure", stage: "discard" });
						result = addResult(result, "storageFailures");
						break;
					}
					continue;
				}

				const failedAt = now();
				const delay = calculateErrorReportRetryDelay({
					attemptCount: record.attemptCount,
					retryAfterMs: failure.retryAfterMs,
					random
				});
				const scheduledUtc = new Date(failedAt.getTime() + delay).toISOString();
				try {
					const transition = await options.queue.reschedule(record.reportId, ownerId, {
						nextAttemptUtc: scheduledUtc,
						failure: {
							utc: failedAt.toISOString(),
							kind: failure.kind,
							httpStatus: failure.httpStatus
						}
					});
					if (isUpdated(transition)) {
						emit({ type: "retry-scheduled", reportId: record.reportId, nextAttemptUtc: scheduledUtc });
						result = addResult(result, "retried");
					} else {
						result = recordLeaseLost(result, record.reportId, "reschedule");
					}
				} catch {
					emit({ type: "storage-failure", stage: "reschedule" });
					result = addResult(result, "storageFailures");
					break;
				}
			}
		}

		try {
			nextWakeUtc = await options.queue.getNextWakeUtc(now());
		} catch {
			emit({ type: "storage-failure", stage: "schedule" });
			result = addResult(result, "storageFailures");
			nextWakeUtc = undefined;
		}

		return result;
	};

	const flush = () => {
		if (flushPromise) {
			flushRequested = true;
			return flushPromise;
		}

		flushRequested = false;
		flushPromise = runFlush();
		const finishFlush = () => {
			flushPromise = undefined;
			if (started) schedule(flushRequested ? now().toISOString() : nextWakeUtc);
		};
		void flushPromise.then(finishFlush, finishFlush);
		return flushPromise;
	};

	const onlineListener = () => coordinator.wake();
	const pageShowListener = () => coordinator.wake();
	const visibilityListener = () => {
		if (document.visibilityState === "visible") coordinator.wake();
	};

	const stop = () => {
		if (!started) return;
		started = false;
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = undefined;
		activeController?.abort();
		window.removeEventListener("online", onlineListener);
		window.removeEventListener("pageshow", pageShowListener);
		document.removeEventListener("visibilitychange", visibilityListener);
	};

	const coordinator: ErrorReportDeliveryCoordinator = {
		enqueue: async (payload) => {
			try {
				const result = await options.queue.enqueue(payload, now());
				if (result.status === "enqueued" || result.status === "duplicate") coordinator.wake();
				return result;
			} catch {
				emit({ type: "storage-failure", stage: "enqueue" });
				return { status: "storage-error" };
			}
		},
		flush,
		wake: () => {
			if (pollTimer) clearTimeout(pollTimer);
			pollTimer = undefined;
			flushRequested = true;
			void flush();
		},
		start: () => {
			if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
			if (started) return stop;

			started = true;
			window.addEventListener("online", onlineListener);
			window.addEventListener("pageshow", pageShowListener);
			document.addEventListener("visibilitychange", visibilityListener);
			coordinator.wake();
			return stop;
		},
		stop
	};

	return coordinator;
}
