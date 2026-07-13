import { logError } from "@ryuzaki13/react-foundation-lib/utils";
import { asRecord, isRecord, isSafe } from "@ryuzaki13/react-foundation-lib/validators";

import { normalizeODataServiceName, resolveODataBaseUrl, resolveODataSapClient } from "../odataProjectAdapter";

import { reportUnexpectedHtmlResponse } from "./errorReport";
import { isSsoForm, recoverSsoSession, SsoForm, SsoRequiredError } from "./SsoRequiredError";
import { BaseURLType, FetchErrorReportContext, RequestInitType } from "./types";
import { BaseUrlMap, getInputUrl, normalizeRelativePath } from "./url";

const csrfTokenCache = new Map<string, string>();
const csrfFetchInProgressCache = new Map<string, Promise<string>>();
let ssoRecoveryGate: Promise<void> | null = null;
let ssoBlockedError: SsoRequiredError | null = null;

export { normalizeODataServiceName, resolveODataBaseUrl };

function isSapRequest(input: RequestInfo, baseUrlType: BaseURLType) {
	if (baseUrlType !== "") return true;

	const path = normalizeRelativePath(getInputUrl(input));
	return path.startsWith("/sap/") || path.startsWith("/sap-dp0/");
}

function getSapClient(input: RequestInfo, baseUrlType: BaseURLType): string | null {
	if (__DEV__ || __PREVIEW__) {
		if (!isSapRequest(input, baseUrlType)) return null;
		if (baseUrlType === "odataDp0") return "300";
		if (baseUrlType === "" && normalizeRelativePath(getInputUrl(input)).startsWith("/sap-dp0/")) {
			return "300";
		}
		return `${__SAP_CLIENT__}`;
	}

	return resolveODataSapClient();
}

function createUnrecoverableSsoError(source: SsoRequiredError) {
	return new SsoRequiredError(
		"Не удалось автоматически восстановить SSO-сессию. Перезагрузите страницу и выполните вход заново.",
		source.form,
		source.recoveryUrl,
		{ recoverable: false }
	);
}

function markSsoBlocked(source: SsoRequiredError) {
	const error = createUnrecoverableSsoError(source);
	if (typeof window !== "undefined") {
		ssoBlockedError = error;
	}
	return error;
}

async function waitForSsoRecoveryGate() {
	const gate = ssoRecoveryGate;
	if (gate) {
		await gate.catch(() => {});
	}

	if (ssoBlockedError) {
		throw ssoBlockedError;
	}
}

async function recoverSsoSessionAndRetry<T>(error: SsoRequiredError, retry: () => Promise<T>) {
	if (ssoBlockedError) {
		throw ssoBlockedError;
	}

	let retryResult: { value: T } | undefined;

	if (!ssoRecoveryGate) {
		ssoRecoveryGate = (async () => {
			const recovered = await Promise.resolve(recoverSsoSession({ form: error.form, recoveryUrl: error.recoveryUrl })).catch(
				() => false
			);

			if (!recovered) {
				throw markSsoBlocked(error);
			}

			try {
				retryResult = { value: await retry() };
				ssoBlockedError = null;
			} catch (retryError: unknown) {
				if (retryError instanceof SsoRequiredError) {
					throw markSsoBlocked(retryError);
				}

				throw retryError;
			}
		})().finally(() => {
			ssoRecoveryGate = null;
		});

		await ssoRecoveryGate;

		if (!retryResult) {
			throw ssoBlockedError ?? createUnrecoverableSsoError(error);
		}

		return retryResult.value;
	}

	await waitForSsoRecoveryGate();
	try {
		return await retry();
	} catch (retryError: unknown) {
		if (retryError instanceof SsoRequiredError) {
			throw markSsoBlocked(retryError);
		}

		throw retryError;
	}
}

function resolveCsrfScope(input: RequestInfo, baseUrlType: BaseURLType, sapClient: string | null) {
	if (baseUrlType === "config") {
		return {
			cacheKey: `${__APP_ID__}:${sapClient ?? ""}`,
			fetchUrl: "/Statistics"
		};
	}

	const requestPath = normalizeRelativePath(getInputUrl(input));
	const [serviceName] = requestPath.split("/").filter(Boolean);
	if (!serviceName) {
		throw new Error("Не удалось определить сервис для получения CSRF-токена");
	}

	return {
		cacheKey: `${baseUrlType}:${sapClient ?? ""}:${serviceName}`,
		fetchUrl: `/${serviceName}/`
	};
}

