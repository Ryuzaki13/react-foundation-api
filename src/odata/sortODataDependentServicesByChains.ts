import { compareStrings } from "@ryuzaki13/react-foundation-lib/string-comparison";

import { ODataDependentBaseProps } from "./types";

import type { ODataChainsMap } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Применяет пользовательский override порядка сегментов поверх уже рассчитанного базового порядка.
 *
 * Алгоритм:
 * 1. берёт только валидные id из `orderOverrideIds` (без дублей);
 * 2. поднимает эти id в начало в указанной последовательности;
 * 3. все остальные сегменты оставляет в исходном относительном порядке.
 */
function applySegmentsOrderOverride(
	services: readonly ODataDependentBaseProps[],
	orderOverrideIds?: readonly string[]
): ODataDependentBaseProps[] {
	if (!orderOverrideIds?.length) return [...services];

	const visibleIds = new Set<string>();
	for (const service of services) {
		for (const segmentId of Object.keys(service.segments)) {
			visibleIds.add(segmentId);
		}
	}

	const normalizedOverride = [...new Set(orderOverrideIds)].filter((id) => visibleIds.has(id));
	if (normalizedOverride.length === 0) return [...services];

	const overrideRank = new Map(normalizedOverride.map((id, index) => [id, index]));
	const fallbackRankStart = normalizedOverride.length;
	const segmentRank = new Map<string, number>();
	let fallbackRank = fallbackRankStart;

	for (const service of services) {
		for (const segmentId of Object.keys(service.segments)) {
			if (segmentRank.has(segmentId)) continue;
			segmentRank.set(segmentId, overrideRank.get(segmentId) ?? fallbackRank++);
		}
	}

	const withOrderedSegments = services.map((service) => {
		const orderedEntries = Object.entries(service.segments).sort(
			([leftId], [rightId]) =>
				(segmentRank.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (segmentRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
		);

		return {
			...service,
			segments: Object.fromEntries(orderedEntries)
		};
	});

	return [...withOrderedSegments].sort((leftService, rightService) => {
		const leftFirstSegmentId = Object.keys(leftService.segments)[0];
		const rightFirstSegmentId = Object.keys(rightService.segments)[0];
		const leftRank = leftFirstSegmentId ? (segmentRank.get(leftFirstSegmentId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
		const rightRank = rightFirstSegmentId ? (segmentRank.get(rightFirstSegmentId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

		return leftRank - rightRank;
	});
}

/**
 * Сортирует сегменты сервисов по chain-порядку (от меньшего к большему)
 * и опционально накладывает пользовательский override.
 *
 * Если chain недоступен, сохраняет исходный порядок сегментов.
 *
 * @deprecated функционал должен быть вырезан и оставлен только с `sortODataDependentSegmentItemsByChains`
 */
export function sortODataDependentServicesByChains(
	services: readonly ODataDependentBaseProps[],
	chains: ODataChainsMap,
	orderOverrideIds?: readonly string[]
): ODataDependentBaseProps[] {
	const sortedByChains = services.map((service) => {
		const serviceKey = `${service.odata.service}.${service.odata.target}`;
		const chain = chains[serviceKey];
		if (!chain?.length) return service;

		const chainOrder = new Map(chain.map((item, index) => [item.codeKey, index]));
		const orderedEntries = Object.entries(service.segments).sort(([leftId], [rightId]) => {
			const leftOrder = chainOrder.get(leftId);
			const rightOrder = chainOrder.get(rightId);

			if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
			if (leftOrder !== undefined) return -1;
			if (rightOrder !== undefined) return 1;
			return compareStrings(leftId, rightId);
		});

		return {
			...service,
			segments: Object.fromEntries(orderedEntries)
		};
	});

	return applySegmentsOrderOverride(sortedByChains, orderOverrideIds);
}
