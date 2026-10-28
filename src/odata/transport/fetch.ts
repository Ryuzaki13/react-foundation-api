import { logError } from "@ryuzaki13/react-foundation-lib/utils";
import { asRecord, isRecord, isSafe } from "@ryuzaki13/react-foundation-lib/validators";

import {
	HTTP_METHOD_GET,
	HTTP_METHOD_POST,
	HTTP_METHOD_PUT,
	HTTP_METHOD_DELETE,
	HTTP_HEADER_CONTENT_TYPE,
	HTTP_HEADER_ACCEPT,
	HTTP_CONTENT_TYPE_JSON,
	HTTP_CONTENT_TYPE_HTML,
	HTTP_HEADER_SW_CACHE,
	HTTP_STATUS_NO_CONTENT,
	HTTP_STATUS_RESET_CONTENT,
	HTTP_STATUS_UNAUTHORIZED,
	HTTP_STATUS_FORBIDDEN
} from "../../http/httpProtocolConstants";
import { normalizeODataServiceName, resolveODataBaseUrl, resolveODataSapClient } from "../odataProjectAdapter";

import { ODATA_ERROR_SOURCE_PARSE_RESPONSE, ODATA_ERROR_SOURCE_BUILD_HTTP_ERROR, reportUnexpectedHtmlResponse } from "./errorReport";
import { ODATA_BASE_URL_DEFAULT, ODATA_BASE_URL_DP0, ODATA_BASE_URL_CONFIG, ODATA_BASE_URL_DIRECT } from "./odataBaseUrlConstants";
import {
	ODATA_READ_HTTP_METHODS,
	ODATA_HEADER_SERVICE_VERSION,
	ODATA_HEADER_MAX_SERVICE_VERSION,
	ODATA_SERVICE_VERSION,
	SAP_HEADER_LANGUAGE,
	SAP_REQUEST_LANGUAGE,
	SAP_HEADER_CONTEXT_ID_ACCEPT,
	SAP_CONTEXT_ID_ACCEPT,
	SAP_HEADER_CSRF_TOKEN,
	SAP_HEADER_CLIENT,
	SAP_PATH_PREFIX,
	SAP_DP0_PATH_PREFIX
} from "./odataTransportConstants";
import { isSsoForm, recoverSsoSession, SsoForm, SsoRequiredError } from "./SsoRequiredError";
import { BaseURLType, FetchErrorReportContext, RequestInitType } from "./types";
import { BaseUrlMap, getInputUrl, normalizeRelativePath } from "./url";

const SAP_DP0_CLIENT = "300";
const ODATA_REQUEST_CREDENTIALS = "include";
const ODATA_REQUEST_REDIRECT = "manual";
const ODATA_CONTENT_TYPE_JSON = "application/odata+json";
const NETWORK_ERROR_RESPONSE_STATUS = 0;
const SSO_REQUIRED_MESSAGE = "Требуется повторная аутентификация";
const UNEXPECTED_HTML_RESPONSE_MESSAGE = "Unexpected HTML response from OData endpoint";

const csrfTokenCache = new Map<string, string>();
const csrfFetchInProgressCache = new Map<string, Promise<string>>();
let ssoRecoveryGate: Promise<void> | null = null;
let ssoBlockedError: SsoRequiredError | null = null;

export { normalizeODataServiceName, resolveODataBaseUrl };

function isSapRequest(input: RequestInfo, baseUrlType: BaseURLType) {
	if (baseUrlType !== ODATA_BASE_URL_DIRECT) return true;

	const path = normalizeRelativePath(getInputUrl(input));
	return path.startsWith(SAP_PATH_PREFIX) || path.startsWith(SAP_DP0_PATH_PREFIX);
}

