export type TransportRequestType = "workbench" | "customizing";
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
