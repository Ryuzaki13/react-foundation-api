/* eslint-disable @typescript-eslint/no-unused-vars */
import { QueryClient } from "@tanstack/react-query";

import { odataFetch, ODataFetchOptions } from "./odataFetch";
import {
	buildTargetPath,
	resolveODataTarget,
	resolveRequestBody,
	resolveRequestMethod,
	validateODataOperation
} from "./odataFetchFnHelpers";
import { parseODataResponseByMetadata } from "./parseODataResponseByMetadata";
import { isNoContentResponse, resolveODataBaseUrl } from "./transport/fetch";
import { getODataMetadataData } from "./useODataMetadataQuery";

import type {
	ODataOperationMethod,
	ODataServiceConfig,
	ODataTargetMetadata,
	UnwrappedODataParameters,
	WrapODataParameters
} from "@ryuzaki13/react-foundation-lib/odata-service";

export interface ODataFetchFnSharedOptions<I> {
	/**
	 * Параметры OData сервиса
	 */
	odata: ODataServiceConfig;

	/**
	 * Параметры для формирования дополнительных query param.
	 */
	options?: NoInfer<ODataFetchOptions<I>>;

	/**
	 * Параметры fetch запроса
	 */
	init?: Omit<RequestInit, "signal" | "method" | "body">;

	autoParse?: boolean;

	/**
	 * Политика кеширования в Service Worker.
	 * @see ODataFetchOptions.swCache
	 */
	swCache?: string;
}

export type ODataSingleTransform<I, O> = (data: NoInfer<I>, target: ODataTargetMetadata) => NoInfer<O>;
export type ODataQueryArrayTransform<I, O> = (data: NoInfer<I>[], target: ODataTargetMetadata) => NoInfer<O>[];
export type ODataQuerySingleTransform<I, O> = (data: NoInfer<I>[], target: ODataTargetMetadata) => NoInfer<O>;
export type ODataQueryTransform<I, O> = (data: NoInfer<I>[], target: ODataTargetMetadata) => NoInfer<O>[] | NoInfer<O>;

export type ODataFetchFnSingleOptions<I, O = I> = ODataFetchFnSharedOptions<I> & {
	transform?: ODataSingleTransform<I, O>;
};

export type ODataFetchFnQueryOptions<
	I,
	O = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters
> = ODataFetchFnSharedOptions<I> & {
	params?: WrapODataParameters<P>;
	transform?: ODataQueryTransform<I, O>;
};

export type ODataCreateFnOptions<I, O = I, T = I> = ODataFetchFnSingleOptions<I, O> & {
	body: T;
};

export type ODataUpdateFnOptions<
	I,
	O = I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters
> = ODataFetchFnSingleOptions<I, O> & {
	params: WrapODataParameters<P>;
	body: T;
};

export type ODataDeleteFnOptions<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters> = ODataFetchFnSingleOptions<
	I,
	O
> & {
	params: WrapODataParameters<P>;
};

export type ODataReadFnOptions<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters> = ODataFetchFnSingleOptions<
	I,
	O
> & {
	params: WrapODataParameters<P>;
};

export type ODataQueryFnOptions<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters> = ODataFetchFnQueryOptions<
	I,
	O,
	P
>;

export type ODataFunctionImportFnOptions<
	I,
	O = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters
> = ODataFetchFnSingleOptions<I, O> & {
	params: WrapODataParameters<P>;
};

export type ODataSingleOperationMethod = Exclude<ODataOperationMethod, "query">;
export type ODataArrayOperationMethod = "query";

export type ODataSingleFetchFnRequest<
	M extends ODataSingleOperationMethod,
	I,
	O = I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters
> = M extends "create"
	? ODataCreateFnOptions<I, O, T>
	: M extends "update"
		? ODataUpdateFnOptions<I, O, T, P>
		: M extends "delete"
			? ODataDeleteFnOptions<I, O, P>
			: M extends "read"
				? ODataReadFnOptions<I, O, P>
				: M extends "fi"
					? ODataFunctionImportFnOptions<I, O, P>
					: never;

export type ODataFetchFnRequest<
	M extends ODataOperationMethod,
	I,
	O = I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters
