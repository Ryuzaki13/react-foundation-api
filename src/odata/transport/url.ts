import { BaseURLType } from "./types";

export const BaseODataURL = "/sap/opu/odata/sap";
/**
 * DP0-прокси используется только для сервиса, который проект явно указывает
 * через `odataProjectAdapter.devDp0Service`.
 */
export const BaseODataDp0URL = __DEV__ || __PREVIEW__ ? "/sap-dp0/opu/odata/sap" : "/sap/opu/odata/sap";
export const BaseODataUI2URL = __DEV__ || __PREVIEW__ ? "/sap-dp0/opu/odata/UI2" : "/sap/opu/odata/UI2";
export const BaseAppConfigURL = __BASE_APP_CONFIG_URL__;

export const BaseUrlMap = Object.freeze<Record<BaseURLType, string>>({
	[""]: "",
	odata: BaseODataURL,
	odataDp0: BaseODataDp0URL,
	odataUi2: BaseODataUI2URL,
	config: BaseAppConfigURL
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
