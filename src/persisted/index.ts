/**
 * Внутренний infrastructural-модуль для persisted ресурсов.
 *
 * Этот слой собирает повторяющуюся механику вокруг API сохранённых записей:
 * - JSON payload codec;
 * - фабрики query key;
 * - capability-based descriptor ресурса;
 * - адаптеры под OData и REST;
 * - общие query/mutation-хуки;
 * - стратегии синхронизации react-query кэша.
 *
 * Модуль не содержит доменной бизнес-логики и не знает ничего про конкретные
 * сущности вроде variant, view-config или preset.
 */

export * from "./cache";
export * from "./keys";
export * from "./odata";
export * from "./payload";
export * from "./resource";
export * from "./rest";
export * from "./types";
