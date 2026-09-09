import { type ErrorReportPayload } from "@ryuzaki13/react-foundation-lib/error-report";
import { describe, expect, it } from "vitest";

import { createErrorReportDeliveryBody } from "./deliveryBody";

function createPayload(message = "boom"): ErrorReportPayload {
	return {
		payloadVersion: 1,
		application: "ru.education-system",
		reportId: "00000000-0000-4000-8000-000000000001",
		sessionId: "10000000-0000-4000-8000-000000000001",
		createdUtc: "2026-09-09T06:00:00.000Z",
		category: "runtime",
		source: "delivery-test",
		error: { name: "Error", message, stackTrace: "Error: boom\n at app.ts:1:1" },
		environment: { mode: "production", buildId: "commit-sha" },
		breadcrumbs: []
	};
}

describe("createErrorReportDeliveryBody", () => {
	it("дублирует indexed server fields и сериализует validated payload", () => {
		const payload = createPayload();

		expect(createErrorReportDeliveryBody(payload)).toEqual({
			payloadVersion: 1,
			application: "ru.education-system",
			buildId: "commit-sha",
			reportId: payload.reportId,
			sessionId: payload.sessionId,
			createdUtc: payload.createdUtc,
			category: "runtime",
			errorClass: "Error",
			errorMessage: "boom",
			stackTrace: "Error: boom\n at app.ts:1:1",
			payload: JSON.stringify(payload)
		});
	});

	it("подставляет fallback message одинаково в column и JSON payload", () => {
		const body = createErrorReportDeliveryBody(createPayload("  "));

		expect(body.errorMessage).toBe("Неизвестная ошибка");
		expect(JSON.parse(body.payload)).toMatchObject({ error: { message: "Неизвестная ошибка" } });
	});

	it("отклоняет future payload до transport adapter", () => {
		const payload = { ...createPayload(), payloadVersion: 2 } as unknown as ErrorReportPayload;

		expect(() => createErrorReportDeliveryBody(payload)).toThrow("не соответствует текущему delivery contract");
	});
});
