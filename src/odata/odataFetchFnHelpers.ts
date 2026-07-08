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

export function normalizeMethod(method?: string): BaseMethod | undefined {
	if (!method) return undefined;

	const normalized = method.toUpperCase();
	if (normalized === "GET" || normalized === "POST" || normalized === "PUT" || normalized === "DELETE") {
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
		if (method !== "fi") {
			throw new Error(
				`OData operation '${method}' несовместима с FunctionImport '${target.name}'. Для FunctionImport используйте method: 'fi'.`
			);
		}

		return;
	}

	if (method === "fi") {
		throw new Error(
			`OData operation 'fi' несовместима с Entity '${odata.target}'. Для Entity используйте один из методов: 'create', 'update', 'delete', 'read', 'query', 'fm'.`
		);
	}

	if (method === "read" && target.result) {
		throw new Error(
			`OData operation '${method}' несовместима с parameterized query entity '${odata.target}'. Для target с result='${target.result}' используйте method: 'query'.`
		);
	}
}

export function resolveRequestMethod(target: ODataTargetMetadata, method: ODataOperationMethod): BaseMethod {
	if (method === "create") return "POST";
	if (method === "update") return "PUT";
	if (method === "delete") return "DELETE";
	if (method === "read" || method === "query") return "GET";

	if (isFunctionImportMetadata(target)) {
		if (!target.httpMethod) {
			throw new Error(`FunctionImport '${target.name}' не содержит httpMethod в metadata, поэтому operation 'fi' выполнить нельзя.`);
		}

		return target.httpMethod;
	}

	throw new Error(`OData operation '${method}' не поддерживается для target '${"title" in target ? target.title : "unknown"}'.`);
}

export function resolveRequestBody<T = unknown>(body: T | undefined, method: ODataOperationMethod): string | undefined {
	if (body && (method === "create" || method === "update")) {
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

	if (method === "fi") {
		throw new Error(`OData operation 'fi' несовместима с Entity '${odata.target}'.`);
	}

	return buildEntityOperationPath(target, odata, params, method);
}
