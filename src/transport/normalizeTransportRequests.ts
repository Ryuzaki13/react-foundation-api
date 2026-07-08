import { normalizeTextWithFallback } from "@ryuzaki13/react-foundation-lib/formatters";

import type { TransportRequest, TransportRequestRaw, TransportRequestType } from "./types";

export function normalizeTransportRequests(items: TransportRequestRaw[], type: TransportRequestType): TransportRequest[] {
	const seen = new Set<string>();

	return items.flatMap((item) => {
		const id = normalizeTextWithFallback(item.id);
		if (!id || seen.has(id)) return [];

		seen.add(id);

		return [
			{
				id,
				type,
				text: normalizeTextWithFallback(item.description),
				isDefaultRequest: item.isDefaultRequest === true
			}
		];
	});
}
