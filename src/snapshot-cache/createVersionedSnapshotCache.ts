import { normalizeSnapshotRevision } from "./normalizeSnapshotRevision";
import { type VersionedSnapshotCache, type VersionedSnapshotCacheOptions } from "./snapshotCacheTypes";

/**
 * Переиспользует опубликованные backend snapshots в пределах одного runtime.
 * Exact lookup сохраняет согласованность caller со своей DB revision: cache
 * никогда не подставляет более новую версию. Загрузка намеренно отсутствует,
 * чтобы не объединять чужие request-owned transactions или cancellation.
 */
export function createVersionedSnapshotCache<TSnapshot extends object>({
	maxEntries
}: VersionedSnapshotCacheOptions): VersionedSnapshotCache<TSnapshot> {
	if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
		throw new RangeError("maxEntries должен быть положительным безопасным целым числом.");
	}

	const entries = new Map<string, Readonly<{ revision: string; snapshot: TSnapshot }>>();

	return {
		getExact: (scopeKey, revision) => {
			const normalizedRevision = normalizeSnapshotRevision(revision);
			const current = entries.get(scopeKey);
			if (current?.revision !== normalizedRevision) return undefined;
			// Порядок Map хранит LRU без нового массива ключей и полного обхода.
			entries.delete(scopeKey);
			entries.set(scopeKey, current);
			return current.snapshot;
		},
		publish: (scopeKey, revision, snapshot) => {
			const normalizedRevision = normalizeSnapshotRevision(revision);
			const current = entries.get(scopeKey);
			if (current) {
				if (current.revision === normalizedRevision) {
					entries.delete(scopeKey);
					entries.set(scopeKey, current);
					return current.snapshot;
				}
				if (
					current.revision.length > normalizedRevision.length ||
					(current.revision.length === normalizedRevision.length && current.revision > normalizedRevision)
				) {
					// Старый DB snapshot остаётся допустимым ответом своего запроса,
					// но не может откатить опубликованную свежую версию для остальных.
					return snapshot;
				}
			}

			entries.delete(scopeKey);
			entries.set(scopeKey, { revision: normalizedRevision, snapshot });
			if (entries.size > maxEntries) {
				const leastRecentKey = entries.keys().next().value;
				if (leastRecentKey !== undefined) entries.delete(leastRecentKey);
			}
			return snapshot;
		},
		clear: () => entries.clear()
	};
}
