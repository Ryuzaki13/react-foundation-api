/** Значения HTTP-протокола общие для transport adapters и их литеральных контрактов. */
export const HTTP_METHOD_GET = "GET";
export const HTTP_METHOD_POST = "POST";
export const HTTP_METHOD_PUT = "PUT";
export const HTTP_METHOD_PATCH = "PATCH";
export const HTTP_METHOD_DELETE = "DELETE";
export const HTTP_METHOD_HEAD = "HEAD";

export const HTTP_HEADER_CONTENT_TYPE = "Content-Type";
export const HTTP_HEADER_ACCEPT = "Accept";
export const HTTP_HEADER_SW_CACHE = "x-sw-cache";
export const HTTP_HEADER_ORIGIN = "origin";
export const HTTP_CONTENT_TYPE_JSON = "application/json";
export const HTTP_CONTENT_TYPE_HTML = "text/html";

export const HTTP_STATUS_NO_CONTENT = 204;
export const HTTP_STATUS_RESET_CONTENT = 205;
export const HTTP_STATUS_UNAUTHORIZED = 401;
export const HTTP_STATUS_FORBIDDEN = 403;
export const HTTP_STATUS_REQUEST_TIMEOUT = 408;
export const HTTP_STATUS_TOO_EARLY = 425;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
