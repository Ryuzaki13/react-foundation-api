import { describe, expect, it } from "vitest";

import {
	createErrorReportRateLimiter,
	ErrorReportBodyTooLargeError,
	isSameOriginErrorReportRequest,
	readBoundedErrorReportRequestText
} from ".";

describe("error report server transport", () => {
	it("принимает только same-origin browser request", () => {
		expect(
			isSameOriginErrorReportRequest(
				new Request("https://example.test/api/error-reports", {
					headers: { Origin: "https://example.test", "Sec-Fetch-Site": "same-origin" }
				})
			)
		).toBe(true);
		expect(
			isSameOriginErrorReportRequest(
				new Request("https://example.test/api/error-reports", {
					headers: { Origin: "https://attacker.test", "Sec-Fetch-Site": "cross-site" }
				})
			)
		).toBe(false);
	});

	it("отклоняет body по объявленному и фактическому размеру", async () => {
		await expect(
			readBoundedErrorReportRequestText(
				new Request("https://example.test", { method: "POST", headers: { "Content-Length": "11" }, body: "{}" }),
				10
			)
		).rejects.toBeInstanceOf(ErrorReportBodyTooLargeError);
		await expect(
			readBoundedErrorReportRequestText(new Request("https://example.test", { method: "POST", body: "123" }), 2)
		).rejects.toBeInstanceOf(ErrorReportBodyTooLargeError);
	});

	it("ограничивает source и сбрасывает окно", () => {
		let now = 0;
		const limiter = createErrorReportRateLimiter({ now: () => now, sourceLimit: 1, globalLimit: 10, windowMs: 1_000, secret: "test" });
		expect(limiter.consume("source").allowed).toBe(true);
		expect(limiter.consume("source")).toEqual({ allowed: false, retryAfterSeconds: 1 });
		now = 1_000;
		expect(limiter.consume("source").allowed).toBe(true);
	});
});
