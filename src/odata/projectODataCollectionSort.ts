import { compareStrings } from "@ryuzaki13/react-foundation-lib/string-comparison";

import type { ODataCollectionResult } from "./useODataCollectionQuery";
import type { CollectionItem } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Разделяет одну text-проекцию между всеми observer одного Query snapshot.
 *
 * WeakMap не удерживает выгруженный Query в памяти. Пока snapshot активен,
 * дополнительные ракурсы переиспользуют уже отсортированные массивы ссылок
 * вместо повторной сортировки и отдельной копии массивов для каждого observer.
 */
const textProjectionBySource = new WeakMap<ODataCollectionResult<CollectionItem>, ODataCollectionResult<CollectionItem>>();

/**
 * Создаёт observer-проекцию канонического справочника с сортировкой по text.
 *
 * Query cache и persistence продолжают хранить один code-sorted snapshot.
 * Проекция копирует только массивы ссылок в `separated`: исходные строки,
 * объекты элементов, `items`, `chain` и metadata остаются общими.
 */
export function projectODataCollectionSortByText<T extends CollectionItem>(source: ODataCollectionResult<T>): ODataCollectionResult<T> {
	const cachedProjection = textProjectionBySource.get(source);
	if (cachedProjection) {
		return cachedProjection as ODataCollectionResult<T>;
	}

	let hasProjectedLevel = false;
	const separated = Object.fromEntries(
		Object.entries(source.separated).map(([codeKey, items]) => {
			const textKey = source.keyPairsMap[codeKey];
			if (!textKey || items.length < 2) {
				return [codeKey, items];
			}

			hasProjectedLevel = true;
			return [codeKey, [...items].sort((left, right) => compareStrings(String(left[textKey] ?? ""), String(right[textKey] ?? "")))];
		})
	) as Record<string, T[]>;

	if (!hasProjectedLevel) {
		return source;
	}

	const projection = {
		...source,
		separated
	};
	textProjectionBySource.set(source, projection);

	return projection;
}
