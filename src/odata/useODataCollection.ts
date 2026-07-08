import { useCallback, useMemo, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { createODataCollectionQueryKey } from "./createODataCollectionQueryKey";
import { ODataCollectionConfig, ODataCollectionModel } from "./types";
import { useODataCollectionQuery } from "./useODataCollectionQuery";

import type { CollectionItem } from "@ryuzaki13/react-foundation-lib/odata";

interface UseODataCollectionProps {
	odata: ODataCollectionConfig;
	model: Required<ODataCollectionModel>;

	/**
	 * Размер страницы для виртуализации.
	 */
	pageSize?: number;

	filter?: (item: CollectionItem) => boolean;
}

export function useODataCollection({
	odata,
	model,
	// filter,
	pageSize = 50
}: UseODataCollectionProps) {
	const { codeKey, maxVisibleItems } = model;
	const { data: rawData, isLoading, isError, refetch } = useODataCollectionQuery(odata);

	const textKey = rawData?.keyPairsMap[codeKey] ?? "";

	// Клиент для инвалидации запросов
	const queryClient = useQueryClient();

	const [filteredKeys, setFilteredKeys] = useState<Set<string>>();

	const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	/**
	 * itemsMap - индекс элементов для быстрого поиска
	 * orderedKeys - упорядоченный список ключей для сохранения порядка
	 */
	const { itemsMap, separatedItems, orderedKeys } = useMemo(() => {
		const itemsMap = new Map<string, CollectionItem>();
		const orderedKeys = [] as string[];
		let separatedItems: CollectionItem[] = [];

		if (rawData && rawData.separated[codeKey]) {
			separatedItems = rawData.separated[codeKey];

			for (const item of separatedItems) {
				const key = item[codeKey];
				if (key) {
					itemsMap.set(key, item);
					orderedKeys.push(key);
				}
			}
		}

		return { itemsMap, separatedItems, orderedKeys };
	}, [rawData, codeKey]);

	// Создание индекса поиска для текстовых полей
	const buildSearchIndex = useCallback(
		(field: string) => {
			const items = rawData?.separated[codeKey];

			if (!items) {
				return new Map<string, Set<string>>();
			}

			const index = new Map<string, Set<string>>();

			// Создаем индекс по префиксам для быстрого поиска
			for (const item of items) {
				const value = item[field]?.toLowerCase();
				if (!value) continue;

				// Индексируем по префиксам длиной 1-5 символов
				for (let i = 1; i <= Math.min(5, value.length); i++) {
					const prefix = value.substring(0, i);
					if (!index.has(prefix)) {
						index.set(prefix, new Set<string>());
					}
					index.get(prefix)!.add(item[codeKey]);
				}
			}

			return index;
		},
		[rawData, codeKey]
	);

	/**
	 * Устанавливает несколько фильтров зависимостей.
	 *
	 * Сформированный список ключей пойдёт в фильтрацию элементов текущей коллекции по `codeKey`
	 */
	const setFilteredItems = useCallback(
		(filters: CollectionItem[] | undefined) => {
			setFilteredKeys(() => {
				if (filters?.length) {
					return new Set(filters.map((item) => item[codeKey]));
				}

				return undefined;
			});
		},
		[codeKey]
	);

	const getItems = useCallback(
		(
			predicate?: (codeValue: string, textValue: string) => boolean,
			currentSelectedKeys?: readonly CollectionItem[]
		): CollectionItem[] => {
			if (!orderedKeys.length) return [];

			const limit = maxVisibleItems;
			const selectedKeysSet = new Set<string>();
			const resultItems: CollectionItem[] = [];

			if (currentSelectedKeys?.length) {
				// Быстрое заполнение Set без создания временного массива
				for (let i = 0; i < currentSelectedKeys.length; i++) {
					selectedKeysSet.add(currentSelectedKeys[i][codeKey]);
				}
			}

			let count = 0;

			const existsDependencies = filteredKeys && filteredKeys.size > 0;

			// Единый проход с ранним выходом по лимиту
			for (const key of orderedKeys) {
				if (count >= limit) break;

				const item = itemsMap.get(key);
				if (!item) continue;

				// Проверка на исключение выбранных ключей
				if (selectedKeysSet.size > 0 && selectedKeysSet.has(key)) {
					continue;
				}

				const itemCode = item[codeKey];

				if (existsDependencies && !filteredKeys.has(itemCode)) continue;

				// Проверка внешнего предиката
				if (predicate && !predicate(itemCode, item[textKey])) continue;

				resultItems.push(item);
				count++;
			}

			return resultItems;
		},
		[orderedKeys, maxVisibleItems, codeKey, itemsMap, filteredKeys, textKey]
	);

	/**
	 * Получает страницу данных для виртуализации.
	 */
	const getPage = useCallback(
		(pageIndex: number): CollectionItem[] => {
			const allItems = rawData?.separated[codeKey] || [];
			const start = pageIndex * pageSize;
			const end = start + pageSize;
			return allItems.slice(start, end);
		},
		[rawData, pageSize, codeKey]
	);

	/**
	 * Находит несколько элементов по ключам.
	 */
	const findSourceItemsByKeys = useCallback(
		(key: string, keys: string[]) => {
			if (!rawData) return [];

			const keysSet = new Set<string>(keys);
			return rawData.items.filter((item) => keysSet.has(item[key]));
		},
		[rawData]
	);

	/**
	 * Дебаунсинг для частых операций.
	 */
	const debounce = useCallback((key: string, fn: () => void, delay: number = 200) => {
		// Очищаем предыдущий таймер
		if (debounceTimers.current.has(key)) {
			clearTimeout(debounceTimers.current.get(key)!);
		}

		// Устанавливаем новый таймер
		const timer = setTimeout(fn, delay);
		debounceTimers.current.set(key, timer);
	}, []);

	/**
	 * Очищает все дебаунс таймеры.
	 */
	const clearDebounceTimers = useCallback(() => {
		for (const timer of debounceTimers.current.values()) {
			clearTimeout(timer);
		}
		debounceTimers.current.clear();
	}, []);

	// Очистка таймеров при размонтировании
	useMemo(() => {
		return () => {
			clearDebounceTimers();
		};
	}, [clearDebounceTimers]);

	return {
		// Состояние данных
		data: rawData,
		isLoading,
		isError,

		codeKey,
		textKey,

		// Функции для работы с коллекцией
		getItems,
		findSourceItemsByKeys,
		setFilteredItems,
		getPage,
		buildSearchIndex,
		debounce,

		// Вспомогательные данные
		itemsMap,
		separatedItems,
		orderedKeys,

		// Управление запросом

		/**
		 * @deprecated нужен только на этапе проектирования, скоро будет удален
		 */
		refetch,
		/**
		 * @deprecated нужен только на этапе проектирования, скоро будет удален
		 */
		invalidate: () => queryClient.invalidateQueries({ queryKey: createODataCollectionQueryKey(odata) }),

		// Метаданные для виртуализации
		totalCount: rawData?.separated[codeKey]?.length || 0,
		pageSize
	};
}
