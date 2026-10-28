import {
	HTTP_STATUS_NO_CONTENT,
	HTTP_STATUS_RESET_CONTENT,
	HTTP_HEADER_CONTENT_TYPE,
	HTTP_CONTENT_TYPE_JSON,
	HTTP_HEADER_SW_CACHE,
	HTTP_METHOD_POST
} from "./httpProtocolConstants";

import type { HttpMutationFnOptions, HttpQueryFnOptions, HttpRequestOptions } from "./types";

function resolveHttpUrl(input: RequestInfo | URL, baseUrl?: string) {
	if (!baseUrl || input instanceof Request || input instanceof URL) {
		return input;
	}

	return `${baseUrl}${input}`;
}

function mergeHttpInit(options?: HttpRequestOptions, signal?: AbortSignal): RequestInit {
	if (!signal || options?.init?.signal) {
		return options?.init ?? {};
	}

	return {
		...options?.init,
		signal
	};
}

async function parseHttpResponse(response: Response): Promise<unknown> {
	if (response.status === HTTP_STATUS_NO_CONTENT || response.status === HTTP_STATUS_RESET_CONTENT) {
		return null;
	}

	const contentType = response.headers.get(HTTP_HEADER_CONTENT_TYPE)?.toLowerCase() ?? "";
	if (contentType.includes(HTTP_CONTENT_TYPE_JSON)) {
		return await response.json();
	}

	return await response.text();
}

async function createHttpError(response: Response): Promise<Error> {
	const payload = await parseHttpResponse(response);
	const message = typeof payload === "string" && payload.trim().length > 0 ? payload.trim() : `${response.status} ${response.statusText}`;

	return new Error(`HTTP error: ${message}`);
}

/**
 * Выполняет обычный HTTP-запрос без SAP/OData side effects.
 */
export async function httpFetch(input: RequestInfo | URL, options: HttpRequestOptions = {}): Promise<Response> {
	const response = await fetch(resolveHttpUrl(input, options.baseUrl), options.init);

	if (!response.ok) {
		throw await createHttpError(response);
	}

	return response;
}

/**
 * Возвращает JSON/text payload как `unknown`; доменный слой обязан сузить форму.
 */
export async function httpFetchPayload(input: RequestInfo | URL, options: HttpRequestOptions = {}): Promise<unknown> {
	return await parseHttpResponse(await httpFetch(input, options));
}

/**
 * Собирает queryFn для обычного HTTP endpoint.
 */
export function httpJsonQueryFn<TResult>(url: string, options: HttpQueryFnOptions<TResult>) {
	return async (params?: { readonly signal?: AbortSignal }): Promise<TResult> => {
		const init = mergeHttpInit(options, params?.signal);
		const headers = new Headers(init.headers);

		if (options.swCache) {
			headers.set(HTTP_HEADER_SW_CACHE, options.swCache);
		}

		const payload = await httpFetchPayload(url, {
			baseUrl: options.baseUrl,
			init: {
				...init,
				headers
			}
		});

		return options.parse(payload);
	};
}

/**
 * Собирает mutationFn для обычного HTTP endpoint.
 */
export function httpJsonMutationFn<TInput, TResult>(url: string, options: HttpMutationFnOptions<TInput, TResult>) {
	return async (input: TInput, signal?: AbortSignal): Promise<TResult> => {
		const body = options.mapBody?.(input) ?? input;
		const init = mergeHttpInit(options, signal);
		const headers = new Headers(init.headers);

		if (!headers.has(HTTP_HEADER_CONTENT_TYPE)) {
			headers.set(HTTP_HEADER_CONTENT_TYPE, HTTP_CONTENT_TYPE_JSON);
		}

		const payload = await httpFetchPayload(url, {
			baseUrl: options.baseUrl,
			init: {
				...init,
				method: options.method ?? HTTP_METHOD_POST,
				headers,
				body: JSON.stringify(body)
			}
		});

		return options.parse(payload);
	};
}
