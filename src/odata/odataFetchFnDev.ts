import { notify } from "@ryuzaki13/react-foundation-lib/notifications";
import { QueryClient } from "@tanstack/react-query";

import { buildODataFetchRequest, ODataFetchRequestPreview } from "./odataFetch";
import {
	ODataArrayOperationMethod,
	ODataCreateFnOptions,
	ODataDeleteFnOptions,
	odataFetchFn,
	ODataFetchFnImplementationArgs,
	ODataFetchFnRequest,
	ODataFetchFnRunner,
	ODataFetchFnSharedOptions,
	ODataFunctionImportFnOptions,
	ODataQueryArrayTransform,
	ODataQueryFnOptions,
	ODataQuerySingleTransform,
	ODataReadFnOptions,
	ODataSingleFetchFnRequest,
	ODataSingleOperationMethod,
	ODataSingleTransform,
	ODataUpdateFnOptions
} from "./odataFetchFn";
import {
	buildTargetPath,
	isFunctionImportMetadata,
	resolveODataTarget,
	resolveRequestBody,
	resolveRequestMethod,
	validateODataOperation
} from "./odataFetchFnHelpers";
import { resolveODataBaseUrl } from "./transport";
import { getODataMetadataData } from "./useODataMetadataQuery";

import type {
	ODataOperationMethod,
	ODataServiceConfig,
	ODataTargetMetadata,
	UnwrappedODataParameters,
	WrappedODataParameters
} from "@ryuzaki13/react-foundation-lib/odata-service";

type ODataDevHelperName =
	| "odataFetchFnDev"
	| "odataCreateFnDev"
	| "odataUpdateFnDev"
	| "odataDeleteFnDev"
	| "odataReadFnDev"
	| "odataQueryFnDev"
	| "odataFunctionImportFnDev";

type ODataFetchFnDevOptions<I> = ODataFetchFnSharedOptions<I> & {
	params?: WrappedODataParameters;
	body?: unknown;
	transform?: unknown;
};

type ODataDevRequestLogInfo = {
	helperName: ODataDevHelperName;
	operation: ODataOperationMethod;
	odata: ODataServiceConfig;
	target: ODataTargetMetadata;
	targetPath: string;
	request: ODataFetchRequestPreview;
	requestMethod: string;
	params: WrappedODataParameters;
	queryOptions: unknown;
	body: string | undefined;
	autoParse: boolean | undefined;
	hasTransform: boolean;
};

function getConsole() {
	return globalThis.console;
}

function headersToRecord(headers: HeadersInit | undefined) {
	const result: Record<string, string> = {};
	new Headers(headers).forEach((value, key) => {
		result[key] = value;
	});

	return result;
}

function parseRequestBodyForLog(body: BodyInit | null | undefined): unknown {
	if (body === undefined || body === null) return undefined;
	if (typeof body !== "string") return body;

	try {
		const parsed: unknown = JSON.parse(body);
		return parsed;
	} catch {
		return body;
	}
}

function isWriteRequest(method: string | undefined) {
	return method !== undefined && !["GET", "HEAD"].includes(method.toUpperCase());
}

function isSapRequestPreview(request: ODataFetchRequestPreview) {
	const baseUrl = request.baseUrl ?? "odata";
	if (baseUrl !== "") return true;

	return request.path.startsWith("/sap/") || request.path.startsWith("/sap-dp0/");
}

function hasHeader(headers: Record<string, string>, name: string) {
	const normalizedName = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
}

function setDefaultHeader(headers: Record<string, string>, name: string, value: string) {
	if (hasHeader(headers, name)) return;
	headers[name] = value;
}

function buildTransportHeadersPreview(request: ODataFetchRequestPreview) {
	const headers = headersToRecord(request.init.headers);
	const method = request.init.method;
	const sapRequest = isSapRequestPreview(request);

	setDefaultHeader(headers, "DataServiceVersion", "2.0");
	setDefaultHeader(headers, "MaxDataServiceVersion", "2.0");
	setDefaultHeader(headers, "Accept", "application/json");

	headers["sap-language"] = "ru";

	if (sapRequest) {
		headers["sap-contextid-accept"] = "header";
	}

	if (isWriteRequest(method) && request.init.body) {
		setDefaultHeader(headers, "Content-Type", "application/json");
	}

	if (isWriteRequest(method) && sapRequest) {
		setDefaultHeader(headers, "x-csrf-token", "<получается отдельным GET перед реальным write-запросом>");
	}

	return headers;
}

