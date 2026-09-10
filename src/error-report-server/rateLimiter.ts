import { createHash, randomBytes } from "node:crypto";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_SOURCE_LIMIT = 20;
const DEFAULT_GLOBAL_LIMIT = 300;
const DEFAULT_MAX_SOURCE_BUCKETS = 10_000;

type RateLimitBucket = { count: number; resetAt: number };

export type ErrorReportRateLimitDecision = {
	readonly allowed: boolean;
	readonly retryAfterSeconds?: number;
};

export type CreateErrorReportRateLimiterOptions = {
	readonly now?: () => number;
	readonly windowMs?: number;
	readonly sourceLimit?: number;
	readonly globalLimit?: number;
	readonly maxSourceBuckets?: number;
	readonly secret?: string;
};

function assertPositiveInteger(name: string, value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} должен быть положительным целым числом.`);
}

/**
 * Создаёт process-local fixed-window limiter. В памяти хранится только digest
 * source identity, поэтому исходный сетевой адрес не становится telemetry.
 */
export function createErrorReportRateLimiter(options: CreateErrorReportRateLimiterOptions = {}) {
	const now = options.now ?? Date.now;
	const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
	const sourceLimit = options.sourceLimit ?? DEFAULT_SOURCE_LIMIT;
	const globalLimit = options.globalLimit ?? DEFAULT_GLOBAL_LIMIT;
	const maxSourceBuckets = options.maxSourceBuckets ?? DEFAULT_MAX_SOURCE_BUCKETS;
	const secret = options.secret ?? randomBytes(32).toString("hex");
	const sourceBuckets = new Map<string, RateLimitBucket>();
	let globalBucket: RateLimitBucket | undefined;

	assertPositiveInteger("Rate limit window", windowMs);
	assertPositiveInteger("Rate limit source limit", sourceLimit);
	assertPositiveInteger("Rate limit global limit", globalLimit);
	assertPositiveInteger("Rate limit source bucket limit", maxSourceBuckets);

	const consumeBucket = (bucket: RateLimitBucket | undefined, limit: number, currentTime: number) => {
		const current = !bucket || bucket.resetAt <= currentTime ? { count: 0, resetAt: currentTime + windowMs } : bucket;
		current.count += 1;
		return {
			bucket: current,
			allowed: current.count <= limit,
			retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - currentTime) / 1_000))
		};
	};

	return {
		consume(sourceIdentity: string | undefined): ErrorReportRateLimitDecision {
			const currentTime = now();
			const sourceKey = createHash("sha256")
				.update(secret, "utf8")
				.update("\x1f", "utf8")
				.update(sourceIdentity ?? "unknown", "utf8")
				.digest("hex");

			for (const [key, bucket] of sourceBuckets) {
				if (bucket.resetAt <= currentTime || sourceBuckets.size > maxSourceBuckets) sourceBuckets.delete(key);
			}

			const globalDecision = consumeBucket(globalBucket, globalLimit, currentTime);
			globalBucket = globalDecision.bucket;
			const sourceDecision = consumeBucket(sourceBuckets.get(sourceKey), sourceLimit, currentTime);
			sourceBuckets.set(sourceKey, sourceDecision.bucket);

			if (globalDecision.allowed && sourceDecision.allowed) return { allowed: true };
			return {
				allowed: false,
				retryAfterSeconds: Math.max(globalDecision.retryAfterSeconds, sourceDecision.retryAfterSeconds)
			};
		}
	};
}