async function getCsrfToken(input: RequestInfo, baseUrlType: BaseURLType, sapClient: string | null): Promise<string> {
	const scope = resolveCsrfScope(input, baseUrlType, sapClient);
	const cachedToken = csrfTokenCache.get(scope.cacheKey);
	if (cachedToken) return cachedToken;

	const inflightToken = csrfFetchInProgressCache.get(scope.cacheKey);
	if (inflightToken) return inflightToken;

	const headers = new Headers({ "x-csrf-token": "Fetch" });
	headers.set("sap-language", "ru");
	headers.set("sap-contextid-accept", "header");
	headers.set("Accept-Language", "ru");
	if (sapClient) {
		headers.set("sap-client", sapClient);
	}

	const baseUrl = (baseUrlType && BaseUrlMap[baseUrlType]) ?? "";
	const tokenPromise = fetch(baseUrl + scope.fetchUrl, {
		method: "GET",
		headers,
		credentials: "include",
		redirect: "manual"
	})
		.then(async (res) => {
			if (isSsoRedirectResponse(res)) {
				throw new SsoRequiredError("Требуется повторная аутентификация", undefined, baseUrl + scope.fetchUrl);
			}

			if (!res.ok) throw new Error("Не удалось получить CSRF-токен");

			const token = res.headers.get("x-csrf-token");
			if (!token) {
				const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
				const text = await res.text();
				if (looksLikeHtmlResponse(contentType, text)) {
					const form = extractFormFromHtml(text);
					if (isSsoForm(form)) {
						throw new SsoRequiredError("Требуется повторная аутентификация", form, baseUrl + scope.fetchUrl);
					}
				}

				throw new Error("CSRF-токен отсутствует в ответе");
			}

			csrfTokenCache.set(scope.cacheKey, token);
			csrfFetchInProgressCache.delete(scope.cacheKey);
			return token;
		})
		.catch((err) => {
			csrfFetchInProgressCache.delete(scope.cacheKey);
			throw err;
		});

	csrfFetchInProgressCache.set(scope.cacheKey, tokenPromise);
	return tokenPromise;
}

function extractHtmlAttribute(source: string, attributeName: string) {
	const escapedAttributeName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`${escapedAttributeName}\\s*=\\s*["']([^"']*)["']`, "i").exec(source);
	return match?.[1];
}

/**
 * Попытка извлечь форму (действие + скрытые входные данные) из HTML, возвращаемого ADFS/SSO.
 * Возвращает undefined, если форма не найдена.
 */
function extractFormFromHtml(html: string): SsoForm | undefined {
	try {
		if (typeof DOMParser !== "undefined") {
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, "text/html");
			const form = doc.querySelector("form");
			if (form) {
				const action = form.getAttribute("action") || (typeof window !== "undefined" ? window.location.href : "");
				const method = (form.getAttribute("method") || "GET").toUpperCase();
				const inputs: Record<string, string> = {};
				form.querySelectorAll<HTMLInputElement>("input[name]").forEach((i) => {
					inputs[i.name] = i.value ?? "";
				});
				return { action, method, inputs };
			}
		}
	} catch {
		// Игнорируем и переходим к текстовому fallback-разбору.
	}

	const formMatch = /<form\b([^>]*)>([\s\S]*?)<\/form>/i.exec(html);
	if (!formMatch) return undefined;

	const [, formAttributes = "", formBody = ""] = formMatch;
	const action = extractHtmlAttribute(formAttributes, "action") || (typeof window !== "undefined" ? window.location.href : "");
	const method = (extractHtmlAttribute(formAttributes, "method") || "GET").toUpperCase();
	const inputs: Record<string, string> = {};
	const inputTagPattern = /<input\b([^>]*)>/gi;

	for (const match of formBody.matchAll(inputTagPattern)) {
		const inputAttributes = match[1] ?? "";
		const inputName = extractHtmlAttribute(inputAttributes, "name");
		if (!inputName) continue;

		inputs[inputName] = extractHtmlAttribute(inputAttributes, "value") ?? "";
	}

	return { action, method, inputs };
}

function looksLikeHtmlResponse(contentType: string, text: string) {
	return contentType.includes("text/html") || /<html/i.test(text) || /<form/i.test(text);
}

function stripODataMetadata(value: unknown) {
	if (!isRecord(value)) return value;

	const record = { ...value };
	delete record.__metadata;
	return record;
}

function extractJson<T>(json: unknown) {
	if (isRecord(json) && isRecord(json.d) && Array.isArray(json.d.results)) {
		let totalCount: number | undefined = undefined;
		if (json.d.__count) {
			totalCount = Number(json.d.__count);
		}

		const data = json.d.results.map(stripODataMetadata) as T;

		return { data, totalCount };
	}
	if (isRecord(json) && json.d !== undefined) {
		const data = stripODataMetadata(json.d);

		return { data: data as T };
	}
	return {
		data: json as T
	};
}