function getTargetKind(target: ODataTargetMetadata) {
	if (isFunctionImportMetadata(target)) return "FunctionImport";
	return target.result ? "Parameterized Entity" : "Entity";
}

function logObjectSection(title: string, value: unknown) {
	const logger = getConsole();
	logger.groupCollapsed(title);
	logger.info(value);
	logger.groupEnd();
}

function logODataDevRequest(info: ODataDevRequestLogInfo) {
	const logger = getConsole();
	const bodyPreview = parseRequestBodyForLog(info.request.init.body);
	const initHeaders = headersToRecord(info.request.init.headers);
	const transportHeaders = buildTransportHeadersPreview(info.request);
	const requestInitPreview = {
		method: info.request.init.method,
		headers: initHeaders,
		body: bodyPreview,
		hasSignal: Boolean(info.request.init.signal)
	};

	logger.groupCollapsed(`[OData DEV] ${info.requestMethod} ${info.request.fullUrl}`);
	logger.table([
		{
			helper: info.helperName,
			operation: info.operation,
			target: info.odata.target,
			targetKind: getTargetKind(info.target),
			service: info.odata.service,
			realFetch: "не выполнялся"
		}
	]);
	logger.info("Итоговый URL:", info.request.fullUrl);
	logger.info("Path без base URL:", info.request.path);
	logger.info("Target path до query options:", info.targetPath);
	logger.info("Query string:", info.request.queryString || "<пусто>");
	logger.info("Body:", bodyPreview ?? "<пусто>");
	logger.info("Auto parse:", info.autoParse ?? false);
	logger.info("Transform:", info.hasTransform ? "передан, но не вызывается без ответа backend" : "не передан");
	logger.info("Dry-run result:", info.operation === "query" ? { data: [], totalCount: 0 } : { data: undefined });
	logObjectSection("OData config", info.odata);
	logObjectSection("Target metadata", info.target);
	logObjectSection("Target params", info.params);
	logObjectSection("Query options", info.queryOptions);
	logObjectSection("RequestInit, переданный в transport", requestInitPreview);
	logObjectSection("Заголовки после transport defaults (без реального fetch)", transportHeaders);
	logger.groupEnd();
}

function notifyODataDevHelperCall(helperName: ODataDevHelperName) {
	notify.warning(`${helperName}: DEV dry-run OData запроса. Реальный запрос не выполняется, payload выведен в console.`, {
		title: "OData DEV helper"
	});
}

function createODataFetchFnDevRunner<I>(
	method: ODataOperationMethod,
	opts: ODataFetchFnDevOptions<I>,
	helperName: ODataDevHelperName
): ODataFetchFnRunner<unknown> {
	const { odata, options = {}, init = {}, autoParse, swCache } = opts;
	const params = opts.params ?? {};

	return async ({ client, signal }: { client: QueryClient; signal?: AbortSignal }) => {
		notifyODataDevHelperCall(helperName);

		const baseUrl = resolveODataBaseUrl(odata.service, options.baseUrl);
		const serviceMetadata = await getODataMetadataData({ service: odata.service, baseUrl }, client);
		if (!serviceMetadata) {
			throw new Error(`Не удалось загрузить metadata OData-сервиса '${odata.service}'`);
		}

		const target = resolveODataTarget(serviceMetadata, odata.target);

		validateODataOperation(target, method, odata);

		const body = resolveRequestBody(opts.body, method);
		const requestMethod = resolveRequestMethod(target, method);
		const targetPath = buildTargetPath(target, odata, params, method);

		const queryOptions = swCache ? { ...options, baseUrl, swCache } : { ...options, baseUrl };
		const requestInit = { ...init, method: requestMethod, body, signal };
		const request = buildODataFetchRequest(targetPath, queryOptions, requestInit);

		logODataDevRequest({
			helperName,
			operation: method,
			odata,
			target,
			targetPath,
			request,
			requestMethod,
			params,
			queryOptions,
			body,
			autoParse,
			hasTransform: Boolean(opts.transform)
		});

		if (method === "query") {
			return { data: [], totalCount: 0 };
		}

		return { data: undefined };
	};
}

export function odataFetchFnDev<
	I,
	O = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataArrayOperationMethod = ODataArrayOperationMethod
>(method: M, opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQueryArrayTransform<I, O> }): ODataFetchFnRunner<O[]>;
export function odataFetchFnDev<
	I,
	O = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataArrayOperationMethod = ODataArrayOperationMethod
