import type { ODataDependentBaseProps, ODataDependentSegmentItem } from "./types";

/**
 * Разворачивает зависимые OData-сервисы в плоский список segment-level элементов.
 */
export function flattenODataDependentServices(services: readonly ODataDependentBaseProps[]): ODataDependentSegmentItem[] {
	const out: ODataDependentSegmentItem[] = [];

	for (const [serviceIndex, service] of services.entries()) {
		const serviceKey = `${service.odata.service}.${service.odata.target}`;

		for (const [segmentIndex, [id, segment]] of Object.entries(service.segments).entries()) {
			out.push({
				id,
				serviceKey,
				serviceIndex,
				segmentIndex,
				odata: service.odata,
				segment,
				model: {
					...service.model,
					codeKey: id
				},
				panelVisibility: segment.panelVisibility ?? "user"
			});
		}
	}

	return out;
}
