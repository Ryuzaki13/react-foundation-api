/** Сравнение не преобразует decimal revision в number и не теряет bigint precision. */
export function normalizeSnapshotRevision(revision: string): string {
	if (!/^\d+$/u.test(revision)) {
		throw new TypeError("Ревизия снимка должна быть неотрицательным целым decimal string.");
	}
	return revision.replace(/^0+(?=\d)/u, "");
}
