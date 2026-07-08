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
	readonly method?: "POST" | "PUT" | "PATCH" | "DELETE";
	readonly mapBody?: (input: TInput) => unknown;
	readonly parse: (data: unknown) => TResult;
};
