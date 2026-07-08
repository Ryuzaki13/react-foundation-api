import { odataParseValueByMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";
import { isRecord } from "@ryuzaki13/react-foundation-lib/validators";

import { isFunctionImportMetadata } from "./odataFetchFnHelpers";

import type { EntityColumnProperty, ODataTargetMetadata, ServiceMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";

type ParsingColumnDescriptor = Pick<EntityColumnProperty, "id" | "type" | "abapBooleanLike">;

function resolveParsingColumns(target: ODataTargetMetadata, serviceMetadata: ServiceMetadata): EntityColumnProperty[] | undefined {
	if (!isFunctionImportMetadata(target)) {
		return target.columns;
	}

	if (!target.resultEntity) return undefined;
	return serviceMetadata.entities[target.resultEntity]?.columns;
}

function createParsingPlan(columns: EntityColumnProperty[]): ParsingColumnDescriptor[] {
	const parsingPlan: ParsingColumnDescriptor[] = [];

	for (let index = 0; index < columns.length; index += 1) {
		const column = columns[index];
		parsingPlan.push({
			id: column.id,
			type: column.type,
			abapBooleanLike: column.abapBooleanLike
		});
	}

	return parsingPlan;
}

function parsePlainRecord(record: Record<string, unknown>, parsingPlan: ParsingColumnDescriptor[]) {
	let parsedRecord: Record<string, unknown> | undefined;

	for (let index = 0; index < parsingPlan.length; index += 1) {
		const descriptor = parsingPlan[index];
		if (!Object.prototype.hasOwnProperty.call(record, descriptor.id)) {
			continue;
		}

		const sourceValue = record[descriptor.id];
		const parsedValue = odataParseValueByMetadata(descriptor, sourceValue);
		if (parsedValue === sourceValue) {
			continue;
		}

		if (!parsedRecord) {
			parsedRecord = { ...record };
		}

		parsedRecord[descriptor.id] = parsedValue;
	}

	return parsedRecord ?? record;
}

export function parseODataResponseByMetadata<I>(data: I[], target: ODataTargetMetadata, serviceMetadata: ServiceMetadata): I[];
export function parseODataResponseByMetadata<I>(data: I, target: ODataTargetMetadata, serviceMetadata: ServiceMetadata): I;
export function parseODataResponseByMetadata<I>(data: I | I[], target: ODataTargetMetadata, serviceMetadata: ServiceMetadata): I | I[] {
	const columns = resolveParsingColumns(target, serviceMetadata);
	if (!columns?.length) return data;

	const parsingPlan = createParsingPlan(columns);

	if (Array.isArray(data)) {
		let parsedItems: unknown[] | undefined;

		for (let index = 0; index < data.length; index += 1) {
			const item = data[index];
			if (!isRecord(item)) {
				continue;
			}

			const parsedItem = parsePlainRecord(item, parsingPlan);
			if (parsedItem === item) {
				continue;
			}

			if (!parsedItems) {
				parsedItems = data.slice();
			}

			parsedItems[index] = parsedItem;
		}

		return (parsedItems ?? data) as I[];
	}

	if (isRecord(data)) {
		return parsePlainRecord(data, parsingPlan) as I;
	}

	return data;
}
