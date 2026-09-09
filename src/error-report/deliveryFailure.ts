import { type ErrorReportQueueFailureKind } from "@ryuzaki13/react-foundation-lib/error-report";

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

export type ErrorReportDeliveryFailureClassification = {
	readonly policy: "retry" | "terminal";
	readonly kind: ErrorReportQueueFailureKind;
	readonly httpStatus?: number;
	readonly retryAfterMs?: number;
};

/**
 * Transport adapter использует этот error для status-aware policy без
 * сохранения response body или произвольного server message в durable queue.
 */
export class ErrorReportDeliveryHttpError extends Error {
	public readonly status: number;
	public readonly retryAfterMs?: number;

	public constructor(status: number, retryAfterMs?: number) {
		if (!Number.isInteger(status) || status < 100 || status > 599) {
			throw new Error("HTTP status доставки отчёта должен быть целым числом от 100 до 599");
		}
		if (retryAfterMs !== undefined && (!Number.isFinite(retryAfterMs) || retryAfterMs < 0)) {
			throw new Error("Retry-After доставки отчёта должен быть неотрицательной длительностью");
		}

		super(`Error report delivery failed with HTTP ${status}`);
		this.name = "ErrorReportDeliveryHttpError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
		Object.setPrototypeOf(this, ErrorReportDeliveryHttpError.prototype);
	}
}

export class ErrorReportDeliveryTimeoutError extends Error {
	public constructor() {
		super("Error report delivery timed out");
		this.name = "ErrorReportDeliveryTimeoutError";
		Object.setPrototypeOf(this, ErrorReportDeliveryTimeoutError.prototype);
	}
}

function readHttpStatus(error: unknown) {
	if (error instanceof ErrorReportDeliveryHttpError) return error.status;
	if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
	const status = error.status;
	return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function readRetryAfterMs(error: unknown) {
	if (error instanceof ErrorReportDeliveryHttpError) return error.retryAfterMs;
	if (typeof error !== "object" || error === null || !("retryAfterMs" in error)) return undefined;
	const retryAfterMs = error.retryAfterMs;
	return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : undefined;
}

/** Применяет единую retry/terminal policy к недоверенной ошибке adapter-а. */
export function classifyErrorReportDeliveryFailure(error: unknown): ErrorReportDeliveryFailureClassification {
	const httpStatus = readHttpStatus(error);
	if (httpStatus !== undefined) {
		const retryable = RETRYABLE_HTTP_STATUSES.has(httpStatus) || httpStatus >= 500;
		return {
			policy: retryable ? "retry" : "terminal",
			kind: "http",
			httpStatus,
			retryAfterMs: readRetryAfterMs(error)
		};
	}

	if (error instanceof ErrorReportDeliveryTimeoutError || (error instanceof DOMException && error.name === "AbortError")) {
		return { policy: "retry", kind: "timeout" };
	}
	if (error instanceof TypeError) return { policy: "retry", kind: "network" };
	return { policy: "retry", kind: "unknown" };
}
