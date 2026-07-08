import { RunConcurrentTasksResult } from "./runConcurrentTasks";

export class ConcurrencyPartialError<TInput, TResult> extends Error {
	public readonly result: RunConcurrentTasksResult<TInput, TResult>;

	constructor(message: string, result: RunConcurrentTasksResult<TInput, TResult>) {
		super(message);
		this.name = "ConcurrencyPartialError";
		this.result = result;
	}
}