> = M extends "query"
	? ODataQueryFnOptions<I, O, P>
	: M extends ODataSingleOperationMethod
		? ODataSingleFetchFnRequest<M, I, O, T, P>
		: never;

export type ODataFetchFnImplementationArgs =
	| [method: "create", opts: ODataCreateFnOptions<unknown, unknown, unknown>]
	| [method: "update", opts: ODataUpdateFnOptions<unknown, unknown, unknown, UnwrappedODataParameters>]
	| [method: "delete", opts: ODataDeleteFnOptions<unknown, unknown, UnwrappedODataParameters>]
	| [method: "read", opts: ODataReadFnOptions<unknown, unknown, UnwrappedODataParameters>]
	| [method: "query", opts: ODataQueryFnOptions<unknown, unknown, UnwrappedODataParameters>]
	| [method: "fi", opts: ODataFunctionImportFnOptions<unknown, unknown, UnwrappedODataParameters>];

export type ODataFetchFnRunnerResult<TData> = { data: TData; totalCount?: number };
export type ODataFetchFnRunner<TData> = ({
	client,
	signal
}: {
	client: QueryClient;
	signal?: AbortSignal;
}) => Promise<ODataFetchFnRunnerResult<TData>>;

/**
 * Базовый конструктор OData queryFn с явным указанием операции.
 *
 * Это низкоуровневый helper, на котором построены публичные функции:
 *
 * - `odataCreateFn`
 * - `odataUpdateFn`
 * - `odataDeleteFn`
 * - `odataReadFn`
 * - `odataQueryFn`
 * - `odataFunctionImportFn`
 *
 * В обычном прикладном коде рекомендуется использовать именно эти специализированные
 * helpers, а не вызывать `odataFetchFn` напрямую.
 *
 * Что делает функция:
 *
 * - загружает metadata OData-сервиса через `react-query`;
 * - определяет тип target: `Entity` или `FunctionImport`;
 * - валидирует совместимость target и операции;
 * - вычисляет HTTP-метод;
 * - строит path target с учётом metadata;
 * - объединяет `params` target и `options` уровня query string;
 * - при наличии `body` сериализует его через `JSON.stringify`;
 * - может автоматически распарсить ответ по metadata;
 * - может преобразовать результат через `transform`.
 *
 * Параметр `method` описывает семантику OData-операции, а не сырой HTTP-метод:
 *
 * - `"create"`
 * - `"update"`
 * - `"delete"`
 * - `"read"`
 * - `"query"`
 * - `"fi"`
 *
 * Возвращаемое значение — queryFn-совместимая функция, которую можно передавать в
 * `useQuery`, `useInfiniteQuery`, `useMutation` или вызывать вручную.
 *
 * @example
 * ```ts
 * const queryFn = odataFetchFn("query", {
 * 	odata: { service: "TEXT_REPORT_SRV", target: "TEXT_REPORT_ENTITY" },
 * 	params: wrapODataParams({
 * 		p_date: new Date(),
 * 		p_date_to: new Date(),
 * 		type_manager: "main"
 * 	}),
 * 	autoParse: true
 * });
 *
 * const result = await queryFn({ client });
 * ```
 */
export function odataFetchFn<
	I,
	O = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataArrayOperationMethod = ODataArrayOperationMethod
>(method: M, opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQueryArrayTransform<I, O> }): ODataFetchFnRunner<O[]>;
export function odataFetchFn<
	I,
	O = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataArrayOperationMethod = ODataArrayOperationMethod
>(method: M, opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQuerySingleTransform<I, O> }): ODataFetchFnRunner<O>;
export function odataFetchFn<
	I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataArrayOperationMethod = ODataArrayOperationMethod
>(method: M, opts: ODataQueryFnOptions<I, I, P> & { transform?: undefined }): ODataFetchFnRunner<I[]>;
export function odataFetchFn<
	I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataSingleOperationMethod = ODataSingleOperationMethod
