import { reportTransportError } from "@ryuzaki13/react-foundation-lib/error-report";

import { type FetchErrorReportContext } from "./types";
import { BaseUrlMap, getInputUrl, normalizeRelativePath } from "./url";

const MAX_HTML_INPUT_NAMES = 40;
const MAX_HTML_SAMPLE_BYTES = 2 * 1_024;
export type ODataErrorReportUrlPolicy = "normalized" | "verbatim";

let errorReportUrlPolicy: ODataErrorReportUrlPolicy = "normalized";

/**
 * Управляет подробностью диагностики неожиданного HTML-ответа OData.
 * По умолчанию параметры URL убираются и HTML не сохраняется. Приложение может
 * получить исходные URL и короткий HTML-фрагмент, а затем восстановить умолчание.
 */
export function setODataErrorReportUrlPolicy(policy: ODataErrorReportUrlPolicy | undefined): void {
	errorReportUrlPolicy = policy ?? "normalized";
}

function normalizeUrlForReport(url: string) {
	try {
		const baseOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
		const parsedUrl = new URL(url, baseOrigin);
		const sameOrigin = parsedUrl.origin === baseOrigin;
		return `${sameOrigin ? "" : parsedUrl.origin}${parsedUrl.pathname}`;
	} catch {
		return normalizeRelativePath(url);
	}
}

function getUrlForReport(url: string) {
	return errorReportUrlPolicy === "verbatim" ? url : normalizeUrlForReport(url);
}

function readHtmlDocument(html: string) {
	if (typeof DOMParser === "undefined") return undefined;

	try {
		return new DOMParser().parseFromString(html, "text/html");
	} catch {
		return undefined;
	}
}

function countHtmlForms(html: string, doc: Document | undefined) {
	const formsCount = doc?.querySelectorAll("form").length;
	if (formsCount !== undefined) return formsCount;

	return Array.from(html.matchAll(/<form\b/gi)).length;
}

function collectHtmlInputNames(html: string, doc: Document | undefined) {
	const names = doc
		? Array.from(
				doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name],textarea[name],select[name]")
			)
				.map((element) => element.name)
				.filter(Boolean)
		: Array.from(html.matchAll(/\bname\s*=\s*["']([^"']+)["']/gi))
				.map((match) => match[1])
				.filter((name): name is string => !!name);

	return Array.from(new Set(names)).slice(0, MAX_HTML_INPUT_NAMES);
}

/** Возвращает исходный префикс HTML без разрыва UTF-8 символа на границе лимита. */
function createHtmlResponseSample(html: string) {
	const bytes = new Uint8Array(MAX_HTML_SAMPLE_BYTES);
	const { read, written } = new TextEncoder().encodeInto(html, bytes);
	const truncated = read < html.length;
	return {
		sample: truncated ? new TextDecoder().decode(bytes.subarray(0, written)) : html,
		truncated
	};
}

function createHtmlResponseSummary(html: string) {
	const doc = readHtmlDocument(html);

	const summary = {
		length: html.length,
		formCount: countHtmlForms(html, doc),
		inputNames: collectHtmlInputNames(html, doc)
	};
	return errorReportUrlPolicy === "verbatim" ? { ...summary, ...createHtmlResponseSample(html) } : summary;
}

export function reportUnexpectedHtmlResponse(
	error: Error,
	source: "fetch.parseResponse" | "fetch.buildHttpError",
	res: Response,
	text: string,
	context: FetchErrorReportContext | undefined
) {
	const inputUrl = context ? getInputUrl(context.input) : undefined;
	const requestUrl = inputUrl?.startsWith("http")
		? inputUrl
		: inputUrl
			? `${BaseUrlMap[context?.baseUrlType ?? ""]}${inputUrl}`
			: undefined;

	reportTransportError(error, {
		source,
		requestUrl: requestUrl ? getUrlForReport(requestUrl) : undefined,
		responseUrl: res.url ? getUrlForReport(res.url) : undefined,
		method: context?.init.method?.toUpperCase() ?? "GET",
		baseUrlType: context?.baseUrlType,
		sapClient: context?.sapClient,
		status: res.status,
		statusText: res.statusText,
		contentType: res.headers.get("Content-Type") || undefined,
		redirected: res.redirected,
		responseType: res.type,
		html: createHtmlResponseSummary(text)
	});
}
