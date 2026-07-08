import { describe, expect, it, vi } from "vitest";

import { AsyncTasksError } from "./AsyncTasksError";
import { runAsyncTasks } from "./runAsyncTasks";

type Deferred<T> = {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve: ((value: T) => void) | undefined;
	let reject: ((error: unknown) => void) | undefined;

	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	if (!resolve || !reject) {
		throw new Error("Не удалось создать отложенный promise для теста.");
	}

	return {
		promise,
		resolve,
		reject
	};
}

describe("runAsyncTasks", () => {
	it("запускает все задачи параллельно и сохраняет порядок результата", async () => {
		const first = createDeferred<string>();
		const second = createDeferred<string>();
		const started: string[] = [];

		const resultPromise = runAsyncTasks([
			{
				name: "first",
				run: () => {
					started.push("first");
					return first.promise;
				}
			},
			{
				name: "second",
				run: () => {
					started.push("second");
					return second.promise;
				}
			}
		]);

		expect(started).toEqual(["first", "second"]);

		second.resolve("second-result");
		first.resolve("first-result");

		await expect(resultPromise).resolves.toEqual({
			settled: [
				{ status: "fulfilled", index: 0, name: "first", data: "first-result" },
				{ status: "fulfilled", index: 1, name: "second", data: "second-result" }
			],
			successes: [
				{ status: "fulfilled", index: 0, name: "first", data: "first-result" },
				{ status: "fulfilled", index: 1, name: "second", data: "second-result" }
			],
			errors: [],
			summary: {
				total: 2,
				succeeded: 2,
				failed: 0
			}
		});
	});

	it("дожидается всех задач и выбрасывает агрегированную ошибку после завершения", async () => {
		const failure = new Error("boom");
		const finished: string[] = [];

		await expect(
			runAsyncTasks(
				[
					{
						name: "success",
						run: async () => {
							finished.push("success");
							return "ok";
						}
					},
					{
						name: "failure",
						run: async () => {
							finished.push("failure");
							throw failure;
						}
					}
				],
				{
					errorMessage: "Загрузка данных маршрута завершилась с ошибками."
				}
			)
		).rejects.toMatchObject({
			name: "AsyncTasksError",
			message: "Загрузка данных маршрута завершилась с ошибками.",
			result: {
				settled: [
					{ status: "fulfilled", index: 0, name: "success", data: "ok" },
					{ status: "rejected", index: 1, name: "failure", error: failure }
				],
				successes: [{ status: "fulfilled", index: 0, name: "success", data: "ok" }],
				errors: [{ status: "rejected", index: 1, name: "failure", error: failure }],
				summary: {
					total: 2,
					succeeded: 1,
					failed: 1
				}
			}
		});

		expect(finished).toEqual(["success", "failure"]);
	});

	it("возвращает пустой результат для пустого списка задач", async () => {
		await expect(runAsyncTasks([])).resolves.toEqual({
			settled: [],
			successes: [],
			errors: [],
			summary: {
				total: 0,
				succeeded: 0,
				failed: 0
			}
		});
	});

	it("не выбрасывает ошибку до завершения остальных задач", async () => {
		const slowTask = createDeferred<string>();
		const failure = new Error("fast failure");
		const rejected = vi.fn();

		const resultPromise = runAsyncTasks([
			{
				name: "slow",
				run: () => slowTask.promise
			},
			{
				name: "fast-failure",
				run: async () => {
					throw failure;
				}
			}
		]).catch((error: unknown) => {
			rejected(error);
			throw error;
		});

		await Promise.resolve();

		expect(rejected).not.toHaveBeenCalled();

		slowTask.resolve("done");

		await expect(resultPromise).rejects.toBeInstanceOf(AsyncTasksError);
		expect(rejected).toHaveBeenCalledTimes(1);
	});
});
