import { parseErrorReportPayload, type ErrorReportCategory, type ErrorReportPayload } from "@ryuzaki13/react-foundation-lib/error-report";
import { normalizeText } from "@ryuzaki13/react-foundation-lib/formatters";

const DEFAULT_ERROR_MESSAGE = "Неизвестная ошибка";

export type ErrorReportDeliveryBody = {
	readonly payloadVersion: number;
	readonly application: string;
	readonly buildId?: string;
	readonly reportId: string;
	readonly sessionId: string;
	readonly createdUtc: string;
	readonly category: ErrorReportCategory;
	readonly errorClass: string;
	readonly errorMessage: string;
	readonly stackTrace?: string;
	readonly payload: string;
};

/**
 * Строит transport-neutral server body только из текущего validated payload.
 * Application/build/version дублируются с JSON для bounded DB columns и поиска.
 */
export function createErrorReportDeliveryBody(payload: ErrorReportPayload): ErrorReportDeliveryBody {
	const parsedPayload = parseErrorReportPayload(payload);
	if (!parsedPayload) throw new Error("Error report payload не соответствует текущему delivery contract");

	const errorMessage = normalizeText(parsedPayload.error.message) ? parsedPayload.error.message : DEFAULT_ERROR_MESSAGE;
	const normalizedPayload: ErrorReportPayload = {
		...parsedPayload,
		error: { ...parsedPayload.error, message: errorMessage }
	};

	return {
		payloadVersion: normalizedPayload.payloadVersion,
		application: normalizedPayload.application,
		buildId: normalizedPayload.environment.buildId,
		reportId: normalizedPayload.reportId,
		sessionId: normalizedPayload.sessionId,
		createdUtc: normalizedPayload.createdUtc,
		category: normalizedPayload.category,
		errorClass: normalizedPayload.error.name,
		errorMessage,
		stackTrace: normalizedPayload.error.stackTrace,
		payload: JSON.stringify(normalizedPayload)
	};
}
