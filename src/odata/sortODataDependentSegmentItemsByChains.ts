import { ODataDependentSegmentItem } from "./types";

import type { ODataChainsMap } from "@ryuzaki13/react-foundation-lib/odata-service";

/**
 * Сортирует плоские segment-level элементы по chain-порядку
 * и опционально накладывает пользовательский override.
 */
export function sortODataDependentSegmentItemsByChains(
	items: readonly ODataDependentSegmentItem[],
	chains: ODataChainsMap,
	orderOverrideIds?: readonly string[]
): ODataDependentSegmentItem[] {
	const chainOrderByService = new Map<string, Map<string, number>>();

	for (const [serviceKey, chain] of Object.entries(chains)) {
		chainOrderByService.set(serviceKey, new Map(chain.map((item, index) => [item.codeKey, index])));
	}

	const baseOrdered = [...items]
		.map((item, index) => ({
			item,
			index
		}))
		.sort((left, right) => {
			if (left.item.serviceIndex !== right.item.serviceIndex) {
				return left.item.serviceIndex - right.item.serviceIndex;
			}

			const chainOrder = chainOrderByService.get(left.item.serviceKey);
			const leftChainOrder = chainOrder?.get(left.item.id);
			const rightChainOrder = chainOrder?.get(right.item.id);

			if (leftChainOrder !== undefined && rightChainOrder !== undefined) {
				return leftChainOrder - rightChainOrder;
			}
			if (leftChainOrder !== undefined) return -1;
			if (rightChainOrder !== undefined) return 1;

			if (left.item.segmentIndex !== right.item.segmentIndex) {
				return left.item.segmentIndex - right.item.segmentIndex;
			}

			return left.index - right.index;
		});

	if (!orderOverrideIds?.length) {
		return baseOrdered.map(({ item }) => item);
	}

	const availableIds = new Set(baseOrdered.map(({ item }) => item.id));
	const normalizedOverride = [...new Set(orderOverrideIds)].filter((id) => availableIds.has(id));
	if (normalizedOverride.length === 0) {
		return baseOrdered.map(({ item }) => item);
	}

	const overrideRank = new Map(normalizedOverride.map((id, index) => [id, index]));

	return [...baseOrdered]
		.sort((left, right) => {
			const leftOverrideRank = overrideRank.get(left.item.id);
			const rightOverrideRank = overrideRank.get(right.item.id);

			if (leftOverrideRank !== undefined && rightOverrideRank !== undefined) {
				return leftOverrideRank - rightOverrideRank;
			}
			if (leftOverrideRank !== undefined) return -1;
			if (rightOverrideRank !== undefined) return 1;

			return left.index - right.index;
		})
		.map(({ item }) => item);
}