const NO_CONTENT_RESPONSE = Object.freeze({ __noContent: true } as const);

export function isNoContentResponse(value: unknown): value is typeof NO_CONTENT_RESPONSE {
	return !!value && typeof value === "object" && "__noContent" in value;
}

async function parseResponse<T>(res: Response, reportContext?: FetchErrorReportContext): Promise<{ data: T; totalCount?: number }> {
	if (res.status === 204 || res.status === 205 /*|| res.headers.get("Content-Length") === "0"*/) {
		return { data: NO_CONTENT_RESPONSE as T };
	}

	const contentType = (res.headers.get("Content-Type") || "").toLowerCase();

	// Если явный JSON — безопасно парсим
	if (contentType.includes("application/json") || contentType.includes("application/odata+json")) {
		const json = await res.json();
		return extractJson<T>(json);
	}

	// Попытка парсинга как текст (на случай, если server неправильно прописал content-type)
	const text = await res.text();

	// если в теле HTML — проверяем, есть ли форма (SSO)
	if (looksLikeHtmlResponse(contentType, text)) {
		const form = extractFormFromHtml(text);
		if (isSsoForm(form)) {
			throw new SsoRequiredError("Требуется повторная аутентификация", form);
		}
		const error = new Error("Unexpected HTML response from OData endpoint");
		reportUnexpectedHtmlResponse(error, "fetch.parseResponse", res, text, reportContext);
		throw error;
	}

	// Попытка безопасно распарсить JSON, если сервер не установил content-type
	try {
		const maybeJson = JSON.parse(text);
		return extractJson<T>(maybeJson);
	} catch (e) {
		logError(e);
		// ни текст, ни JSON — возвращаем ошибку
		throw new Error("Unsupported response content type and body is not JSON");
	}
}

/**
 * Безопасно извлекает текстовое сообщение из неизвестного значения.
 */
function asNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length ? normalized : null;
}

function pushUniqueMessage(parts: string[], value: unknown) {
	const normalized = asNonEmptyString(value);
	if (!normalized || parts.includes(normalized)) return;
	parts.push(normalized);
}

function extractJsonErrorParts(payload: Record<string, unknown>) {
	const parts: string[] = [];
	const errorValue = payload.error;

	if (typeof errorValue === "string") {
		pushUniqueMessage(parts, errorValue);
	}

	const errorRecord = asRecord(errorValue);
	if (errorRecord) {
		pushUniqueMessage(parts, errorRecord.code);

		const errorMessage = asRecord(errorRecord.message);
		pushUniqueMessage(parts, errorMessage?.value ?? errorRecord.message);

		// const innerError = asRecord(errorRecord.innererror);
		// const errorDetails = innerError?.errordetails;
		// if (Array.isArray(errorDetails)) {
		// 	for (const detail of errorDetails) {
		// 		pushUniqueMessage(parts, asRecord(detail)?.message);
		// 	}
		// }
	}

	pushUniqueMessage(parts, payload.details);
	pushUniqueMessage(parts, payload.message);

	return parts;
}

/**
 * Строит детализированную ошибку HTTP на основе статуса и тела ответа.
 * Для JSON-ответов приоритетно используются поля `error`, `details`, `message`.
 */
async function buildHttpError(res: Response, reportContext?: FetchErrorReportContext): Promise<Error> {
	const contentType = (res.headers.get("Content-Type") || "").toLowerCase();

	try {
		if (contentType.includes("application/json") || contentType.includes("application/odata+json")) {
			const payload = (await res.json()) as Record<string, unknown>;
			const parts = extractJsonErrorParts(payload);

			if (parts.length) {
				return new Error(parts.join(" | "));
			}
		} else {
			const text = await res.text();
			const normalizedText = asNonEmptyString(text);
			if (normalizedText) {
				if (looksLikeHtmlResponse(contentType, normalizedText)) {
					const form = extractFormFromHtml(normalizedText);
					if (isSsoForm(form)) {
						return new SsoRequiredError("Требуется повторная аутентификация", form);
					}

					const error = new Error("Unexpected HTML response from OData endpoint");
					reportUnexpectedHtmlResponse(error, "fetch.buildHttpError", res, normalizedText, reportContext);
					return error;
				}

				return new Error(normalizedText);
			}
		}
	} catch {
		// Ничего не делаем: в этом случае вернем стандартный текст ошибки по статусу.
	}

	return new Error(`HTTP error: ${res.status} ${res.statusText}`);
}

