import type { RunAsyncTasksResult } from "./runAsyncTasks";

export class AsyncTasksError<TResult = unknown> extends Error {
	public readonly result: RunAsyncTasksResult<TResult>;

	constructor(message: string, result: RunAsyncTasksResult<TResult>) {
		super(message);
		this.name = "AsyncTasksError";
		this.result = result;
	}
}
