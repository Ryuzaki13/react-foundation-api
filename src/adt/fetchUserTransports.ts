import { fetchBase } from "../odata/transport";

import { parseUserTransportsXml } from "./parseUserTransportsXml";

const USER_TRANSPORTS_URL = "/sap/bc/adt/cts/transports?_action=FIND&trfunction=K";

function isHtmlResponse(text: string, contentType: string) {
	return contentType.includes("text/html") || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

export async function fetchUserTransports() {
	const response = await fetchBase(
		USER_TRANSPORTS_URL,
		{
			method: "GET",
			headers: {
				Accept: "application/xml, text/xml, */*"
			}
		},
		""
	);

	const responseText = await response.text();
	const contentType = (response.headers.get("Content-Type") || "").toLowerCase();

	if (isHtmlResponse(responseText, contentType)) {
		throw new Error("ADT вернул HTML вместо XML при запросе списка транспортов");
	}

	return parseUserTransportsXml(responseText);
}