function isSsoRedirectResponse(res: Response) {
	return res.type === "opaqueredirect";
}

async function sendFetchBaseRequest(input: RequestInfo, init: RequestInitType = {}, baseUrlType: BaseURLType = "odata"): Promise<Response> {
	const method = init.method?.toUpperCase() || "GET";
	const headers = new Headers(init.headers);
	const isWrite = !["GET", "HEAD"].includes(method);
	const hasBody = isSafe(init.body);
	const sapRequest = isSapRequest(input, baseUrlType);
	const sapClient = getSapClient(input, baseUrlType);

	headers.set("sap-language", "ru");
	if (sapRequest) {
		headers.set("sap-language", "ru");
		headers.set("sap-contextid-accept", "header");
	}
	if (sapClient) {
		headers.set("sap-client", sapClient);
	}
	if (isWrite && sapRequest) {
		const token = await getCsrfToken(input, baseUrlType, sapClient);
		headers.set("x-csrf-token", token);
	}

	if (!headers.has("Accept")) {
		headers.set("Accept", "application/json");
	}

	if (hasBody && isWrite && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const baseUrl = (baseUrlType && BaseUrlMap[baseUrlType]) ?? "";
	const url = typeof input === "string" ? input : input.toString();
	let res = await fetch(baseUrl + url, {
		...init,
		headers,
		credentials: "include",
		redirect: sapRequest ? "manual" : init.redirect
	});

	if (sapRequest && isSsoRedirectResponse(res)) {
		throw new SsoRequiredError("Требуется повторная аутентификация", undefined, baseUrl + url);
	}

	// Если 401 — возможно, токен истёк, пробуем получить заново и повторить
	if ((res.status === 401 || res.status === 403) && isWrite && sapRequest && !init.retried) {
		const scope = resolveCsrfScope(input, baseUrlType, sapClient);
		csrfTokenCache.delete(scope.cacheKey);
		csrfFetchInProgressCache.delete(scope.cacheKey);
		const token = await getCsrfToken(input, baseUrlType, sapClient);

		const retryHeaders = new Headers(headers);
		retryHeaders.set("x-csrf-token", token);

		res = await fetch(baseUrl + url, {
			...init,
			headers: retryHeaders,
			credentials: "include",
			redirect: "manual",
			retried: true // кастомная метка, чтобы избежать бесконечного цикла
		} as RequestInitType);

		if (isSsoRedirectResponse(res)) {
			throw new SsoRequiredError("Требуется повторная аутентификация", undefined, baseUrl + url);
		}
	}

	return res;
}

async function finalizeFetchBaseResponse(
	res: Response,
	input: RequestInfo,
	init: RequestInitType,
	baseUrlType: BaseURLType,
	sapClient: string | null
) {
	if (!res.ok) {
		if (res.status === 0) {
			throw new Error("Ошибка сети или CORS. Проверьте подключение и настройки сервера.");
		}

		throw await buildHttpError(res, { input, init, baseUrlType, sapClient });
	}

	return res;
}

async function fetchBaseWithoutSsoRecovery(input: RequestInfo, init: RequestInitType = {}, baseUrlType: BaseURLType = "odata") {
	const sapClient = getSapClient(input, baseUrlType);
	const res = await sendFetchBaseRequest(input, init, baseUrlType);
	return finalizeFetchBaseResponse(res, input, init, baseUrlType, sapClient);
}

export async function fetchBase(input: RequestInfo, init: RequestInitType = {}, baseUrlType: BaseURLType = "odata"): Promise<Response> {
	const sapRequest = isSapRequest(input, baseUrlType);
	const sapClient = getSapClient(input, baseUrlType);
	const retry = () => fetchBaseWithoutSsoRecovery(input, { ...init, ssoRetried: true }, baseUrlType);

	if (sapRequest) {
		await waitForSsoRecoveryGate();
	}

	let res: Response;
	try {
		res = await sendFetchBaseRequest(input, init, baseUrlType);
	} catch (error: unknown) {
		if (sapRequest && error instanceof SsoRequiredError && error.recoverable && !init.ssoRetried) {
			res = await recoverSsoSessionAndRetry(error, retry);
		} else {
			throw error;
		}
	}

	try {
		return await finalizeFetchBaseResponse(res, input, init, baseUrlType, sapClient);
	} catch (error: unknown) {
		if (sapRequest && error instanceof SsoRequiredError && error.recoverable && !init.ssoRetried) {
			const recoveredResponse = await recoverSsoSessionAndRetry(error, retry);
			return finalizeFetchBaseResponse(recoveredResponse, input, init, baseUrlType, sapClient);
		}

		throw error;
	}
}

export async function fetchODataJson<T = unknown>(input: RequestInfo, init: RequestInitType = {}, baseUrlType: BaseURLType = "odata") {
	const headers = new Headers(init.headers);

	headers.set("DataServiceVersion", "2.0");
	headers.set("MaxDataServiceVersion", "2.0");

	const requestInit = { ...init, headers };
	const parseContext = { input, init, baseUrlType, sapClient: getSapClient(input, baseUrlType) };

	try {
		const res = await fetchBase(input, requestInit, baseUrlType);
		return await parseResponse<T>(res, parseContext);
	} catch (error: unknown) {
		if (isSapRequest(input, baseUrlType) && error instanceof SsoRequiredError && error.recoverable && !init.ssoRetried) {
			return recoverSsoSessionAndRetry(error, async () => {
				const retryInit = { ...requestInit, ssoRetried: true };
				const res = await fetchBaseWithoutSsoRecovery(input, retryInit, baseUrlType);
				return parseResponse<T>(res, { input, init: retryInit, baseUrlType, sapClient: getSapClient(input, baseUrlType) });
			});
		}

		throw error;
	}
}

export async function fetchJson<T = unknown>(input: RequestInfo, init: RequestInitType = {}, baseUrlType: BaseURLType = "odata") {
	const response = await fetchODataJson<T>(input, init, baseUrlType);
	return response.data;
}

interface FetchQueryFnBaseOptions {
	init?: RequestInit;
	baseUrl?: BaseURLType;
	/** Политика кеширования в Service Worker (`"off"` | `"ttl=24h"` | `"ttl=24h;max=100;name=ref"` | `"bust=24h"` и т.д.) */
	swCache?: string;
}

interface FetchQueryFnOptions<R> extends FetchQueryFnBaseOptions {
	transform: (data: Response) => Promise<R>;
}

export function fetchQueryFn<R = unknown>(url: string, options: FetchQueryFnOptions<R>) {
	const baseUrlValue = options.baseUrl;
	const transform = options.transform;

	return async (params?: { signal?: AbortSignal }): Promise<R> => {
		/**
		 * QueryFn может запускаться повторно после отмены предыдущего refetch.
		 * Нельзя сохранять signal в замыкании: отменённый signal сразу прервёт следующий запрос.
		 */
		const initValue = { ...options.init };
		if (!initValue.signal && params?.signal) {
			initValue.signal = params.signal;
		}
		if (options.swCache) {
			const headers = new Headers(initValue.headers);
			headers.set("x-sw-cache", options.swCache);
			initValue.headers = headers;
		}

		const data = await fetchBase(url, initValue, baseUrlValue);

		if (typeof transform !== "function") {
			throw new Error("fetchQueryFn requires a transformation function!");
		}

		return await transform(data);
	};
}

interface FetchJsonQueryFnOptions<T, R> extends FetchQueryFnBaseOptions {
	transform?: (data: T) => R;
}

/**
 * @deprecated скоро будет замена
 */
export function fetchJsonQueryFn<T, R = T>(url: string, options?: FetchJsonQueryFnOptions<T, R>) {
	const baseUrlValue = options?.baseUrl || "odata";
	const transform = options?.transform;

	return async (params?: { signal: AbortSignal }) => {
		const initValue = options?.init || {};
		if (!initValue.signal && params?.signal) {
			initValue.signal = params.signal;
		}

		if (options?.swCache) {
			const headers = new Headers(initValue.headers);
			headers.set("x-sw-cache", options.swCache);
			initValue.headers = headers;
		}

		const data = await fetchJson<T>(url, initValue, baseUrlValue);

		if (!transform) {
			return data as unknown as R;
		}

		return transform ? transform(data) : (data as unknown as R);
	};
}

/**
 * @deprecated скоро будет замена
 */
export function fetchJsonMutationFn<T = unknown, TBody = unknown>(url: string, method: "POST" | "PUT" = "POST", baseUrl?: BaseURLType) {
	return async (body: TBody, signal?: AbortSignal) => {
		return fetchJson<T>(
			url,
			{
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal
			},
			baseUrl
		);
	};
}

/**
 * @deprecated скоро будет замена
 */
export function fetchDeleteFn<T = unknown>(url: string, baseUrl?: BaseURLType) {
	return async (signal?: AbortSignal) => {
		return fetchJson<T>(url, { method: "DELETE", signal }, baseUrl);
	};
}
