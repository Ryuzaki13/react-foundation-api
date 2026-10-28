import {
	type ODATA_BASE_URL_DEFAULT,
	type ODATA_BASE_URL_DP0,
	type ODATA_BASE_URL_UI2,
	type ODATA_BASE_URL_CONFIG,
	type ODATA_BASE_URL_DIRECT
} from "./odataBaseUrlConstants";

export type BaseURLType =
	| typeof ODATA_BASE_URL_DEFAULT
	| typeof ODATA_BASE_URL_DP0
	| typeof ODATA_BASE_URL_UI2
	| typeof ODATA_BASE_URL_CONFIG
	| typeof ODATA_BASE_URL_DIRECT;

export type RequestInitType = RequestInit & {
	retried?: boolean;
	ssoRetried?: boolean;
};

export type FetchErrorReportContext = {
	input: RequestInfo;
	init: RequestInitType;
	baseUrlType: BaseURLType;
	sapClient: string | null;
};