>(method: M, opts: ODataSingleFetchFnRequest<M, I, I, T, P> & { transform?: undefined }): ODataFetchFnRunner<I>;
export function odataFetchFn<I, O = I, T = I, M extends ODataSingleOperationMethod = ODataSingleOperationMethod>(
	method: M,
	opts: ODataSingleFetchFnRequest<M, I, O, T> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataFetchFn<
	I,
	O = I,
	T = I,
	P extends UnwrappedODataParameters = UnwrappedODataParameters,
	M extends ODataOperationMethod = ODataOperationMethod
>(method: M, opts: ODataFetchFnRequest<M, I, O, T, P>): ODataFetchFnRunner<unknown>;
export function odataFetchFn(...args: ODataFetchFnImplementationArgs): ODataFetchFnRunner<unknown> {
	const [method, opts] = args;
	const { odata, options = {}, init = {}, autoParse, swCache } = opts;
	const params = "params" in opts ? (opts.params ?? {}) : {};
	// const body = "body" in opts ? opts.body : undefined;

	/**
	 * `client` нужен для использования кеша
	 */
	return async ({ client, signal }: { client: QueryClient; signal?: AbortSignal }) => {
		const baseUrl = resolveODataBaseUrl(odata.service, options.baseUrl);

		const serviceMetadata = await getODataMetadataData({ service: odata.service, baseUrl }, client);
		if (!serviceMetadata) {
			throw new Error(`Не удалось загрузить metadata OData-сервиса '${odata.service}'`);
		}

		const target = resolveODataTarget(serviceMetadata, odata.target);

		validateODataOperation(target, method, odata);

		const body = "body" in opts ? resolveRequestBody(opts.body, method) : undefined;
		const requestMethod = resolveRequestMethod(target, method);
		const isPlainEntityQuery = method === "query" && !("result" in target);

		if (__DEV__ && isPlainEntityQuery && Object.keys(params).length > 0) {
			console.warn(
				`OData query для plain entity "${odata.service}/${odata.target}" получил params, но они будут проигнорированы. Для чтения сущности по ключу используйте odataReadFn.`
			);
		}

		const targetPath = buildTargetPath(target, odata, isPlainEntityQuery ? {} : params, method);

		const queryOptions = swCache ? { ...options, baseUrl, swCache } : { ...options, baseUrl };
		const requestInit = { ...init, method: requestMethod, body, signal };

		if (method === "query") {
			const response = await odataFetch<unknown, unknown[]>(targetPath, queryOptions, requestInit);

			if (isNoContentResponse(response)) {
				throw new Error("OData query не должен возвращать 204 No Content");
			}

			const parsedData = autoParse ? parseODataResponseByMetadata(response.data, target, serviceMetadata) : response.data;
			const transformedData = opts.transform ? opts.transform(parsedData, target) : parsedData;

			return { data: transformedData, totalCount: response.totalCount };
		}

		// NOTE: немного дублирования кода ради правильной типизации без использования 'as' это нормальный компромисс и часто используемая практика

		const response = await odataFetch<unknown>(targetPath, queryOptions, requestInit);

		if (isNoContentResponse(response)) {
			return { data: response.data };
		}

		const parsedData = autoParse ? parseODataResponseByMetadata(response.data, target, serviceMetadata) : response.data;
		const transformedData = opts.transform ? opts.transform(parsedData, target) : parsedData;

		return { data: transformedData, totalCount: response.totalCount };
	};
}

/**
 * Создаёт queryFn для OData `create`-операции.
 *
 * Только для `Entity`.
 *
 * Обязательные поля конфигурации:
 *
 * ```ts
 * {
 * 	odata: ODataServiceConfig;
 * 	body: T;
 * }
 * ```
 *
 * Поведение:
 *
 * - HTTP-метод: `POST`;
 * - `body` обязателен;
 * - `body` сериализуется внутри `odataFetchFn`;
 * - `params` запрещены;
 * - путь: `/SERVICE/ENTITY`;
 * - target должен быть обычной `Entity`, а не `FunctionImport`.
 *
 * Используйте эту функцию для сценариев создания записи по телу запроса, когда
 * ключи в URL не требуются.
 *
 * Обычно `I` — raw-тип ответа, а `T` — тип тела.
 * В большинстве случаев они совпадают, но при необходимости тело можно типизировать отдельно.
 *
 * Пример:
 *
 * ```ts
 * const mutationFn = odataCreateFn<Variant>({
 * 	odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_VARIANT" },
 * 	body: {
 * 		id: "uuid-4",
 * 		name: "Новый вариант"
 * 	}
 * });
 * ```
 */
export function odataCreateFn<I, T = I>(opts: ODataCreateFnOptions<I, I, T> & { transform?: undefined }): ODataFetchFnRunner<I>;
export function odataCreateFn<I, O = I, T = I>(
	opts: ODataCreateFnOptions<I, O, T> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataCreateFn<I, O = I, T = I>(opts: ODataCreateFnOptions<I, O, T>) {
	return odataFetchFn<I, O, T, never, "create">("create", opts);
}

/**
 * Создаёт queryFn для OData `update`-операции.
 *
 * Только для `Entity`.
 *
 * Обязательные поля конфигурации:
 *
 * ```ts
 * {
 * 	odata: ODataServiceConfig;
 * 	params: UnwrappedODataParameters;
 * 	body: T;
 * }
 * ```
 *
 * Поведение:
 *
 * - HTTP-метод: `PUT`;
 * - `params` обязательны и используются для построения key/path части URL;
 * - `body` обязателен и сериализуется внутри функции;
 * - путь: `/SERVICE/ENTITY(params...)`;
 * - target должен быть `Entity`.
 *
 * Используйте эту функцию, когда backend ожидает одновременную передачу ключа
 * в URL и обновляемого состояния в теле запроса.
 *
 * @example
 * ```ts
 * const mutationFn = odataUpdateFn<ThemePayload>({
 * 	odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_THEME" },
 * 	params: wrapODataParams({ name: value }),
 * 	body: { name: value }
 * });
 * ```
 */
export function odataUpdateFn<I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataUpdateFnOptions<I, I, T, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataUpdateFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataUpdateFnOptions<I, O, T, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataUpdateFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataUpdateFnOptions<I, O, T, P>
) {
	return odataFetchFn<I, O, T, P, "update">("update", opts);
}

/**
 * Создаёт queryFn для OData `delete`-операции.
 *
 * Только для `Entity`.
 *
 * Обязательные поля конфигурации:
 *
 * ```ts
 * {
 * 	odata: ODataServiceConfig;
 * 	params: UnwrappedODataParameters;
 * }
 * ```
 *
 * Поведение:
 *
 * - HTTP-метод: `DELETE`;
 * - `params` обязательны;
 * - `body` не поддерживается;
 * - путь: `/SERVICE/ENTITY(params...)`;
 * - target должен быть `Entity`.
 *
 * Подходит для удаления записи по ключу, когда backend игнорирует тело запроса
 * и определяет удаляемую сущность только по параметрам URL.
 *
 * @example
 * ```ts
 * const mutationFn = odataDeleteFn({
 * 	odata: { service: "TEXT_CONFIG_SRV", target: "TextPresetSet" },
 * 	params: wrapODataParams({ recId: "uuid-1" })
 * });
 * ```
 */
export function odataDeleteFn<I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataDeleteFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataDeleteFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataDeleteFnOptions<I, O, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataDeleteFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataDeleteFnOptions<I, O, P>
) {
	return odataFetchFn<I, O, T, P, "delete">("delete", opts);
}

