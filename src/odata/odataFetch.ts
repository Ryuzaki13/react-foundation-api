import { buildODataFilter, buildODataOrder, type FilterExpression, type Sort } from "@ryuzaki13/react-foundation-lib/odata-service";

import { BaseUrlMap, BaseURLType, fetchODataJson } from "./transport";

export type ODataFetchOptions<T> = {
	/**
	 * Фильтры.
	 *
	 * Корневой объект всегда определяет выражение, которое может состоять из вложенных условий (`conditions: FilterCondition<T>[]`),
	 * либо из других выражений (`filters: FilterExpression<T>[]`).
	 *
	 * @example
	 *
	 * // С использование фабричных функций (рекомендуется)
	 *
	 * expression: {
	 *  and: true,
	 *  filters: [
	 *      createFilterBetween("FKDAT", range),
	 *      createFilterEqual("TEXT_NODE", branches),
	 *      createFilterContains("VSTEL", branchStocks),
	 *  ]
	 * }
	 *
	 * // Без использования фабричных функций (КРАЙНЕ НЕ РЕКОМЕНДУЕТСЯ ТАК ДЕЛАТЬ!)
	 *
	 * expression: {
	 *     and: true,
	 *     filters: [
	 *         {
	 *             and: true,
	 *             conditions: [
	 *                 { key: "FKDAT", value: range[0], operation: "ge" },
	 *                 { key: "FKDAT", value: range[1], operation: "le" }
	 *             ]
	 *         },
	 *         {
	 *             conditions: [
	 *                 { key: "TEXT_NODE", value: "0202", operation: "eq" },
	 *                 { key: "TEXT_NODE", value: "0204", operation: "eq" }
	 *             ]
	 *         },
	 *         {
	 *             conditions: [
	 *                 { key: "VSTEL", value: "1158", operation: "contains" },
	 *                 { key: "VSTEL", value: "1988", operation: "contains" }
	 *             ]
	 *         }
	 *     ]
	 * }
	 */
	expression?: FilterExpression<T>;

	// grouping?: (keyof T)[];
	sorts?: Sort<keyof T>[];
	select?: (keyof T)[];
	expand?: (keyof T)[];
	top?: number;
	skip?: number;

	inlinecount?: string;
	format?: "json";
	baseUrl?: BaseURLType;

	/**
	 * Политика кеширования в Service Worker.
	 *
	 * - `"off"` — network-only (по умолчанию)
	 * - `"ttl=24h"` — cache-first с TTL
	 * - `"ttl=10m;max=200;name=ui"` — TTL с лимитом записей и именованным кешем
	 * - `"bust=24h;name=ref"` — принудительное обновление кеша из сети
	 */
	swCache?: string;
};

function appendQueryOption(query: URLSearchParams, key: string, value?: string | number) {
	if (value === undefined || value === "") return;
	query.set(key, String(value));
}

export type ODataFetchRequestPreview = {
	path: string;
	fullUrl: string;
	baseUrl: BaseURLType | undefined;
	init: RequestInit;
	queryString: string;
};

export function buildODataFetchRequest<T>(entitySetPath: string, options: ODataFetchOptions<T> = {}, init: RequestInit = {}) {
	const [rawPath, rawQuery = ""] = entitySetPath.split("?"); // Если был вызов FI
	const query = new URLSearchParams(rawQuery);

	if (options.expression) {
		const filter = buildODataFilter(options.expression);
		if (filter) query.set("$filter", filter);
	}
	if (options.sorts) query.set("$orderby", buildODataOrder(options.sorts));
	if (options.select) query.set("$select", options.select.join(","));
	if (options.expand) query.set("$expand", options.expand.join(","));

	appendQueryOption(query, "$top", options.top);
	appendQueryOption(query, "$skip", options.skip);
	appendQueryOption(query, "$inlinecount", options.inlinecount);

	const path = rawPath.replace(/\/+$/, "");
	const queryString = query.toString();
	const fullUrl = queryString ? `${path}?${queryString}` : path;
	let requestInit = init;

	// Передаём политику SW-кеширования через заголовок x-sw-cache
	if (options.swCache) {
		const headers = new Headers(init.headers);
		headers.set("x-sw-cache", options.swCache);
		requestInit = { ...init, headers };
	}

	return {
		path: fullUrl,
		fullUrl: `${BaseUrlMap[options.baseUrl ?? "odata"]}${fullUrl}`,
		baseUrl: options.baseUrl,
		init: requestInit,
		queryString
	} satisfies ODataFetchRequestPreview;
}

export async function odataFetch<T, I = T>(entitySetPath: string, options: ODataFetchOptions<T> = {}, init: RequestInit = {}) {
	const request = buildODataFetchRequest(entitySetPath, options, init);

	return fetchODataJson<I>(request.path, request.init, options.baseUrl);
}
