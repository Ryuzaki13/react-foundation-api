import type { QueryClient, QueryKey, QueryMeta } from "@tanstack/react-query";

/**
 * Имена read-операций, которые generic-слой умеет подключать к `useQuery`.
 */
export type PersistedReadOperationName = "list" | "latest" | "history";

/**
 * Имена write-операций, которые generic-слой умеет подключать к `useMutation`.
 */
export type PersistedWriteOperationName = "save" | "create" | "delete";

/**
 * Полный набор стандартных операций persisted-record ресурса.
 */
export type PersistedOperationName = PersistedReadOperationName | PersistedWriteOperationName;

/**
 * Контракт кодека полезной нагрузки сохранённой записи.
 *
 * Как правило, backend хранит payload строкой JSON, но общий слой не навязывает
 * конкретный формат. Ресурс сам решает, как именно парсить и сериализовать данные.
 */
export interface PersistedPayloadCodec<T> {
	/**
	 * Разбирает сохранённый payload в доменную структуру.
	 */
	parse: (payload: string | null | undefined) => T | null;

	/**
	 * Сериализует доменную структуру в формат, ожидаемый transport/backend слоем.
	 */
	stringify: (value: T) => string;
}

/**
 * Набор фабрик query key для конкретного persisted-record ресурса.
 *
 * Стандартная форма ключа:
 * `namespace -> resource -> normalizedScope -> operation -> optionalArgs`
 */
export interface PersistedRecordKeys<TScope> {
	all: readonly unknown[];
	scope: (scope: TScope | null | undefined) => readonly unknown[];
	operation: (name: PersistedOperationName, scope: TScope | null | undefined, args?: unknown) => readonly unknown[];
	list: (scope: TScope | null | undefined) => readonly unknown[];
	latest: (scope: TScope | null | undefined) => readonly unknown[];
	history: (scope: TScope | null | undefined, args?: unknown) => readonly unknown[];
	save: (scope: TScope | null | undefined) => readonly unknown[];
	create: (scope: TScope | null | undefined) => readonly unknown[];
	delete: (scope: TScope | null | undefined) => readonly unknown[];
}

/**
 * Контекст выполнения read-операции.
 *
 * Общий слой гарантирует, что к моменту вызова `execute` scope уже прошёл
 * базовую проверку descriptor-а.
 */
export interface PersistedQueryOperationContext<TScope, TArgs> {
	scope: TScope;
	args: TArgs;
	client: QueryClient;
	signal?: AbortSignal;
}

/**
 * Контекст выполнения write-операции.
 */
export interface PersistedMutationOperationContext<TScope, TInput> {
	scope: TScope;
	input: TInput;
	client: QueryClient;
}

/**
 * Контракт read-операции (`list`, `latest`, `history`).
 */
export interface PersistedQueryOperation<TScope, TArgs, TResult> {
	/**
	 * Выполняет запрос и возвращает уже доменную модель результата.
	 */
	execute(context: PersistedQueryOperationContext<TScope, TArgs>): Promise<TResult>;

	/**
	 * Позволяет локально отключить query даже при формально валидном scope.
	 */
	isEnabled?(scope: TScope | null | undefined, args: TArgs): boolean;

	/**
	 * Политики react-query для конкретной операции.
	 */
	staleTime?: number;
	gcTime?: number;
	meta?: QueryMeta;
}

/**
 * Контекст, который cache strategy получает после успешной мутации.
 */
export interface PersistedCacheStrategyContext<
	TScope,
	TInput,
	TResult,
	TTransport extends PersistedTransportAdapter<TScope> = PersistedTransportAdapter<TScope>
> {
	client: QueryClient;
	descriptor: PersistedResourceDescriptor<TScope, TTransport>;
	scope: TScope;
	input: TInput;
	result: TResult;
}

/**
 * Политика обновления react-query кэша после write-операции.
 */
export interface PersistedCacheStrategy<TScope, TInput, TResult> {
	onSuccess?(context: PersistedCacheStrategyContext<TScope, TInput, TResult>): void | Promise<void>;
}

/**
 * Контракт write-операции (`save`, `create`, `delete`).
 */
export interface PersistedMutationOperation<TScope, TInput, TResult> {
	/**
	 * Выполняет мутацию и возвращает доменный результат.
	 */
	execute(context: PersistedMutationOperationContext<TScope, TInput>): Promise<TResult>;

	/**
	 * Базовая cache policy ресурса.
	 */
	cacheStrategy?: PersistedCacheStrategy<TScope, TInput, TResult>;
}

/**
 * Capability model ресурса.
 *
 * Ресурс не обязан поддерживать весь CRUD. Он подключает только те операции,
 * которые реально существуют у backend-а и нужны доменному коду.
 */
export interface PersistedOperationCapabilities<TScope> {
	list?: PersistedQueryOperation<TScope, void, unknown>;
	latest?: PersistedQueryOperation<TScope, void, unknown>;
	history?: PersistedQueryOperation<TScope, unknown, unknown>;
	save?: PersistedMutationOperation<TScope, unknown, unknown>;
	create?: PersistedMutationOperation<TScope, unknown, unknown>;
	delete?: PersistedMutationOperation<TScope, unknown, unknown>;
}

/**
 * Транспортный адаптер ресурса.
 *
 * Обычно собирается из OData или REST adapter factory.
 */
export type PersistedTransportAdapter<TScope> = PersistedOperationCapabilities<TScope>;

/**
 * Полное описание persisted-record ресурса.
 *
 * Descriptor — центральная точка конфигурации generic-слоя.
 */
export interface PersistedResourceDescriptor<
	TScope,
	TTransport extends PersistedTransportAdapter<TScope> = PersistedTransportAdapter<TScope>
> {
	namespace: string;
	resource: string;
	keys: PersistedRecordKeys<TScope>;
	transport: TTransport;
	isEnabled?: (scope: TScope | null | undefined) => boolean;
	getScopeError?: (scope: TScope | null | undefined) => string | null;
}

/**
 * Параметры создания descriptor-а.
 */
export interface CreatePersistedResourceDescriptorOptions<
	TScope,
	TTransport extends PersistedTransportAdapter<TScope> = PersistedTransportAdapter<TScope>
> {
	namespace: string;
	resource: string;
	transport: TTransport;
	normalizeScope?: (scope: TScope | null | undefined) => unknown;
	isEnabled?: (scope: TScope | null | undefined) => boolean;
	getScopeError?: (scope: TScope | null | undefined) => string | null;
}

/**
 * Настройки стратегии точечного обновления кэша через `setQueryData`.
 */
export interface PersistedSetQueryDataStrategyOptions<TScope, TInput, TResult, TData> {
	/**
	 * Возвращает ключ query, который нужно обновить.
	 */
	getQueryKey: (context: PersistedCacheStrategyContext<TScope, TInput, TResult>) => QueryKey;

	/**
	 * Вычисляет новое значение кэша на основе текущего значения и результата мутации.
	 */
	update: (current: TData | undefined, context: PersistedCacheStrategyContext<TScope, TInput, TResult>) => TData;
}
