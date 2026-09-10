/** Ошибка возникает до JSON parsing, когда transport body превысил заданный предел. */
export class ErrorReportBodyTooLargeError extends Error {
	public constructor() {
		super("Error report body превышает допустимый размер.");
		this.name = "ErrorReportBodyTooLargeError";
	}
}

/** Проверяет browser same-origin signals без доверия к произвольному Referer. */
export function isSameOriginErrorReportRequest(request: Request): boolean {
	const origin = request.headers.get("origin");
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite && fetchSite !== "same-origin") return false;
	if (origin && origin !== new URL(request.url).origin) return false;
	return fetchSite === "same-origin" || origin !== null;
}

/** Считывает тело потоком и прекращает работу до JSON parsing при превышении maxBytes. */
export async function readBoundedErrorReportRequestText(request: Request, maxBytes: number): Promise<string> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("maxBytes должен быть положительным целым числом.");
	const declaredLength = request.headers.get("content-length");
	if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
		throw new ErrorReportBodyTooLargeError();
	}
	if (!request.body) return "";

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let receivedBytes = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			receivedBytes += chunk.value.byteLength;
			if (receivedBytes > maxBytes) throw new ErrorReportBodyTooLargeError();
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}
