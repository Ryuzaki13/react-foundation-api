export const ERROR_REPORT_RETRY_BASE_MS = 5 * 1_000;
export const ERROR_REPORT_RETRY_MAX_MS = 15 * 60 * 1_000;

export type ErrorReportRetryDelayOptions = {
	readonly attemptCount: number;
	readonly retryAfterMs?: number;
	readonly random?: () => number;
};

/**
 * Рассчитывает exponential backoff с jitter 0.5–1.5. Retry-After является
 * нижней границей, но общий интервал всегда ограничен пятнадцатью минутами.
 */
export function calculateErrorReportRetryDelay(options: ErrorReportRetryDelayOptions) {
	if (!Number.isSafeInteger(options.attemptCount) || options.attemptCount < 1) {
		throw new Error("Retry delay требует положительный attemptCount");
	}

	const randomValue = (options.random ?? Math.random)();
	if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
		throw new Error("Retry jitter source должен возвращать число от 0 до 1");
	}

	const exponent = Math.min(options.attemptCount - 1, 30);
	const backoff = ERROR_REPORT_RETRY_BASE_MS * 2 ** exponent * (0.5 + randomValue);
	const retryAfter = options.retryAfterMs ?? 0;
	return Math.min(ERROR_REPORT_RETRY_MAX_MS, Math.max(backoff, retryAfter));
}
