import { describe, expect, it } from "vitest";

import { classifyErrorReportDeliveryFailure, ErrorReportDeliveryHttpError, ErrorReportDeliveryTimeoutError } from "./deliveryFailure";
import { calculateErrorReportRetryDelay, ERROR_REPORT_RETRY_MAX_MS } from "./retryPolicy";

describe("classifyErrorReportDeliveryFailure", () => {
	it.each([408, 425, 429, 500, 503])("считает HTTP %s retryable", (status) => {
		expect(classifyErrorReportDeliveryFailure(new ErrorReportDeliveryHttpError(status, 12_000))).toEqual({
			policy: "retry",
			kind: "http",
			httpStatus: status,
			retryAfterMs: 12_000
		});
	});

	it.each([400, 401, 403, 404, 409, 422, 499])("считает HTTP %s terminal", (status) => {
		expect(classifyErrorReportDeliveryFailure(new ErrorReportDeliveryHttpError(status))).toEqual({
			policy: "terminal",
			kind: "http",
			httpStatus: status,
			retryAfterMs: undefined
		});
	});

	it("разделяет timeout, network и unknown failures", () => {
		expect(classifyErrorReportDeliveryFailure(new ErrorReportDeliveryTimeoutError())).toMatchObject({
			policy: "retry",
			kind: "timeout"
		});
		expect(classifyErrorReportDeliveryFailure(new TypeError("fetch failed"))).toMatchObject({
			policy: "retry",
			kind: "network"
		});
		expect(classifyErrorReportDeliveryFailure(new Error("unexpected"))).toMatchObject({
			policy: "retry",
			kind: "unknown"
		});
	});
});

describe("calculateErrorReportRetryDelay", () => {
	it("строит exponential delay с multiplicative jitter", () => {
		expect(calculateErrorReportRetryDelay({ attemptCount: 1, random: () => 0 })).toBe(2_500);
		expect(calculateErrorReportRetryDelay({ attemptCount: 1, random: () => 0.5 })).toBe(5_000);
		expect(calculateErrorReportRetryDelay({ attemptCount: 2, random: () => 1 })).toBe(15_000);
	});

	it("учитывает Retry-After и ограничивает 15 минутами", () => {
		expect(calculateErrorReportRetryDelay({ attemptCount: 1, retryAfterMs: 60_000, random: () => 0.5 })).toBe(60_000);
		expect(calculateErrorReportRetryDelay({ attemptCount: 30, retryAfterMs: 60 * 60 * 1_000, random: () => 1 })).toBe(
			ERROR_REPORT_RETRY_MAX_MS
		);
	});
});
