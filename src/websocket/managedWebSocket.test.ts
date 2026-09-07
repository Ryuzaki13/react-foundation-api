import { describe, expect, it, vi } from "vitest";

import { createManagedWebSocket, getWebSocketReconnectDelay } from "./managedWebSocket";
import { type WebSocketCloseEventLike, type WebSocketLike } from "./types";

class TestSocket extends EventTarget implements WebSocketLike {
	readyState = 0;
	readonly sent: unknown[] = [];
	readonly close = vi.fn((code?: number, reason?: string) => {
		this.emitClose(code ?? 1_000, reason ?? "", true);
	});

	send(data: unknown) {
		this.sent.push(data);
	}

	emitOpen() {
		this.readyState = 1;
		this.dispatchEvent(new Event("open"));
	}

	emitClose(code: number, reason = "", wasClean = false) {
		this.readyState = 3;
		const event = Object.assign(new Event("close"), { code, reason, wasClean }) as WebSocketCloseEventLike;
		this.dispatchEvent(event);
	}
}

describe("getWebSocketReconnectDelay", () => {
	it("ограничивает exponential backoff и применяет jitter", () => {
		expect(getWebSocketReconnectDelay(1, { initialDelayMs: 1_000, jitterRatio: 0.2 }, 0)).toBe(800);
		expect(getWebSocketReconnectDelay(3, { initialDelayMs: 1_000, maxDelayMs: 3_000, jitterRatio: 0 }, 0.5)).toBe(3_000);
		expect(getWebSocketReconnectDelay(3, { initialDelayMs: 1_000, maxDelayMs: 3_000, jitterRatio: 0.2 }, 1)).toBe(3_000);
	});
});

describe("createManagedWebSocket", () => {
	it("открывает socket, отправляет данные и уведомляет подписчиков", () => {
		const socket = new TestSocket();
		const listener = vi.fn();
		const connection = createManagedWebSocket({ url: "wss://example.test/ws", socketFactory: () => socket });
		connection.subscribe(listener);

		connection.connect();
		expect(connection.getSnapshot()).toEqual({ status: "connecting", reconnectAttempt: 0 });
		socket.emitOpen();
		expect(connection.getSnapshot()).toEqual({ status: "open", reconnectAttempt: 0 });
		expect(connection.send("payload")).toBe(true);
		expect(socket.sent).toEqual(["payload"]);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("переподключается после abnormal close с bounded attempts", () => {
		vi.useFakeTimers();
		const sockets = [new TestSocket(), new TestSocket()];
		const socketFactory = vi.fn(() => sockets[socketFactory.mock.calls.length - 1] as TestSocket);
		const connection = createManagedWebSocket({
			url: "wss://example.test/ws",
			socketFactory,
			random: () => 0.5,
			reconnect: { initialDelayMs: 100, jitterRatio: 0, maxAttempts: 1 }
		});

		connection.connect();
		sockets[0]?.emitClose(1_006);
		expect(connection.getSnapshot()).toEqual({ status: "reconnecting", reconnectAttempt: 1 });
		vi.advanceTimersByTime(100);
		expect(socketFactory).toHaveBeenCalledTimes(2);
		sockets[1]?.emitClose(1_006);
		expect(connection.getSnapshot()).toEqual({ status: "unavailable", reconnectAttempt: 1 });
		vi.useRealTimers();
	});

	it("не переподключается после policy violation и корректно останавливается", () => {
		const socket = new TestSocket();
		const connection = createManagedWebSocket({ url: "wss://example.test/ws", socketFactory: () => socket });
		connection.connect();
		socket.emitClose(1_008);
		expect(connection.getSnapshot().status).toBe("unavailable");

		connection.reconnect();
		connection.stop();
		expect(connection.getSnapshot()).toEqual({ status: "stopped", reconnectAttempt: 0 });
		expect(socket.close).toHaveBeenCalledWith(1_000, "Client stopped");
	});
});
