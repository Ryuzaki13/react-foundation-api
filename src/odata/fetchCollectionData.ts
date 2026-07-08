import { type CollectionItem } from "@ryuzaki13/react-foundation-lib/odata";
import { logError } from "@ryuzaki13/react-foundation-lib/utils";

import { odataFetch, type ODataFetchOptions } from "./odataFetch";
import { isNoContentResponse } from "./transport";

// Тип для результата запроса справочника
interface ODataServiceResult<T extends CollectionItem> {
	items: T[];
}

/**
 * Загрузка данных справочника из OData сервиса
 */
export async function fetchCollectionData<T extends CollectionItem>(params: {
	url: string;
	query?: ODataFetchOptions<T>;
	signal: AbortSignal;
}): Promise<ODataServiceResult<T>> {
	const { url, query, signal } = params;

	try {
		// Загружаем данные из OData сервиса
		const response = await odataFetch<T, T[]>(url, query, { signal });

		// Считаем отсутствие данных ошибкой, ведь query запрос обязан вернуть корректное тело json
		if (isNoContentResponse(response)) {
			throw new Error("отсутствует тело ответа");
		}

		const data = response.data;

		// Удаление ненужных полей.

		return {
			// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
			items: data.map(({ ID, CNT, __metadata, __Parameters, ...item }) => item as T) /*, pairs, pairsMap */
		};
	} catch (error) {
		logError("Ошибка загрузки справочника:", error);
		// throw error;

		return { items: [] };
	}
}
