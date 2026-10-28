import { fetchJson } from "../odata/transport";
import { ODATA_BASE_URL_UI2 } from "../odata/transport/odataBaseUrlConstants";

import { normalizeTransportRequests } from "./normalizeTransportRequests";
import { TRANSPORT_REQUEST_TYPE_WORKBENCH, TRANSPORT_REQUEST_TYPE_CUSTOMIZING } from "./transportRequestConstants";

import type { TransportRequest, TransportRequestRaw, TransportRequestScope, TransportRequestType, UserTransportRequests } from "./types";

const TRANSPORT_REQUEST_PATHS: Record<TransportRequestType, string> = {
	workbench: "/TRANSPORT/WorkbenchRequests",
	customizing: "/TRANSPORT/CustomizingRequests"
};

export const transportRequestKeys = {
	all: ["transportRequests"] as const,
	list: (scope: TransportRequestScope = TRANSPORT_REQUEST_TYPE_WORKBENCH) => [...transportRequestKeys.all, scope] as const
};

export function getTransportRequestKey(request: Pick<TransportRequest, "id" | "type">) {
	return `${request.type}:${request.id}`;
}

async function fetchTransportRequestsByType(type: TransportRequestType): Promise<TransportRequest[]> {
	const items = await fetchJson<TransportRequestRaw[]>(TRANSPORT_REQUEST_PATHS[type], undefined, ODATA_BASE_URL_UI2);
	return items ? normalizeTransportRequests(items, type) : [];
}

export async function fetchWorkbenchTransportRequests() {
	return fetchTransportRequestsByType(TRANSPORT_REQUEST_TYPE_WORKBENCH);
}

export async function fetchCustomizingTransportRequests() {
	return fetchTransportRequestsByType(TRANSPORT_REQUEST_TYPE_CUSTOMIZING);
}

export async function fetchUserTransportRequests(): Promise<UserTransportRequests> {
	const [workbench, customizing] = await Promise.all([fetchWorkbenchTransportRequests(), fetchCustomizingTransportRequests()]);

	return {
		workbench,
		customizing,
		all: [...workbench, ...customizing]
	};
}

export async function fetchTransportRequests(scope: TransportRequestScope = TRANSPORT_REQUEST_TYPE_WORKBENCH): Promise<TransportRequest[]> {
	if (scope === TRANSPORT_REQUEST_TYPE_WORKBENCH) {
		return fetchWorkbenchTransportRequests();
	}

	if (scope === TRANSPORT_REQUEST_TYPE_CUSTOMIZING) {
		return fetchCustomizingTransportRequests();
	}

	return (await fetchUserTransportRequests()).all;
}
