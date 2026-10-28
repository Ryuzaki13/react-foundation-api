import { HTTP_HEADER_ORIGIN } from "../http/httpProtocolConstants";

import { type WebSocketOriginDecision, type WebSocketOriginPolicy } from "./types";
import { WEB_SOCKET_ORIGIN_INVALID, WEB_SOCKET_ORIGIN_MISSING, WEB_SOCKET_ORIGIN_NOT_ALLOWED } from "./webSocketOriginConstants";

function normalizeOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		return url.origin === "null" ? null : url.origin;
	} catch {
		return null;
	}
}

/**
 * Проверяет браузерный Origin WebSocket handshake. Cookie-аутентификация без
 * такой проверки допускает cross-site WebSocket hijacking.
 */
export function evaluateWebSocketRequestOrigin(request: Request, policy: WebSocketOriginPolicy = {}): WebSocketOriginDecision {
	const originHeader = request.headers.get(HTTP_HEADER_ORIGIN);
	if (!originHeader) {
		return policy.allowMissingOrigin
			? { allowed: true, origin: new URL(request.url).origin }
			: { allowed: false, origin: null, reason: WEB_SOCKET_ORIGIN_MISSING };
	}
	const origin = normalizeOrigin(originHeader);
	if (!origin) return { allowed: false, origin: null, reason: WEB_SOCKET_ORIGIN_INVALID };

	const allowedOrigins = new Set<string>();
	if (policy.allowRequestOrigin !== false) allowedOrigins.add(new URL(request.url).origin);
	for (const allowedOrigin of policy.allowedOrigins ?? []) {
		const normalized = normalizeOrigin(allowedOrigin);
		if (normalized) allowedOrigins.add(normalized);
	}

	return allowedOrigins.has(origin) ? { allowed: true, origin } : { allowed: false, origin, reason: WEB_SOCKET_ORIGIN_NOT_ALLOWED };
}
