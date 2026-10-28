import { type TRANSPORT_REQUEST_TYPE_WORKBENCH, type TRANSPORT_REQUEST_TYPE_CUSTOMIZING } from "./transportRequestConstants";

export type TransportRequestType = typeof TRANSPORT_REQUEST_TYPE_WORKBENCH | typeof TRANSPORT_REQUEST_TYPE_CUSTOMIZING;
export type TransportRequestScope = TransportRequestType | "all";

export interface TransportRequest {
	id: string;
	type: TransportRequestType;
	text: string;
	isDefaultRequest: boolean;
}

export interface TransportRequestRaw {
	id?: string | null;
	description?: string | null;
	isDefaultRequest?: boolean | null;
}

export interface UserTransportRequests {
	workbench: TransportRequest[];
	customizing: TransportRequest[];
	all: TransportRequest[];
}
