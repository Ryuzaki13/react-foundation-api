import { type HTTP_METHOD_POST, type HTTP_METHOD_PUT, type HTTP_METHOD_PATCH, type HTTP_METHOD_DELETE } from "./httpProtocolConstants";

/**
 * Настройки чистого HTTP-запроса без SAP/OData/SAML2 политики.
 */
export type HttpRequestOptions = {
	readonly baseUrl?: string;
	readonly init?: RequestInit;
};

/**
 * Настройки HTTP query factory для TanStack Query.
 */
export type HttpQueryFnOptions<TResult> = HttpRequestOptions & {
	readonly swCache?: string;
	readonly parse: (data: unknown) => TResult;
};

/**
 * Настройки HTTP mutation factory.
 */
export type HttpMutationFnOptions<TInput, TResult> = HttpRequestOptions & {
	readonly method?: typeof HTTP_METHOD_POST | typeof HTTP_METHOD_PUT | typeof HTTP_METHOD_PATCH | typeof HTTP_METHOD_DELETE;
	readonly mapBody?: (input: TInput) => unknown;
	readonly parse: (data: unknown) => TResult;
};
