import { describe, expect, it } from "vitest";

import { evaluateWebSocketRequestOrigin } from "./webSocketOrigin";

describe("evaluateWebSocketRequestOrigin", () => {
	it("разрешает same-origin browser handshake", () => {
		const request = new Request("https://internal.example/ws", { headers: { origin: "https://internal.example" } });
		expect(evaluateWebSocketRequestOrigin(request)).toEqual({ allowed: true, origin: "https://internal.example" });
	});

	it("отклоняет отсутствующий, некорректный и cross-site Origin", () => {
		expect(evaluateWebSocketRequestOrigin(new Request("https://internal.example/ws"))).toEqual({
			allowed: false,
			origin: null,
			reason: "missing-origin"
		});
		expect(evaluateWebSocketRequestOrigin(new Request("https://internal.example/ws", { headers: { origin: "null" } }))).toEqual({
			allowed: false,
			origin: null,
			reason: "invalid-origin"
		});
		expect(
			evaluateWebSocketRequestOrigin(new Request("https://internal.example/ws", { headers: { origin: "https://attacker.example" } }))
		).toEqual({ allowed: false, origin: "https://attacker.example", reason: "origin-not-allowed" });
	});

	it("поддерживает явный allowlist и non-browser policy", () => {
		const proxyRequest = new Request("http://127.0.0.1/ws", { headers: { origin: "https://internal.example" } });
		expect(
			evaluateWebSocketRequestOrigin(proxyRequest, {
				allowRequestOrigin: false,
				allowedOrigins: ["https://internal.example/path"]
			})
		).toEqual({ allowed: true, origin: "https://internal.example" });
		expect(evaluateWebSocketRequestOrigin(new Request("https://internal.example/ws"), { allowMissingOrigin: true })).toEqual({
			allowed: true,
			origin: "https://internal.example"
		});
	});
});
