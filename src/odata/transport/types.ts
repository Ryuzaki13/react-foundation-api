export type BaseURLType = "odata" | "odataDp0" | "odataUi2" | "config" | "";

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