function getSapClient(input: RequestInfo, baseUrlType: BaseURLType): string | null {
	if (__DEV__ || __PREVIEW__) {
		if (!isSapRequest(input, baseUrlType)) return null;
		if (baseUrlType === ODATA_BASE_URL_DP0) return SAP_DP0_CLIENT;
		if (baseUrlType === ODATA_BASE_URL_DIRECT && normalizeRelativePath(getInputUrl(input)).startsWith(SAP_DP0_PATH_PREFIX)) {
			return SAP_DP0_CLIENT;
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
	if (baseUrlType === ODATA_BASE_URL_CONFIG) {
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

	const headers = new Headers({ [SAP_HEADER_CSRF_TOKEN]: "Fetch" });
	headers.set(SAP_HEADER_LANGUAGE, SAP_REQUEST_LANGUAGE);
	headers.set(SAP_HEADER_CONTEXT_ID_ACCEPT, SAP_CONTEXT_ID_ACCEPT);
	headers.set("Accept-Language", SAP_REQUEST_LANGUAGE);
	if (sapClient) {
		headers.set(SAP_HEADER_CLIENT, sapClient);
	}

	const baseUrl = (baseUrlType && BaseUrlMap[baseUrlType]) ?? "";
	const tokenPromise = fetch(baseUrl + scope.fetchUrl, {
		method: HTTP_METHOD_GET,
		headers,
		credentials: ODATA_REQUEST_CREDENTIALS,
		redirect: ODATA_REQUEST_REDIRECT
	})
		.then(async (res) => {
			if (isSsoRedirectResponse(res)) {
				throw new SsoRequiredError(SSO_REQUIRED_MESSAGE, undefined, baseUrl + scope.fetchUrl);
			}

			if (!res.ok) throw new Error("Не удалось получить CSRF-токен");

			const token = res.headers.get(SAP_HEADER_CSRF_TOKEN);
			if (!token) {
				const contentType = (res.headers.get(HTTP_HEADER_CONTENT_TYPE) || "").toLowerCase();
				const text = await res.text();
				if (looksLikeHtmlResponse(contentType, text)) {
					const form = extractFormFromHtml(text);
					if (isSsoForm(form)) {
						throw new SsoRequiredError(SSO_REQUIRED_MESSAGE, form, baseUrl + scope.fetchUrl);
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
			const doc = parser.parseFromString(html, HTTP_CONTENT_TYPE_HTML);
			const form = doc.querySelector("form");
			if (form) {
				const action = form.getAttribute("action") || (typeof window !== "undefined" ? window.location.href : "");
				const method = (form.getAttribute("method") || HTTP_METHOD_GET).toUpperCase();
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
	const method = (extractHtmlAttribute(formAttributes, "method") || HTTP_METHOD_GET).toUpperCase();
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
	return contentType.includes(HTTP_CONTENT_TYPE_HTML) || /<html/i.test(text) || /<form/i.test(text);
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
	if (
		res.status === HTTP_STATUS_NO_CONTENT ||
		res.status === HTTP_STATUS_RESET_CONTENT /*|| res.headers.get("Content-Length") === "0"*/
	) {
		return { data: NO_CONTENT_RESPONSE as T };
	}

	const contentType = (res.headers.get(HTTP_HEADER_CONTENT_TYPE) || "").toLowerCase();

	// Если явный JSON — безопасно парсим
	if (contentType.includes(HTTP_CONTENT_TYPE_JSON) || contentType.includes(ODATA_CONTENT_TYPE_JSON)) {
		const json = await res.json();
		return extractJson<T>(json);
	}

	// Попытка парсинга как текст (на случай, если server неправильно прописал content-type)
	const text = await res.text();

	// если в теле HTML — проверяем, есть ли форма (SSO)
	if (looksLikeHtmlResponse(contentType, text)) {
		const form = extractFormFromHtml(text);
		if (isSsoForm(form)) {
			throw new SsoRequiredError(SSO_REQUIRED_MESSAGE, form);
		}
		const error = new Error(UNEXPECTED_HTML_RESPONSE_MESSAGE);
		reportUnexpectedHtmlResponse(error, ODATA_ERROR_SOURCE_PARSE_RESPONSE, res, text, reportContext);
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
	const contentType = (res.headers.get(HTTP_HEADER_CONTENT_TYPE) || "").toLowerCase();

	try {
		if (contentType.includes(HTTP_CONTENT_TYPE_JSON) || contentType.includes(ODATA_CONTENT_TYPE_JSON)) {
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
						return new SsoRequiredError(SSO_REQUIRED_MESSAGE, form);
					}

					const error = new Error(UNEXPECTED_HTML_RESPONSE_MESSAGE);
					reportUnexpectedHtmlResponse(error, ODATA_ERROR_SOURCE_BUILD_HTTP_ERROR, res, normalizedText, reportContext);
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

async function sendFetchBaseRequest(
	input: RequestInfo,
	init: RequestInitType = {},
	baseUrlType: BaseURLType = ODATA_BASE_URL_DEFAULT
): Promise<Response> {
	const method = init.method?.toUpperCase() || HTTP_METHOD_GET;
	const headers = new Headers(init.headers);
	const isWrite = !ODATA_READ_HTTP_METHODS.includes(method);
	const hasBody = isSafe(init.body);
	const sapRequest = isSapRequest(input, baseUrlType);
	const sapClient = getSapClient(input, baseUrlType);

	headers.set(SAP_HEADER_LANGUAGE, SAP_REQUEST_LANGUAGE);
	if (sapRequest) {
		headers.set(SAP_HEADER_LANGUAGE, SAP_REQUEST_LANGUAGE);
		headers.set(SAP_HEADER_CONTEXT_ID_ACCEPT, SAP_CONTEXT_ID_ACCEPT);
	}
	if (sapClient) {
		headers.set(SAP_HEADER_CLIENT, sapClient);
	}
	if (isWrite && sapRequest) {
		const token = await getCsrfToken(input, baseUrlType, sapClient);
		headers.set(SAP_HEADER_CSRF_TOKEN, token);
	}

	if (!headers.has(HTTP_HEADER_ACCEPT)) {
		headers.set(HTTP_HEADER_ACCEPT, HTTP_CONTENT_TYPE_JSON);
	}

	if (hasBody && isWrite && !headers.has(HTTP_HEADER_CONTENT_TYPE)) {
		headers.set(HTTP_HEADER_CONTENT_TYPE, HTTP_CONTENT_TYPE_JSON);
	}

	const baseUrl = (baseUrlType && BaseUrlMap[baseUrlType]) ?? "";
	const url = typeof input === "string" ? input : input.toString();
	let res = await fetch(baseUrl + url, {
		...init,
		headers,
		credentials: ODATA_REQUEST_CREDENTIALS,
		redirect: sapRequest ? ODATA_REQUEST_REDIRECT : init.redirect
	});

	if (sapRequest && isSsoRedirectResponse(res)) {
		throw new SsoRequiredError(SSO_REQUIRED_MESSAGE, undefined, baseUrl + url);
	}

	// Если 401 — возможно, токен истёк, пробуем получить заново и повторить
	if ((res.status === HTTP_STATUS_UNAUTHORIZED || res.status === HTTP_STATUS_FORBIDDEN) && isWrite && sapRequest && !init.retried) {
		const scope = resolveCsrfScope(input, baseUrlType, sapClient);
		csrfTokenCache.delete(scope.cacheKey);
		csrfFetchInProgressCache.delete(scope.cacheKey);
		const token = await getCsrfToken(input, baseUrlType, sapClient);

		const retryHeaders = new Headers(headers);
		retryHeaders.set(SAP_HEADER_CSRF_TOKEN, token);

		res = await fetch(baseUrl + url, {
			...init,
			headers: retryHeaders,
			credentials: ODATA_REQUEST_CREDENTIALS,
			redirect: ODATA_REQUEST_REDIRECT,
			retried: true // кастомная метка, чтобы избежать бесконечного цикла
		} as RequestInitType);

		if (isSsoRedirectResponse(res)) {
			throw new SsoRequiredError(SSO_REQUIRED_MESSAGE, undefined, baseUrl + url);
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
		if (res.status === NETWORK_ERROR_RESPONSE_STATUS) {
			throw new Error("Ошибка сети или CORS. Проверьте подключение и настройки сервера.");
		}

		throw await buildHttpError(res, { input, init, baseUrlType, sapClient });
	}

	return res;
}

async function fetchBaseWithoutSsoRecovery(
	input: RequestInfo,
	init: RequestInitType = {},
	baseUrlType: BaseURLType = ODATA_BASE_URL_DEFAULT
) {
	const sapClient = getSapClient(input, baseUrlType);
	const res = await sendFetchBaseRequest(input, init, baseUrlType);
	return finalizeFetchBaseResponse(res, input, init, baseUrlType, sapClient);
}

export async function fetchBase(
	input: RequestInfo,
	init: RequestInitType = {},
	baseUrlType: BaseURLType = ODATA_BASE_URL_DEFAULT
): Promise<Response> {
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

export async function fetchODataJson<T = unknown>(
	input: RequestInfo,
	init: RequestInitType = {},
	baseUrlType: BaseURLType = ODATA_BASE_URL_DEFAULT
) {
	const headers = new Headers(init.headers);

	headers.set(ODATA_HEADER_SERVICE_VERSION, ODATA_SERVICE_VERSION);
	headers.set(ODATA_HEADER_MAX_SERVICE_VERSION, ODATA_SERVICE_VERSION);

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

export async function fetchJson<T = unknown>(
	input: RequestInfo,
	init: RequestInitType = {},
	baseUrlType: BaseURLType = ODATA_BASE_URL_DEFAULT
) {
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
			headers.set(HTTP_HEADER_SW_CACHE, options.swCache);
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
	const baseUrlValue = options?.baseUrl || ODATA_BASE_URL_DEFAULT;
	const transform = options?.transform;

	return async (params?: { signal: AbortSignal }) => {
		const initValue = options?.init || {};
		if (!initValue.signal && params?.signal) {
			initValue.signal = params.signal;
		}

		if (options?.swCache) {
			const headers = new Headers(initValue.headers);
			headers.set(HTTP_HEADER_SW_CACHE, options.swCache);
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
export function fetchJsonMutationFn<T = unknown, TBody = unknown>(
	url: string,
	method: typeof HTTP_METHOD_POST | typeof HTTP_METHOD_PUT = HTTP_METHOD_POST,
	baseUrl?: BaseURLType
) {
	return async (body: TBody, signal?: AbortSignal) => {
		return fetchJson<T>(
			url,
			{
				method,
				headers: { [HTTP_HEADER_CONTENT_TYPE]: HTTP_CONTENT_TYPE_JSON },
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
		return fetchJson<T>(url, { method: HTTP_METHOD_DELETE, signal }, baseUrl);
	};
}
