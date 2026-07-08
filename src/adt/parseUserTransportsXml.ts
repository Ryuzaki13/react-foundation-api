import { arrayUniqueBy } from "@ryuzaki13/react-foundation-lib/array";
import { normalizeText } from "@ryuzaki13/react-foundation-lib/formatters";
import { isRecord } from "@ryuzaki13/react-foundation-lib/validators";
import { XMLParser } from "fast-xml-parser";

import type { UserTransport } from "./types";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseTagValue: false,
	trimValues: true
});

function collectByKey(value: unknown, key: string, result: unknown[] = []): unknown[] {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectByKey(item, key, result);
		}

		return result;
	}

	if (!isRecord(value)) return result;

	for (const [entryKey, entryValue] of Object.entries(value)) {
		if (entryKey === key) {
			result.push(entryValue);
		}

		collectByKey(entryValue, key, result);
	}

	return result;
}

function toTransportRecord(value: unknown): UserTransport | null {
	if (!isRecord(value)) return null;

	const transportNo = normalizeText(value.TRKORR);
	if (!transportNo) return null;

	return {
		transportNo,
		description: normalizeText(value.AS4TEXT),
		owner: normalizeText(value.AS4USER),
		targetSystem: normalizeText(value.TARSYSTEM),
		functionCode: normalizeText(value.TRFUNCTION),
		statusCode: normalizeText(value.TRSTATUS),
		parentTransportNo: normalizeText(value.STRKORR)
	};
}

export function parseUserTransportsXml(xml: string): UserTransport[] {
	const normalizedXml = xml.trim();
	if (!normalizedXml) return [];

	const parsed = parser.parse(normalizedXml) as unknown;
	const transportHeaders = collectByKey(parsed, "CTS_REQ_HEADER").flatMap((entry) => {
		if (Array.isArray(entry)) {
			return entry.map(toTransportRecord).filter((item): item is UserTransport => item !== null);
		}

		const transport = toTransportRecord(entry);
		return transport ? [transport] : [];
	});

	if (transportHeaders.length > 0) {
		return arrayUniqueBy(transportHeaders, "transportNo");
	}

	const transportNos = collectByKey(parsed, "TRKORR")
		.map((value) => normalizeText(value))
		.filter((value): value is string => value !== undefined)
		.map((transportNo): UserTransport => ({
			transportNo,
			description: undefined,
			owner: undefined,
			targetSystem: undefined,
			functionCode: undefined,
			statusCode: undefined,
			parentTransportNo: undefined
		}));

	return arrayUniqueBy(transportNos, "transportNo");
}
