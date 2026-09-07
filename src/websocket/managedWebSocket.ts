import {
	type ManagedWebSocket,
	type ManagedWebSocketOptions,
	type ManagedWebSocketSnapshot,
	type WebSocketCloseEventLike,
	type WebSocketLike,
	type WebSocketReconnectPolicy
} from "./types";

const WEB_SOCKET_OPEN_STATE = 1;

const DEFAULT_RECONNECT_POLICY = {
	initialDelayMs: 1_000,
	maxDelayMs: 30_000,
	multiplier: 2,
	jitterRatio: 0.2,
	maxAttempts: Number.POSITIVE_INFINITY
} as const;

function resolveFiniteNonNegative(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveReconnectPolicy(policy: WebSocketReconnectPolicy | undefined) {
	return {
		initialDelayMs: resolveFiniteNonNegative(policy?.initialDelayMs, DEFAULT_RECONNECT_POLICY.initialDelayMs),
		maxDelayMs: resolveFiniteNonNegative(policy?.maxDelayMs, DEFAULT_RECONNECT_POLICY.maxDelayMs),
		multiplier:
			policy?.multiplier !== undefined && Number.isFinite(policy.multiplier) && policy.multiplier >= 1
				? policy.multiplier
				: DEFAULT_RECONNECT_POLICY.multiplier,
		jitterRatio:
			policy?.jitterRatio !== undefined && Number.isFinite(policy.jitterRatio)
				? Math.min(1, Math.max(0, policy.jitterRatio))
				: DEFAULT_RECONNECT_POLICY.jitterRatio,
		maxAttempts: resolveFiniteNonNegative(policy?.maxAttempts, DEFAULT_RECONNECT_POLICY.maxAttempts),
		shouldReconnect: policy?.shouldReconnect ?? ((event: WebSocketCloseEventLike) => event.code !== 1_000 && event.code !== 1_008)
	};
}

/** Рассчитывает bounded exponential backoff с симметричным jitter. */
export function getWebSocketReconnectDelay(attempt: number, policy: WebSocketReconnectPolicy = {}, randomValue = Math.random()): number {
	const resolved = resolveReconnectPolicy(policy);
	const normalizedAttempt = Math.max(1, Math.floor(attempt));
	const baseDelay = Math.min(resolved.maxDelayMs, resolved.initialDelayMs * resolved.multiplier ** (normalizedAttempt - 1));
	const jitter = baseDelay * resolved.jitterRatio * (Math.min(1, Math.max(0, randomValue)) * 2 - 1);
	return Math.min(resolved.maxDelayMs, Math.max(0, Math.round(baseDelay + jitter)));
}

function defaultSocketFactory(url: string, protocols?: string | readonly string[]): WebSocketLike {
	if (typeof WebSocket === "undefined") {
		throw new Error("WebSocket недоступен в текущем runtime; передайте socketFactory.");
	}
	return new WebSocket(url, protocols as string | string[] | undefined);
}

/**
 * Создаёт transport-level WebSocket lifecycle без привязки к React, Query и
 * прикладному формату сообщений. Подписки и resync остаются у host-приложения.
 */
export function createManagedWebSocket(options: ManagedWebSocketOptions): ManagedWebSocket {
	const policy = resolveReconnectPolicy(options.reconnect);
	const socketFactory = options.socketFactory ?? defaultSocketFactory;
	const random = options.random ?? Math.random;
	const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
	const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
	const listeners = new Set<() => void>();
	let snapshot: ManagedWebSocketSnapshot = { status: "idle", reconnectAttempt: 0 };
	let socket: WebSocketLike | null = null;
	let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	let generation = 0;
	let stopped = false;

	const publish = (nextSnapshot: ManagedWebSocketSnapshot) => {
		if (snapshot.status === nextSnapshot.status && snapshot.reconnectAttempt === nextSnapshot.reconnectAttempt) return;
		snapshot = nextSnapshot;
		for (const listener of listeners) listener();
	};

	const clearReconnectTimer = () => {
		if (reconnectTimer === null) return;
		cancelTimeout(reconnectTimer);
		reconnectTimer = null;
	};

	const openSocket = (isReconnect: boolean) => {
		if (stopped || socket) return;
		clearReconnectTimer();
		const currentGeneration = ++generation;
		publish({ status: isReconnect ? "reconnecting" : "connecting", reconnectAttempt: snapshot.reconnectAttempt });

		try {
			socket = socketFactory(typeof options.url === "function" ? options.url() : options.url, options.protocols);
		} catch {
			socket = null;
			scheduleReconnect();
			return;
		}

		const currentSocket = socket;
		currentSocket.addEventListener("open", (event) => {
			if (generation !== currentGeneration || socket !== currentSocket || stopped) return;
			publish({ status: "open", reconnectAttempt: 0 });
			options.onOpen?.(event);
		});
		currentSocket.addEventListener("message", (event) => {
			if (generation === currentGeneration && socket === currentSocket && !stopped)
				options.onMessage?.(event as Parameters<NonNullable<ManagedWebSocketOptions["onMessage"]>>[0]);
		});
		currentSocket.addEventListener("error", (event) => {
			if (generation === currentGeneration && socket === currentSocket && !stopped) options.onError?.(event);
		});
		currentSocket.addEventListener("close", (rawEvent) => {
			const event = rawEvent as WebSocketCloseEventLike;
			if (generation !== currentGeneration || socket !== currentSocket) return;
			socket = null;
			options.onClose?.(event);
			if (stopped) return;
			if (!policy.shouldReconnect(event)) {
				publish({ status: "unavailable", reconnectAttempt: snapshot.reconnectAttempt });
				return;
			}
			scheduleReconnect();
		});
	};

	function scheduleReconnect() {
		if (stopped || reconnectTimer !== null) return;
		const attempt = snapshot.reconnectAttempt + 1;
		if (attempt > policy.maxAttempts) {
			publish({ status: "unavailable", reconnectAttempt: snapshot.reconnectAttempt });
			return;
		}
		publish({ status: "reconnecting", reconnectAttempt: attempt });
		const delay = getWebSocketReconnectDelay(attempt, policy, random());
		reconnectTimer = scheduleTimeout(() => {
			reconnectTimer = null;
			openSocket(true);
		}, delay);
	}

	return {
		connect() {
			if (socket || reconnectTimer !== null || (!stopped && snapshot.status !== "idle" && snapshot.status !== "unavailable")) return;
			stopped = false;
			publish({ status: "idle", reconnectAttempt: 0 });
			openSocket(false);
		},
		reconnect() {
			stopped = false;
			clearReconnectTimer();
			generation += 1;
			const previousSocket = socket;
			socket = null;
			previousSocket?.close(1_000, "Reconnect requested");
			publish({ status: "idle", reconnectAttempt: 0 });
			openSocket(false);
		},
		stop(code = 1_000, reason = "Client stopped") {
			stopped = true;
			clearReconnectTimer();
			generation += 1;
			const previousSocket = socket;
			socket = null;
			previousSocket?.close(code, reason);
			publish({ status: "stopped", reconnectAttempt: 0 });
		},
		send(data) {
			if (!socket || socket.readyState !== WEB_SOCKET_OPEN_STATE) return false;
			socket.send(data);
			return true;
		},
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
