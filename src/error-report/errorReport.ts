import {
	createErrorInfo,
	getErrorReportDraft,
	updateErrorReportDraft,
	type ErrorReportCategory,
	type ErrorReportDraft
} from "@ryuzaki13/react-foundation-lib/error-report";

import type { QueryClient } from "@tanstack/react-query";

export type ErrorReportDeliveryBody = {
	reportId: string;
	sessionId: string;
	createdUtc: string;
	category: ErrorReportCategory;
	errorClass: string;
	errorMessage: string;
	stackTrace?: string;
	payload: string;
};

export type ErrorReportDeliveryContext = {
	draft: ErrorReportDraft;
	queryClient?: QueryClient;
};

export type ErrorReportDeliveryAdapter = (body: ErrorReportDeliveryBody, context: ErrorReportDeliveryContext) => Promise<void>;

export interface SendErrorReportOptions {
	adapter: ErrorReportDeliveryAdapter;
	queryClient?: QueryClient;
}

export function createErrorReportDeliveryBody(draft: ErrorReportDraft): ErrorReportDeliveryBody {
	return {
		reportId: draft.reportId,
		sessionId: draft.sessionId,
		createdUtc: draft.createdUtc,
		category: draft.category,
		errorClass: draft.payload.error.name,
		errorMessage: draft.payload.error.message,
		stackTrace: draft.payload.error.stackTrace,
		payload: JSON.stringify(draft.payload)
	};
}

/**
 * Отправляет сохраненный черновик отчета через adapter, который задаёт приложение.
 * Shared API управляет жизненным циклом draft, но не выбирает transport и backend entity.
 */
export async function sendErrorReport(reportId: string, options: SendErrorReportOptions): Promise<ErrorReportDraft | undefined> {
	const draft = getErrorReportDraft(reportId);
	if (!draft) return undefined;
	if (draft.status === "sent") return draft;
	if (draft.status === "sending") return draft;

	updateErrorReportDraft(reportId, { status: "sending", failedReason: undefined });

	try {
		await options.adapter(createErrorReportDeliveryBody(draft), {
			draft,
			queryClient: options.queryClient
		});

		return updateErrorReportDraft(reportId, { status: "sent", sentUtc: new Date().toISOString() });
	} catch (error) {
		const info = createErrorInfo(error);
		updateErrorReportDraft(reportId, { status: "failed", failedReason: info.message });
		throw error;
	}
}
