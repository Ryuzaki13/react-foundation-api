import type { CollectionItem } from "@ryuzaki13/react-foundation-lib/odata";
import type { FilterExpression, ODataServiceConfig } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Политика видимости фильтра в общей панели фильтров.
 *
 * Тип принадлежит OData/UI API-слою, потому что используется не только
 * contract-конфигами, но и runtime-моделями зависимых OData-сегментов.
 */
export type ControlPanelVisibility = "user" | "always" | "none";

export interface ODataServiceCollectionConfig extends ODataServiceConfig {
	/**
	 * Выбор только указанных ключей.
	 */
	limitedKeys?: readonly string[];

	serverFilter?: FilterExpression<unknown>;
}

export interface ODataCollectionConfig extends ODataServiceCollectionConfig {
	/**
	 * Нужно ли отфильтровать пустые коды.
	 * По умолчанию `true`
	 */
	excludeEmpty?: true;
	/**
	 * Сортировка коллекции по code (`true`) или по text (`false`).
	 * По умолчанию `true`
	 */
	sortByCode?: boolean;

	hideCode?: true;

	clientFilter?: (item: CollectionItem) => boolean;

	/**
	 * Политика кеширования в Service Worker.
	 * По умолчанию `"ttl=forever;name=ref"` для справочников.
	 *
	 * - `"off"` — network-only
	 * - `"ttl=24h"` — cache-first с TTL
	 * - `"ttl=10m;max=200;name=ui"` — TTL с лимитом записей и именованным кешем
	 * - `"ttl=forever;name=ref"` — бессрочное хранение с обновлением через version-check
	 * - `"bust=24h;name=ref"` — принудительное обновление кеша
	 */
	swCache?: string;
}

export interface ODataCollectionSegment {
	placeholder: string;
	hideCode?: true;
	/**
	 * В качестве выбранных ключей устанавливать текст, вместо кода.
	 */
	selectText?: true;
}

export interface ODataCollectionModel {
	/**
	 * Ключ кодового поля (например, "TEXT_DIVISION")
	 */
	codeKey: string;

	/**
	 * Минимальная длина поискового запроса
	 */
	minSearchTextLength?: number;

	/**
	 * Минимальная длина поискового запроса по коду
	 */
	minSearchCodeLength?: number;

	/**
	 * Время задержки для дебаунсинга поиска (мс)
	 */
	searchDebounceDelay?: number;

	/**
	 * Максимальное количество отображаемых элементов.
	 */
	maxVisibleItems?: number;
}

export interface ODataCollectionProps<T extends string = string> {
	/**
	 * Выбранные ключи
	 *
	 * Аналог dependencies[codeKey], вероятно, есть смысл отказаться от этого свойства
	 *
	 * NOTE: Переименован на общее свойство всех UI компонентов `value`
	 */
	value?: T[];

	/**
	 * Зависимости от других фильтров
	 */
	dependencies?: Record<T, string[]>;
}

export interface ODataSelectBaseProps<T extends string = string> extends ODataCollectionProps<T> {
	/**
	 * Общие параметры связанные с odata.
	 *
	 * @todo Необходимо гарантировать стабильность ссылки!
	 */
	odata: ODataCollectionConfig;

	/**
	 * Параметры сегмента коллекции odata.
	 *
	 * @todo Необходимо гарантировать стабильность ссылки!
	 */
	segment: ODataCollectionSegment;

	/**
	 * Параметры модели odata сегмента.
	 *
	 * @todo Необходимо гарантировать стабильность ссылки!
	 */
	model: ODataCollectionModel;
}

export interface ODataSingleSelectProps<T extends string = string> extends Omit<ODataSelectBaseProps<T>, "value"> {
	/**
	 * Выбранный ключ
	 */
	value?: T;

	/**
	 * Зависимости от других фильтров
	 */
	dependencies?: Record<T, string[]>;
}

export interface ODataDependentSegment extends ODataCollectionSegment {
	/**
	 * Политика отображения фильтра в панели:
	 * - "none" — всегда скрыт в панели;
	 * - "user" — зависит от пользовательского варианта;
	 * - "always" — всегда показан в панели.
	 *
	 * По умолчанию используется "user".
	 */
	panelVisibility?: ControlPanelVisibility;
}

export type ODataDependentSegments = Record<string, ODataDependentSegment>;

export interface ODataDependentBaseProps extends Omit<ODataSelectBaseProps, "segment" | "model"> {
	/**
	 * Сегменты модели odata.
	 *
	 * @todo Необходимо гарантировать стабильность ссылки!
	 */
	segments: ODataDependentSegments;

	/**
	 * Параметры модели odata сегмента.
	 *
	 * @todo Необходимо гарантировать стабильность ссылки!
	 */
	model?: Omit<ODataCollectionModel, "codeKey">;
}

export interface ODataDependentSegmentItem {
	/**
	 * Идентификатор сегмента, совпадает с `codeKey`.
	 */
	id: string;

	/**
	 * Ключ родительского OData-сервиса (`service.target`).
	 */
	serviceKey: string;

	/**
	 * Позиция родительского сервиса в исходном массиве.
	 */
	serviceIndex: number;

	/**
	 * Позиция сегмента в исходном сервисе.
	 */
	segmentIndex: number;

	/**
	 * Общие параметры связанные с odata.
	 */
	odata: ODataCollectionConfig;

	/**
	 * Параметры конкретного сегмента.
	 */
	segment: ODataDependentSegment;

	/**
	 * Нормализованная модель сегмента с подставленным `codeKey`.
	 */
	model: ODataCollectionModel;

	/**
	 * Политика отображения фильтра в панели.
	 */
	panelVisibility: ControlPanelVisibility;
}
