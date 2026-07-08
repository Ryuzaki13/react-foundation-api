import { fetchJson } from "../odata/transport";

import { normalizeTransportRequests } from "./normalizeTransportRequests";

import type { TransportRequest, TransportRequestRaw, TransportRequestScope, TransportRequestType, UserTransportRequests } from "./types";

const TRANSPORT_SERVICE_BASE_URL = "odataUi2";

const TRANSPORT_REQUEST_PATHS: Record<TransportRequestType, string> = {
	workbench: "/TRANSPORT/WorkbenchRequests",
	customizing: "/TRANSPORT/CustomizingRequests"
};

export const transportRequestKeys = {
	all: ["transportRequests"] as const,
	list: (scope: TransportRequestScope = "workbench") => [...transportRequestKeys.all, scope] as const
};

export function getTransportRequestKey(request: Pick<TransportRequest, "id" | "type">) {
	return `${request.type}:${request.id}`;
}

async function fetchTransportRequestsByType(type: TransportRequestType): Promise<TransportRequest[]> {
	const items = await fetchJson<TransportRequestRaw[]>(TRANSPORT_REQUEST_PATHS[type], undefined, TRANSPORT_SERVICE_BASE_URL);
	return items ? normalizeTransportRequests(items, type) : [];
}

export async function fetchWorkbenchTransportRequests() {
	return fetchTransportRequestsByType("workbench");
}

export async function fetchCustomizingTransportRequests() {
	return fetchTransportRequestsByType("customizing");
}

export async function fetchUserTransportRequests(): Promise<UserTransportRequests> {
	const [workbench, customizing] = await Promise.all([fetchWorkbenchTransportRequests(), fetchCustomizingTransportRequests()]);

	return {
		workbench,
		customizing,
		all: [...workbench, ...customizing]
	};
}

export async function fetchTransportRequests(scope: TransportRequestScope = "workbench"): Promise<TransportRequest[]> {
	if (scope === "workbench") {
		return fetchWorkbenchTransportRequests();
	}

	if (scope === "customizing") {
		return fetchCustomizingTransportRequests();
	}

	return (await fetchUserTransportRequests()).all;
}
