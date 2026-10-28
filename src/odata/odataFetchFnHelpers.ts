import {
	BaseMethod,
	buildEntityOperationPath,
	buildFunctionImportPath,
	FunctionImportMetadata,
	ODataOperationMethod,
	ODataServiceConfig,
	ODataTargetMetadata,
	ServiceMetadata,
	WrappedODataParameters
} from "@ryuzaki13/react-foundation-lib/odata-service";

import { HTTP_METHOD_GET, HTTP_METHOD_POST, HTTP_METHOD_PUT, HTTP_METHOD_DELETE } from "../http/httpProtocolConstants";

import {
	ODATA_OPERATION_CREATE,
	ODATA_OPERATION_UPDATE,
	ODATA_OPERATION_DELETE,
	ODATA_OPERATION_READ,
	ODATA_OPERATION_QUERY,
	ODATA_OPERATION_FUNCTION_IMPORT
} from "./odataOperationConstants";

export function normalizeMethod(method?: string): BaseMethod | undefined {
	if (!method) return undefined;

	const normalized = method.toUpperCase();
	if (
		normalized === HTTP_METHOD_GET ||
		normalized === HTTP_METHOD_POST ||
		normalized === HTTP_METHOD_PUT ||
		normalized === HTTP_METHOD_DELETE
	) {
		return normalized;
	}

	return undefined;
}

export function isFunctionImportMetadata(target: ODataTargetMetadata): target is FunctionImportMetadata {
	return "returnType" in target;
}

export function resolveODataTarget(serviceData: ServiceMetadata, targetName: string): ODataTargetMetadata {
	const entity = serviceData?.entities[targetName];
	const functionImport = serviceData?.functionImports[targetName];

	if (entity && functionImport) {
		throw new Error(`Найден конфликт metadata: '${targetName}' существует и как Entity, и как FunctionImport`);
	}

	if (entity) return entity;
	if (functionImport) return functionImport;

	throw new Error(`OData target '${targetName}' не был загружен`);
}

export function validateODataOperation(target: ODataTargetMetadata, method: ODataOperationMethod, odata: ODataServiceConfig): void {
	if (isFunctionImportMetadata(target)) {
		if (method !== ODATA_OPERATION_FUNCTION_IMPORT) {
			throw new Error(
				`OData operation '${method}' несовместима с FunctionImport '${target.name}'. Для FunctionImport используйте method: 'fi'.`
			);
		}

		return;
	}

	if (method === ODATA_OPERATION_FUNCTION_IMPORT) {
		throw new Error(
			`OData operation 'fi' несовместима с Entity '${odata.target}'. Для Entity используйте один из методов: 'create', 'update', 'delete', 'read', 'query', 'fm'.`
		);
	}

	if (method === ODATA_OPERATION_READ && target.result) {
		throw new Error(
			`OData operation '${method}' несовместима с parameterized query entity '${odata.target}'. Для target с result='${target.result}' используйте method: 'query'.`
		);
	}
}

export function resolveRequestMethod(target: ODataTargetMetadata, method: ODataOperationMethod): BaseMethod {
	if (method === ODATA_OPERATION_CREATE) return HTTP_METHOD_POST;
	if (method === ODATA_OPERATION_UPDATE) return HTTP_METHOD_PUT;
	if (method === ODATA_OPERATION_DELETE) return HTTP_METHOD_DELETE;
	if (method === ODATA_OPERATION_READ || method === ODATA_OPERATION_QUERY) return HTTP_METHOD_GET;

	if (isFunctionImportMetadata(target)) {
		if (!target.httpMethod) {
			throw new Error(`FunctionImport '${target.name}' не содержит httpMethod в metadata, поэтому operation 'fi' выполнить нельзя.`);
		}

		return target.httpMethod;
	}

	throw new Error(`OData operation '${method}' не поддерживается для target '${"title" in target ? target.title : "unknown"}'.`);
}

export function resolveRequestBody<T = unknown>(body: T | undefined, method: ODataOperationMethod): string | undefined {
	if (body && (method === ODATA_OPERATION_CREATE || method === ODATA_OPERATION_UPDATE)) {
		return JSON.stringify(body);
	}
	return undefined;
}

export function buildTargetPath(
	target: ODataTargetMetadata,
	odata: ODataServiceConfig,
	params: WrappedODataParameters,
	method: ODataOperationMethod
): string {
	if (isFunctionImportMetadata(target)) {
		return buildFunctionImportPath(target, odata, params);
	}

	if (method === ODATA_OPERATION_FUNCTION_IMPORT) {
		throw new Error(`OData operation 'fi' несовместима с Entity '${odata.target}'.`);
	}

	return buildEntityOperationPath(target, odata, params, method);
}
