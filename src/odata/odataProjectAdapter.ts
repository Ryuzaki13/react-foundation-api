import type { BaseURLType } from "./transport/types";

export type ODataProjectTechnicalEndpoint = {
	service: string;
	target: string;
	baseUrl?: BaseURLType;
};

export type ODataProjectAdapter = {
	/**
	 * OData-сервис, который в dev/preview нужно проксировать через DP0.
	 * В проектах без SAP/OData оставляется пустым.
	 */
	devDp0Service?: string;
	resolveSapClient?: () => string | null | undefined;
	metadataVersion?: ODataProjectTechnicalEndpoint;
	collectionUpdates?: ODataProjectTechnicalEndpoint;
};

let odataProjectAdapter: ODataProjectAdapter = {};

export function configureODataProjectAdapter(adapter: ODataProjectAdapter) {
	odataProjectAdapter = adapter;
}

export function getODataProjectAdapter() {
	return odataProjectAdapter;
}

export function normalizeODataServiceName(service: string) {
	return service.split(";")[0] ?? service;
}

export function resolveODataBaseUrl(service: string, baseUrl?: BaseURLType): BaseURLType {
	const devDp0Service = odataProjectAdapter.devDp0Service;
	if ((__DEV__ || __PREVIEW__) && devDp0Service && normalizeODataServiceName(service) === normalizeODataServiceName(devDp0Service)) {
		return "odataDp0";
	}

	return baseUrl ?? "odata";
}

export function resolveODataSapClient() {
	return odataProjectAdapter.resolveSapClient?.() ?? null;
}
