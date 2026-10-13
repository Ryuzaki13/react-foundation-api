/** Ограничение удерживаемых областей задаёт приложение по своему бюджету памяти. */
export type VersionedSnapshotCacheOptions = Readonly<{
	maxEntries: number;
}>;

/**
 * Удерживает один опубликованный снимок каждой области. Снимок уже проверен
 * владельцем и после публикации неизменяем: cache не копирует и не нормализует
 * предметные записи. Допуск, revision source и DB transaction остаются у caller.
 * Монотонность действует для удерживаемой области: eviction и clear освобождают
 * вместе со снимком её revision, не оставляя безграничную историю scope keys.
 */
export type VersionedSnapshotCache<TSnapshot extends object> = Readonly<{
	/** Возвращает тот же объект только для точно совпавшей decimal revision. */
	getExact: (scopeKey: string, revision: string) => TSnapshot | undefined;
	/**
	 * Новая revision заменяет прежнюю. Равная возвращает ранее опубликованный
	 * объект; старая возвращает свой снимок caller, сохраняя новую версию в cache.
	 */
	publish: (scopeKey: string, revision: string, snapshot: TSnapshot) => TSnapshot;
	/** Освобождает все ссылки, которыми владеет cache. */
	clear: () => void;
}>;
