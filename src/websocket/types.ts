export type WebSocketCloseEventLike = Event & {
	readonly code: number;
	readonly reason: string;
	readonly wasClean: boolean;
};

export type WebSocketMessageEventLike = Event & {
	readonly data: unknown;
};

/** Минимальный WebSocket-контракт: браузерный API и совместимые runtime adapters. */
export type WebSocketLike = {
	readonly readyState: number;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
	close(code?: number, reason?: string): void;
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
};

export type ManagedWebSocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "unavailable" | "stopped";

export type ManagedWebSocketSnapshot = {
	readonly status: ManagedWebSocketStatus;
	readonly reconnectAttempt: number;
};

export type WebSocketReconnectPolicy = {
	/** Начальная задержка. По умолчанию 1000 мс. */
	readonly initialDelayMs?: number;
	/** Верхняя граница задержки. По умолчанию 30 секунд. */
	readonly maxDelayMs?: number;
	/** Множитель exponential backoff. По умолчанию 2. */
	readonly multiplier?: number;
	/** Случайное отклонение 0..1. По умолчанию 0.2. */
	readonly jitterRatio?: number;
	/** Число автоматических повторов; Infinity по умолчанию. */
	readonly maxAttempts?: number;
	/** Позволяет остановить reconnect для protocol-specific close code. */
	readonly shouldReconnect?: (event: WebSocketCloseEventLike) => boolean;
};

export type ManagedWebSocketOptions = {
	readonly url: string | (() => string);
	readonly protocols?: string | readonly string[];
	readonly reconnect?: WebSocketReconnectPolicy;
	readonly socketFactory?: (url: string, protocols?: string | readonly string[]) => WebSocketLike;
	readonly random?: () => number;
	readonly setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
	readonly clearTimeout?: (timer: ReturnType<typeof globalThis.setTimeout>) => void;
	readonly onOpen?: (event: Event) => void;
	readonly onMessage?: (event: WebSocketMessageEventLike) => void;
	readonly onError?: (event: Event) => void;
	readonly onClose?: (event: WebSocketCloseEventLike) => void;
};

export type ManagedWebSocket = {
	readonly connect: () => void;
	readonly reconnect: () => void;
	readonly stop: (code?: number, reason?: string) => void;
	readonly send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => boolean;
	readonly getSnapshot: () => ManagedWebSocketSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export type WebSocketOriginRejectionReason = "missing-origin" | "invalid-origin" | "origin-not-allowed";

export type WebSocketOriginDecision =
	| { readonly allowed: true; readonly origin: string }
	| {
			readonly allowed: false;
			readonly origin: string | null;
			readonly reason: WebSocketOriginRejectionReason;
	  };

export type WebSocketOriginPolicy = {
	/** Дополнительные доверенные origins помимо origin самого request URL. */
	readonly allowedOrigins?: readonly string[];
	/** Не включать request URL origin в allowlist. */
	readonly allowRequestOrigin?: boolean;
	/** Разрешить non-browser clients без Origin. По умолчанию false. */
	readonly allowMissingOrigin?: boolean;
};
