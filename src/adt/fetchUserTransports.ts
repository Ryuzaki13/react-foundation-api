import { HTTP_CONTENT_TYPE_HTML, HTTP_METHOD_GET, HTTP_HEADER_CONTENT_TYPE } from "../http/httpProtocolConstants";
import { fetchBase } from "../odata/transport";
import { ODATA_BASE_URL_DIRECT } from "../odata/transport/odataBaseUrlConstants";

import { parseUserTransportsXml } from "./parseUserTransportsXml";

const USER_TRANSPORTS_URL = "/sap/bc/adt/cts/transports?_action=FIND&trfunction=K";

function isHtmlResponse(text: string, contentType: string) {
	return contentType.includes(HTTP_CONTENT_TYPE_HTML) || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

export async function fetchUserTransports() {
	const response = await fetchBase(
		USER_TRANSPORTS_URL,
		{
			method: HTTP_METHOD_GET,
			headers: {
				Accept: "application/xml, text/xml, */*"
			}
		},
		ODATA_BASE_URL_DIRECT
	);

	const responseText = await response.text();
	const contentType = (response.headers.get(HTTP_HEADER_CONTENT_TYPE) || "").toLowerCase();

	if (isHtmlResponse(responseText, contentType)) {
		throw new Error("ADT вернул HTML вместо XML при запросе списка транспортов");
	}

	return parseUserTransportsXml(responseText);
}