>(method: M, opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQuerySingleTransform<I, O> }): ODataFetchFnRunner<O>;
export function odataFetchFnDev<
	I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataArrayOperationMethod = ODataArrayOperationMethod
>(method: M, opts: ODataQueryFnOptions<I, I, P> & { transform?: undefined }): ODataFetchFnRunner<I[]>;
export function odataFetchFnDev<
	I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataSingleOperationMethod = ODataSingleOperationMethod
>(method: M, opts: ODataSingleFetchFnRequest<M, I, I, T, P> & { transform?: undefined }): ODataFetchFnRunner<I>;
export function odataFetchFnDev<I, O = I, T = I, M extends ODataSingleOperationMethod = ODataSingleOperationMethod>(
	method: M,
	opts: ODataSingleFetchFnRequest<M, I, O, T> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataFetchFnDev<
	I,
	O = I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataOperationMethod = ODataOperationMethod
>(method: M, opts: ODataFetchFnRequest<M, I, O, T, P>): ODataFetchFnRunner<unknown>;
export function odataFetchFnDev(...args: ODataFetchFnImplementationArgs): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		switch (args[0]) {
			case "create": {
				return odataFetchFn("create", args[1]);
			}

			case "update": {
				return odataFetchFn("update", args[1]);
			}

			case "delete": {
				return odataFetchFn("delete", args[1]);
			}

			case "read": {
				return odataFetchFn("read", args[1]);
			}

			case "query": {
				return odataFetchFn("query", args[1]);
			}

			case "fi": {
				return odataFetchFn("fi", args[1]);
			}

			default: {
				const checker: never = args[0];
				void checker;

				throw new Error("Неподдерживаемая OData operation в odataFetchFnDev");
			}
		}
	}

	const [method, opts] = args;
	return createODataFetchFnDevRunner(method, opts, "odataFetchFnDev");
}

export function odataCreateFnDev<I, T = I>(opts: ODataCreateFnOptions<I, I, T> & { transform?: undefined }): ODataFetchFnRunner<I>;
export function odataCreateFnDev<I, O = I, T = I>(
	opts: ODataCreateFnOptions<I, O, T> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataCreateFnDev<I, O = I, T = I>(opts: ODataCreateFnOptions<I, O, T>): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		return odataFetchFn<I, O, T, never, "create">("create", opts);
	}

	return createODataFetchFnDevRunner<I>("create", opts, "odataCreateFnDev");
}

export function odataUpdateFnDev<I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataUpdateFnOptions<I, I, T, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataUpdateFnDev<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataUpdateFnOptions<I, O, T, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataUpdateFnDev<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataUpdateFnOptions<I, O, T, P>
): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		return odataFetchFn<I, O, T, P, "update">("update", opts);
	}

	return createODataFetchFnDevRunner<I>("update", opts, "odataUpdateFnDev");
}

export function odataDeleteFnDev<I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataDeleteFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataDeleteFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataDeleteFnOptions<I, O, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataDeleteFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataDeleteFnOptions<I, O, P>
): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		return odataFetchFn<I, O, I, P, "delete">("delete", opts);
	}

	return createODataFetchFnDevRunner<I>("delete", opts, "odataDeleteFnDev");
}

export function odataReadFnDev<I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataReadFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataReadFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataReadFnOptions<I, O, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataReadFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataReadFnOptions<I, O, P>
): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		return odataFetchFn<I, O, I, P, "read">("read", opts);
	}

	return createODataFetchFnDevRunner<I>("read", opts, "odataReadFnDev");
}

export function odataQueryFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQueryArrayTransform<I, O> }
): ODataFetchFnRunner<O[]>;
export function odataQueryFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQuerySingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataQueryFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, O, P> & { transform?: undefined }
): ODataFetchFnRunner<I[]>;
export function odataQueryFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, O, P>
): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		return odataFetchFn<I, O, void, P, "query">("query", opts);
	}

	return createODataFetchFnDevRunner<I>("query", opts, "odataQueryFnDev");
}

export function odataFunctionImportFnDev<I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataFunctionImportFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataFunctionImportFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataFunctionImportFnOptions<I, O, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataFunctionImportFnDev<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataFunctionImportFnOptions<I, O, P>
): ODataFetchFnRunner<unknown> {
	if (!__DEV__) {
		return odataFetchFn<I, O, I, P, "fi">("fi", opts);
	}

	return createODataFetchFnDevRunner<I>("fi", opts, "odataFunctionImportFnDev");
}