/**
 * Создаёт queryFn для OData `read`-операции.
 *
 * Только для `Entity`.
 *
 * Обязательные поля конфигурации:
 *
 * ```ts
 * {
 * 	odata: ODataServiceConfig;
 * 	params: UnwrappedODataParameters;
 * }
 * ```
 *
 * Поведение:
 *
 * - HTTP-метод: `GET`;
 * - `params` обязательны;
 * - `body` не поддерживается;
 * - путь: `/SERVICE/ENTITY(params...)`;
 * - нельзя использовать для parameterized query entity, у которой в metadata есть `result`.
 *
 * Это режим чтения конкретной сущности или key-based target.
 * Если target на самом деле является query-сущностью с `/Set` или `/Results`,
 * нужно использовать `odataQueryFn`.
 *
 * @example
 * ```ts
 * const queryFn = odataReadFn<Variant>({
 * 	odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_VARIANT" },
 * 	params: wrapODataParams({ variantId: "uuid-1" })
 * });
 * ```
 */
export function odataReadFn<I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataReadFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataReadFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataReadFnOptions<I, O, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataReadFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataReadFnOptions<I, O, P>
) {
	return odataFetchFn<I, O, T, P, "read">("read", opts);
}

/**
 * Создаёт queryFn для OData `query`-операции.
 *
 * Это основной helper для чтения списков и query-сущностей.
 *
 * Поведение зависит от metadata target:
 *
 * - для обычной `Entity` путь будет `/SERVICE/ENTITY`;
 * - для parameterized query entity путь будет `/SERVICE/ENTITY(params...)/Set` или `/Results`.
 *
 * Конфигурация:
 *
 * ```ts
 * {
 * 	odata: ODataServiceConfig;
 * 	params?: UnwrappedODataParameters;
 * 	options?: ODataFetchOptions<T>;
 * }
 * ```
 *
 * Особенности:
 *
 * - HTTP-метод всегда `GET`;
 * - `params` необязательны на уровне типов;
 * - для plain entity переданные `params` будут проигнорированы;
 * - для query entity с `metadata.result` параметры реально участвуют в URL;
 * - `body` не поддерживается.
 *
 * Это функция по умолчанию для большинства `useQuery`-сценариев в проекте.
 *
 * @example
 * ```ts
 * const queryFn = odataQueryFn<RawRow, Row>({
 * 	odata: { service: "TEXT_REPORT_SRV", target: "TEXT_REPORT_ENTITY" },
 * 	params: wrapODataParams({
 * 		p_date: new Date(),
 * 		p_date_to: new Date(),
 * 		type_manager: "main"
 * 	}),
 * 	autoParse: true,
 * 	transform: (rows) => rows.map(mapRow)
 * });
 * ```
 */
