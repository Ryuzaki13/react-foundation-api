import { AsyncTasksError } from "./AsyncTasksError";

export type AsyncTask<TResult = unknown> = {
	readonly name: string;
	readonly run: () => Promise<TResult>;
};

export type AsyncTaskSuccess<TResult> = {
	readonly status: "fulfilled";
	readonly index: number;
	readonly name: string;
	readonly data: TResult;
};

export type AsyncTaskFailure = {
	readonly status: "rejected";
	readonly index: number;
	readonly name: string;
	readonly error: unknown;
};

export type AsyncTaskSettled<TResult> = AsyncTaskSuccess<TResult> | AsyncTaskFailure;

export type RunAsyncTasksResult<TResult = unknown> = {
	readonly settled: readonly AsyncTaskSettled<TResult>[];
	readonly successes: readonly AsyncTaskSuccess<TResult>[];
	readonly errors: readonly AsyncTaskFailure[];
	readonly summary: {
		readonly total: number;
		readonly succeeded: number;
		readonly failed: number;
	};
};

export type RunAsyncTasksOptions = {
	readonly errorMessage?: string;
};

const DEFAULT_ASYNC_TASKS_ERROR_MESSAGE = "Не удалось выполнить все асинхронные задачи.";

async function runSingleAsyncTask<TResult>(task: AsyncTask<TResult>, index: number): Promise<AsyncTaskSettled<TResult>> {
	try {
		const data = await task.run();

		return {
			status: "fulfilled",
			index,
			name: task.name,
			data
		};
	} catch (error) {
		return {
			status: "rejected",
			index,
			name: task.name,
			error
		};
	}
}

function splitAsyncTaskSettled<TResult>(
	settled: readonly AsyncTaskSettled<TResult>[]
): Pick<RunAsyncTasksResult<TResult>, "successes" | "errors"> {
	const successes: AsyncTaskSuccess<TResult>[] = [];
	const errors: AsyncTaskFailure[] = [];

	for (const item of settled) {
		switch (item.status) {
			case "fulfilled": {
				successes.push(item);
				break;
			}

			case "rejected": {
				errors.push(item);
				break;
			}

			default: {
				const checker: never = item;
				void checker;
			}
		}
	}

	return {
		successes,
		errors
	};
}

function createRunAsyncTasksResult<TResult>(settled: readonly AsyncTaskSettled<TResult>[]): RunAsyncTasksResult<TResult> {
	const { successes, errors } = splitAsyncTaskSettled(settled);

	return {
		settled,
		successes,
		errors,
		summary: {
			total: settled.length,
			succeeded: successes.length,
			failed: errors.length
		}
	};
}

export async function runAsyncTasks<TResult>(
	tasks: readonly AsyncTask<TResult>[],
	options: RunAsyncTasksOptions = {}
): Promise<RunAsyncTasksResult<TResult>> {
	const settled = await Promise.all(tasks.map((task, index) => runSingleAsyncTask(task, index)));
	const result = createRunAsyncTasksResult(settled);

	if (result.errors.length > 0) {
		throw new AsyncTasksError(options.errorMessage ?? DEFAULT_ASYNC_TASKS_ERROR_MESSAGE, result);
	}

	return result;
}
