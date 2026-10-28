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
import { ERROR_REPORT_DELIVERY_POLICY_TERMINAL } from "./deliveryFailureConstants";
import { calculateErrorReportRetryDelay } from "./retryPolicy";

const DELIVERY_EVENT_DELIVERED = "delivered";
const DELIVERY_EVENT_RETRY_SCHEDULED = "retry-scheduled";
const DELIVERY_EVENT_DISCARDED = "discarded";
const DELIVERY_EVENT_LEASE_LOST = "lease-lost";
const DELIVERY_EVENT_STORAGE_FAILURE = "storage-failure";
const DELIVERY_STAGE_ENQUEUE = "enqueue";
const DELIVERY_STAGE_LEASE = "lease";
const DELIVERY_STAGE_ACKNOWLEDGE = "acknowledge";
const DELIVERY_STAGE_RESCHEDULE = "reschedule";
const DELIVERY_STAGE_DISCARD = "discard";
const DELIVERY_STAGE_SCHEDULE = "schedule";
const DELIVERY_STATUS_STORAGE_ERROR = "storage-error";
const BROWSER_EVENT_ONLINE = "online";
const BROWSER_EVENT_PAGE_SHOW = "pageshow";
const DOCUMENT_EVENT_VISIBILITY_CHANGE = "visibilitychange";

export const ERROR_REPORT_DELIVERY_TIMEOUT_MS = 20 * 1_000;
export const ERROR_REPORT_DELIVERY_IDLE_POLL_MS = 30 * 1_000;
export const ERROR_REPORT_DELIVERY_MAX_BATCH_SIZE = 10;

export type ErrorReportDeliveryContext = {
	readonly signal: AbortSignal;
	readonly attemptCount: number;
};

export type ErrorReportDeliveryAdapter = (body: ErrorReportDeliveryBody, context: ErrorReportDeliveryContext) => Promise<void>;

export type ErrorReportDeliveryCoordinatorEvent =
	| { readonly type: typeof DELIVERY_EVENT_DELIVERED; readonly reportId: string }
	| { readonly type: typeof DELIVERY_EVENT_RETRY_SCHEDULED; readonly reportId: string; readonly nextAttemptUtc: string }
	| { readonly type: typeof DELIVERY_EVENT_DISCARDED; readonly reportId: string; readonly httpStatus?: number }
	| {
			readonly type: typeof DELIVERY_EVENT_LEASE_LOST;
			readonly reportId: string;
			readonly stage: typeof DELIVERY_STAGE_ACKNOWLEDGE | typeof DELIVERY_STAGE_RESCHEDULE | typeof DELIVERY_STAGE_DISCARD;
	  }
	| {
			readonly type: typeof DELIVERY_EVENT_STORAGE_FAILURE;
			readonly stage:
				| typeof DELIVERY_STAGE_ENQUEUE
				| typeof DELIVERY_STAGE_LEASE
				| typeof DELIVERY_STAGE_ACKNOWLEDGE
				| typeof DELIVERY_STAGE_RESCHEDULE
				| typeof DELIVERY_STAGE_DISCARD
				| typeof DELIVERY_STAGE_SCHEDULE;
	  };

export type ErrorReportDeliveryFlushResult = {
	readonly delivered: number;
	readonly retried: number;
	readonly discarded: number;
	readonly leaseLost: number;
	readonly storageFailures: number;
};

export type ErrorReportDeliveryEnqueueResult = ErrorReportQueueEnqueueResult | { readonly status: typeof DELIVERY_STATUS_STORAGE_ERROR };

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
		stage: Extract<ErrorReportDeliveryCoordinatorEvent, { type: typeof DELIVERY_EVENT_LEASE_LOST }>["stage"]
	) => {
		emit({ type: DELIVERY_EVENT_LEASE_LOST, reportId, stage });
		return addResult(result, "leaseLost");
	};

	const runFlush = async () => {
		let result = emptyFlushResult();

		for (let index = 0; index < maxBatchSize; index += 1) {
			let record: ErrorReportQueueRecord | undefined;
			try {
				record = await options.queue.leaseNext({ ownerId, now: now(), leaseDurationMs });
			} catch {
				emit({ type: DELIVERY_EVENT_STORAGE_FAILURE, stage: DELIVERY_STAGE_LEASE });
				result = addResult(result, "storageFailures");
				break;
			}
			if (!record) break;

			try {
				await deliver(record);
				try {
					const transition = await options.queue.acknowledge(record.reportId, ownerId);
					if (isUpdated(transition)) {
						emit({ type: DELIVERY_EVENT_DELIVERED, reportId: record.reportId });
						result = addResult(result, "delivered");
					} else {
						result = recordLeaseLost(result, record.reportId, DELIVERY_STAGE_ACKNOWLEDGE);
					}
				} catch {
					emit({ type: DELIVERY_EVENT_STORAGE_FAILURE, stage: DELIVERY_STAGE_ACKNOWLEDGE });
					result = addResult(result, "storageFailures");
					break;
				}
			} catch (error) {
				const failure = classifyErrorReportDeliveryFailure(error);
				if (failure.policy === ERROR_REPORT_DELIVERY_POLICY_TERMINAL) {
					try {
						const transition = await options.queue.discard(record.reportId, ownerId);
						if (isUpdated(transition)) {
							emit({ type: DELIVERY_EVENT_DISCARDED, reportId: record.reportId, httpStatus: failure.httpStatus });
							result = addResult(result, "discarded");
						} else {
							result = recordLeaseLost(result, record.reportId, DELIVERY_STAGE_DISCARD);
						}
					} catch {
						emit({ type: DELIVERY_EVENT_STORAGE_FAILURE, stage: DELIVERY_STAGE_DISCARD });
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
						emit({ type: DELIVERY_EVENT_RETRY_SCHEDULED, reportId: record.reportId, nextAttemptUtc: scheduledUtc });
						result = addResult(result, "retried");
					} else {
						result = recordLeaseLost(result, record.reportId, DELIVERY_STAGE_RESCHEDULE);
					}
				} catch {
					emit({ type: DELIVERY_EVENT_STORAGE_FAILURE, stage: DELIVERY_STAGE_RESCHEDULE });
					result = addResult(result, "storageFailures");
					break;
				}
			}
		}

		try {
			nextWakeUtc = await options.queue.getNextWakeUtc(now());
		} catch {
			emit({ type: DELIVERY_EVENT_STORAGE_FAILURE, stage: DELIVERY_STAGE_SCHEDULE });
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
		window.removeEventListener(BROWSER_EVENT_ONLINE, onlineListener);
		window.removeEventListener(BROWSER_EVENT_PAGE_SHOW, pageShowListener);
		document.removeEventListener(DOCUMENT_EVENT_VISIBILITY_CHANGE, visibilityListener);
	};

	const coordinator: ErrorReportDeliveryCoordinator = {
		enqueue: async (payload) => {
			try {
				const result = await options.queue.enqueue(payload, now());
				if (result.status === "enqueued" || result.status === "duplicate") coordinator.wake();
				return result;
			} catch {
				emit({ type: DELIVERY_EVENT_STORAGE_FAILURE, stage: DELIVERY_STAGE_ENQUEUE });
				return { status: DELIVERY_STATUS_STORAGE_ERROR };
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
			window.addEventListener(BROWSER_EVENT_ONLINE, onlineListener);
			window.addEventListener(BROWSER_EVENT_PAGE_SHOW, pageShowListener);
			document.addEventListener(DOCUMENT_EVENT_VISIBILITY_CHANGE, visibilityListener);
			coordinator.wake();
			return stop;
		},
		stop
	};

	return coordinator;
}