export function odataQueryFn<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQueryArrayTransform<I, O> }
): ODataFetchFnRunner<O[]>;
export function odataQueryFn<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, O, P> & { transform: ODataQuerySingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataQueryFn<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataQueryFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I[]>;
export function odataQueryFn<I, O = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(opts: ODataQueryFnOptions<I, O, P>) {
	return odataFetchFn<I, O, void, P, "query">("query", opts);
}

/**
 * Создаёт queryFn для вызова OData `FunctionImport`.
 *
 * Используйте эту функцию только для target, который опубликован в metadata как `FunctionImport`.
 *
 * Конфигурация:
 *
 * ```ts
 * {
 * 	odata: ODataServiceConfig;
 * 	params: UnwrappedODataParameters;
 * }
 * ```
 *
 * Поведение:
 *
 * - HTTP-метод берётся из metadata `FunctionImport`;
 * - если metadata не содержит `httpMethod`, будет выброшена ошибка;
 * - `params` обязательны;
 * - `body` не поддерживается;
 * - параметры target попадают в query string;
 * - `options` (`$select`, `$top`, `$filter` и т.д.) дописываются в тот же query string.
 *
 * Эта функция нужна для вызовов backend-операций, опубликованных как `FunctionImport`,
 * когда transport-семантика определяется самим OData-сервисом.
 *
 * @example
 * ```ts
 * const mutationFn = odataFunctionImportFn<CreateTransportRequestRaw, TransportRequest>({
 * 	odata: { service: "TEXT_CONFIG_SRV", target: "createTextRequest" },
 * 	params: wrapODataParams({
 * 		type: "workbench",
 * 		text: "Новый транспорт"
 * 	}),
 * 	transform: (raw) => mapCreatedTransportRequest(raw, "workbench")
 * });
 * ```
 */
export function odataFunctionImportFn<I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataFunctionImportFnOptions<I, I, P> & { transform?: undefined }
): ODataFetchFnRunner<I>;
export function odataFunctionImportFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataFunctionImportFnOptions<I, O, P> & { transform: ODataSingleTransform<I, O> }
): ODataFetchFnRunner<O>;
export function odataFunctionImportFn<I, O = I, T = I, P extends UnwrappedODataParameters = UnwrappedODataParameters>(
	opts: ODataFunctionImportFnOptions<I, O, P>
) {
	return odataFetchFn<I, O, T, P, "fi">("fi", opts);
}
