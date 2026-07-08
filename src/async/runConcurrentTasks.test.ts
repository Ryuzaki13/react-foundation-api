import { describe, expect, it, vi } from "vitest";

import { runConcurrentTasks } from "./runConcurrentTasks";

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;

	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return {
		promise,
		resolve,
		reject
	};
}

describe("runConcurrentTasks", () => {
	it("сохраняет порядок результатов исходного массива даже при завершении в другом порядке", async () => {
		const controller = new AbortController();
		const inputs = [10, 20, 30];
		const deferredByInput = new Map(inputs.map((input) => [input, createDeferred<string>()]));
		const thirdTaskStarted = createDeferred<void>();
		const startLog: Array<{ input: number; index: number; signal?: AbortSignal }> = [];
		let running = 0;
		let maxRunning = 0;

		const resultPromise = runConcurrentTasks(
			inputs,
			(input, context) => {
				startLog.push({ input, index: context.index, signal: context.signal });
				if (input === 30) {
					thirdTaskStarted.resolve();
				}
				running += 1;
				maxRunning = Math.max(maxRunning, running);

				return deferredByInput.get(input)!.promise.finally(() => {
					running -= 1;
				});
			},
			{
				concurrency: 2,
				signal: controller.signal
			}
		);

		expect(startLog).toEqual([
			{ input: 10, index: 0, signal: controller.signal },
			{ input: 20, index: 1, signal: controller.signal }
		]);
		expect(maxRunning).toBe(2);

		deferredByInput.get(20)!.resolve("done-20");
		await thirdTaskStarted.promise;

		expect(startLog).toEqual([
			{ input: 10, index: 0, signal: controller.signal },
			{ input: 20, index: 1, signal: controller.signal },
			{ input: 30, index: 2, signal: controller.signal }
		]);
		expect(maxRunning).toBe(2);

		deferredByInput.get(30)!.resolve("done-30");
		deferredByInput.get(10)!.resolve("done-10");

		const result = await resultPromise;

		expect(result.aborted).toBe(false);
		expect(result.settled).toEqual([
			{ status: "fulfilled", index: 0, input: 10, data: "done-10" },
			{ status: "fulfilled", index: 1, input: 20, data: "done-20" },
			{ status: "fulfilled", index: 2, input: 30, data: "done-30" }
		]);
		expect(result.successes).toEqual([
			{ status: "fulfilled", index: 0, input: 10, data: "done-10" },
			{ status: "fulfilled", index: 1, input: 20, data: "done-20" },
			{ status: "fulfilled", index: 2, input: 30, data: "done-30" }
		]);
		expect(result.errors).toEqual([]);
		expect(result.unprocessed).toEqual([]);
		expect(result.summary).toEqual({
			total: 3,
			completed: 3,
			succeeded: 3,
			failed: 0,
			unprocessed: 0
		});
	});

	it("собирает partial result и корректно вызывает callbacks прогресса и элементов", async () => {
		const onProgress = vi.fn();
		const onItemSuccess = vi.fn();
		const onItemError = vi.fn();
		const failure = new Error("boom");

		const result = await runConcurrentTasks(
			["a", "b", "c"],
			async (input) => {
				if (input === "b") {
					throw failure;
				}

				return `${input}-ok`;
			},
			{
				concurrency: 1,
				onProgress,
				onItemSuccess,
				onItemError
			}
		);

		expect(result.settled).toEqual([
			{ status: "fulfilled", index: 0, input: "a", data: "a-ok" },
			{ status: "rejected", index: 1, input: "b", error: failure },
			{ status: "fulfilled", index: 2, input: "c", data: "c-ok" }
		]);
		expect(result.successes).toEqual([
			{ status: "fulfilled", index: 0, input: "a", data: "a-ok" },
			{ status: "fulfilled", index: 2, input: "c", data: "c-ok" }
		]);
		expect(result.errors).toEqual([{ status: "rejected", index: 1, input: "b", error: failure }]);
		expect(result.summary).toEqual({
			total: 3,
			completed: 3,
			succeeded: 2,
			failed: 1,
			unprocessed: 0
		});

		expect(onItemSuccess).toHaveBeenCalledTimes(2);
		expect(onItemSuccess).toHaveBeenNthCalledWith(1, {
			status: "fulfilled",
			index: 0,
			input: "a",
			data: "a-ok"
		});
		expect(onItemSuccess).toHaveBeenNthCalledWith(2, {
			status: "fulfilled",
			index: 2,
			input: "c",
			data: "c-ok"
		});
		expect(onItemError).toHaveBeenCalledTimes(1);
		expect(onItemError).toHaveBeenCalledWith({
			status: "rejected",
			index: 1,
			input: "b",
			error: failure
		});

		expect(onProgress).toHaveBeenCalledTimes(3);
		expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
			{
				total: 3,
				completed: 1,
				succeeded: 1,
				failed: 0,
				running: 0,
				pending: 2,
				percentage: 33,
				aborted: false,
				lastSettled: { status: "fulfilled", index: 0, input: "a", data: "a-ok" }
			},
			{
				total: 3,
				completed: 2,
				succeeded: 1,
				failed: 1,
				running: 0,
				pending: 1,
				percentage: 67,
				aborted: false,
				lastSettled: { status: "rejected", index: 1, input: "b", error: failure }
			},
			{
				total: 3,
				completed: 3,
				succeeded: 2,
				failed: 1,
				running: 0,
				pending: 0,
				percentage: 100,
				aborted: false,
				lastSettled: { status: "fulfilled", index: 2, input: "c", data: "c-ok" }
			}
		]);
	});

	it("не запускает задачи, если signal уже aborted до старта", async () => {
		const controller = new AbortController();
		const task = vi.fn();

		controller.abort();

		const result = await runConcurrentTasks([1, 2, 3], task, {
			signal: controller.signal
		});

		expect(task).not.toHaveBeenCalled();
		expect(result).toEqual({
			settled: [],
			successes: [],
			errors: [],
			unprocessed: [
				{ index: 0, input: 1 },
				{ index: 1, input: 2 },
				{ index: 2, input: 3 }
			],
			aborted: true,
			summary: {
				total: 3,
				completed: 0,
				succeeded: 0,
				failed: 0,
				unprocessed: 3
			}
		});
	});

	it("при abort во время выполнения дожидается уже стартовавших задач и оставляет остальные unprocessed", async () => {
		const controller = new AbortController();
		const inputs = [1, 2, 3, 4];
		const deferredByInput = new Map(inputs.map((input) => [input, createDeferred<number>()]));
		const started: number[] = [];

		const resultPromise = runConcurrentTasks(
			inputs,
			(input) => {
				started.push(input);
				return deferredByInput.get(input)!.promise;
			},
			{
				concurrency: 2,
				signal: controller.signal
			}
		);

		expect(started).toEqual([1, 2]);

		controller.abort();
		deferredByInput.get(1)!.resolve(100);
		deferredByInput.get(2)!.resolve(200);

		const result = await resultPromise;

		expect(started).toEqual([1, 2]);
		expect(result.aborted).toBe(true);
		expect(result.settled).toEqual([
			{ status: "fulfilled", index: 0, input: 1, data: 100 },
			{ status: "fulfilled", index: 1, input: 2, data: 200 }
		]);
		expect(result.unprocessed).toEqual([
			{ index: 2, input: 3 },
			{ index: 3, input: 4 }
		]);
		expect(result.summary).toEqual({
			total: 4,
			completed: 2,
			succeeded: 2,
			failed: 0,
			unprocessed: 2
		});
	});

	it("возвращает пустой результат для пустого списка входов", async () => {
		const task = vi.fn();

		const result = await runConcurrentTasks([], task);

		expect(task).not.toHaveBeenCalled();
		expect(result).toEqual({
			settled: [],
			successes: [],
			errors: [],
			unprocessed: [],
			aborted: false,
			summary: {
				total: 0,
				completed: 0,
				succeeded: 0,
				failed: 0,
				unprocessed: 0
			}
		});
	});

	it("выбрасывает TypeError для нецелого concurrency", async () => {
		await expect(
			runConcurrentTasks([1], async (input) => input, {
				concurrency: 1.5
			})
		).rejects.toThrow(new TypeError("concurrency должен быть целым числом"));
	});

	it("выбрасывает RangeError для concurrency меньше единицы", async () => {
		await expect(
			runConcurrentTasks([1], async (input) => input, {
				concurrency: 0
			})
		).rejects.toThrow(new RangeError("concurrency должен быть >= 1"));
	});
});
