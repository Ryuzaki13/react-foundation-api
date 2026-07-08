import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createErrorReportDeliveryBody, sendErrorReport } from "./errorReport";

import type { ErrorReportDraft } from "@ryuzaki13/react-foundation-lib/error-report";

const errorReportDraftStoreMock = vi.hoisted(() => ({
	getErrorReportDraft: vi.fn(),
	updateErrorReportDraft: vi.fn()
}));

vi.mock("@ryuzaki13/react-foundation-lib/error-report", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@ryuzaki13/react-foundation-lib/error-report")>();

	return {
		...actual,
		getErrorReportDraft: errorReportDraftStoreMock.getErrorReportDraft,
		updateErrorReportDraft: errorReportDraftStoreMock.updateErrorReportDraft
	};
});

function createDraft(overrides: Partial<ErrorReportDraft> = {}): ErrorReportDraft {
	return {
		reportId: "report-1",
		sessionId: "session-1",
		createdUtc: "2026-05-15T00:00:00.000Z",
		category: "runtime",
		status: "pending",
		payload: {
			reportId: "report-1",
			sessionId: "session-1",
			createdUtc: "2026-05-15T00:00:00.000Z",
			category: "runtime",
			source: "test",
			error: {
				name: "Error",
				message: "boom",
				stackTrace: "Error: boom\n    at app.ts:1:1"
			},
			environment: { mode: "production", buildId: "build-1" },
			breadcrumbs: []
		},
		...overrides
	};
}

describe("errorReportApi", () => {
	beforeEach(() => {
		errorReportDraftStoreMock.getErrorReportDraft.mockReset();
		errorReportDraftStoreMock.updateErrorReportDraft.mockReset();
	});

	it("собирает transport-neutral body из draft", () => {
		const draft = createDraft();

		expect(createErrorReportDeliveryBody(draft)).toEqual({
			reportId: "report-1",
			sessionId: "session-1",
			createdUtc: "2026-05-15T00:00:00.000Z",
			category: "runtime",
			errorClass: "Error",
			errorMessage: "boom",
			stackTrace: "Error: boom\n    at app.ts:1:1",
			payload: JSON.stringify(draft.payload)
		});
	});

	it("отправляет draft через внешний adapter и отмечает его отправленным", async () => {
		const draft = createDraft();
		const sentDraft = createDraft({ status: "sent", sentUtc: "2026-05-15T00:00:01.000Z" });
		const queryClient = new QueryClient();
		const adapter = vi.fn().mockResolvedValue(undefined);

		errorReportDraftStoreMock.getErrorReportDraft.mockReturnValue(draft);
		errorReportDraftStoreMock.updateErrorReportDraft
			.mockReturnValueOnce(createDraft({ status: "sending" }))
			.mockReturnValueOnce(sentDraft);

		await expect(sendErrorReport("report-1", { adapter, queryClient })).resolves.toBe(sentDraft);

		expect(errorReportDraftStoreMock.updateErrorReportDraft).toHaveBeenNthCalledWith(1, "report-1", {
			status: "sending",
			failedReason: undefined
		});
		expect(adapter).toHaveBeenCalledWith(createErrorReportDeliveryBody(draft), { draft, queryClient });
		expect(errorReportDraftStoreMock.updateErrorReportDraft).toHaveBeenLastCalledWith("report-1", {
			status: "sent",
			sentUtc: expect.any(String)
		});
	});

	it("не повторяет отправку уже отправленного draft", async () => {
		const draft = createDraft({ status: "sent" });
		const adapter = vi.fn();

		errorReportDraftStoreMock.getErrorReportDraft.mockReturnValue(draft);

		await expect(sendErrorReport("report-1", { adapter })).resolves.toBe(draft);

		expect(adapter).not.toHaveBeenCalled();
		expect(errorReportDraftStoreMock.updateErrorReportDraft).not.toHaveBeenCalled();
	});

	it("фиксирует failed status при ошибке adapter", async () => {
		const draft = createDraft();
		const adapterError = new Error("transport failed");
		const adapter = vi.fn().mockRejectedValue(adapterError);

		errorReportDraftStoreMock.getErrorReportDraft.mockReturnValue(draft);
		errorReportDraftStoreMock.updateErrorReportDraft.mockReturnValue(createDraft({ status: "sending" }));

		await expect(sendErrorReport("report-1", { adapter })).rejects.toBe(adapterError);

		expect(errorReportDraftStoreMock.updateErrorReportDraft).toHaveBeenLastCalledWith("report-1", {
			status: "failed",
			failedReason: "transport failed"
		});
	});
});
