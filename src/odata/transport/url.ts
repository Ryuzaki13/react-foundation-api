import {
	ODATA_BASE_URL_DEFAULT,
	ODATA_BASE_URL_DP0,
	ODATA_BASE_URL_UI2,
	ODATA_BASE_URL_CONFIG,
	ODATA_BASE_URL_DIRECT
} from "./odataBaseUrlConstants";
import { BaseURLType } from "./types";

export const BaseODataURL = "/sap/opu/odata/sap";
/**
 * DP0-прокси используется только для сервиса, который проект явно указывает
 * через `odataProjectAdapter.devDp0Service`.
 */
export const BaseODataDp0URL = __DEV__ || __PREVIEW__ ? "/sap-dp0/opu/odata/sap" : BaseODataURL;
export const BaseODataUI2URL = __DEV__ || __PREVIEW__ ? "/sap-dp0/opu/odata/UI2" : "/sap/opu/odata/UI2";
export const BaseAppConfigURL = __BASE_APP_CONFIG_URL__;

export const BaseUrlMap = Object.freeze<Record<BaseURLType, string>>({
	[ODATA_BASE_URL_DIRECT]: "",
	[ODATA_BASE_URL_DEFAULT]: BaseODataURL,
	[ODATA_BASE_URL_DP0]: BaseODataDp0URL,
	[ODATA_BASE_URL_UI2]: BaseODataUI2URL,
	[ODATA_BASE_URL_CONFIG]: BaseAppConfigURL
});

export function getInputUrl(input: RequestInfo) {
	if (typeof input === "string") return input;
	if (typeof Request !== "undefined" && input instanceof Request) {
		return input.url;
	}
	return input.toString();
}

export function normalizeRelativePath(url: string) {
	const path = url.split("?")[0]?.split("#")[0] ?? "";
	if (!path) return "/";
	return path.startsWith("/") ? path : `/${path}`;
}
