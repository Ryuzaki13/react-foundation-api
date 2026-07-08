export type ConcurrentTaskContext = {
	/**
	 * Индекс элемента во входном массиве.
	 */
	index: number;

	/**
	 * Внешний AbortSignal.
	 * Важно: helper сам не может "магически" отменить уже начатую async-операцию.
	 * Для реальной отмены нужно пробрасывать signal внутрь task
	 * и чтобы сама реализация task его поддерживала.
	 */
	signal?: AbortSignal;
};

export type ConcurrentTaskFn<TInput, TResult> = (input: TInput, context: ConcurrentTaskContext) => Promise<TResult>;

export type ConcurrentTaskSuccess<TInput, TResult> = {
	status: "fulfilled";
	index: number;
	input: TInput;
	data: TResult;
};

export type ConcurrentTaskError<TInput> = {
	status: "rejected";
	index: number;
	input: TInput;
	error: unknown;
};

export type ConcurrentTaskSettled<TInput, TResult> = ConcurrentTaskSuccess<TInput, TResult> | ConcurrentTaskError<TInput>;

export type ConcurrentTaskUnprocessed<TInput> = {
	index: number;
	input: TInput;
};

export type ConcurrentTaskProgress<TInput, TResult> = {
	total: number;
	completed: number;
	succeeded: number;
	failed: number;
	running: number;
	pending: number;
	percentage: number;
	aborted: boolean;
	lastSettled?: ConcurrentTaskSettled<TInput, TResult>;
};

export type RunConcurrentTasksOptions<TInput, TResult> = {
	/**
	 * Максимальное количество одновременно выполняемых задач.
	 *
	 * @default 4
	 */
	concurrency?: number;

	/**
	 * Внешний AbortSignal.
	 *
	 * Поведение при abort:
	 * - новые задачи больше не стартуют;
	 * - уже начатые задачи helper не прерывает сам;
	 * - функция возвращает partial result с `aborted: true`.
	 */
	signal?: AbortSignal;

	/**
	 * Вызывается после каждого завершенного элемента.
	 *
	 * ### Важно: callback не должен бросать исключения.
	 */
	onProgress?: (progress: ConcurrentTaskProgress<TInput, TResult>) => void;

	/**
	 * Вызывается при успешной обработке одного элемента.
	 *
	 * ### Важно: callback не должен бросать исключения.
	 */
	onItemSuccess?: (item: ConcurrentTaskSuccess<TInput, TResult>) => void;

	/**
	 * Вызывается при ошибке одного элемента.
	 *
	 * ### Важно: callback не должен бросать исключения.
	 */
	onItemError?: (item: ConcurrentTaskError<TInput>) => void;
};

export type RunConcurrentTasksResult<TInput, TResult> = {
	/**
	 * Итоги по каждому обработанному элементу в порядке исходного массива.
	 * Необработанные элементы сюда не попадают.
	 */
	settled: ConcurrentTaskSettled<TInput, TResult>[];

	/**
	 * Только успешные элементы.
	 */
	successes: ConcurrentTaskSuccess<TInput, TResult>[];

	/**
	 * Только ошибки.
	 */
	errors: ConcurrentTaskError<TInput>[];

	/**
	 * Элементы, которые не были запущены.
	 * Обычно это актуально при abort.
	 */
	unprocessed: ConcurrentTaskUnprocessed<TInput>[];

	/**
	 * Был ли batch прерван внешним signal.
	 */
	aborted: boolean;

	/**
	 * Сводка для UI/логов.
	 */
	summary: {
		total: number;
		completed: number;
		succeeded: number;
		failed: number;
		unprocessed: number;
	};
};

function validateConcurrency(concurrency: number): void {
	if (!Number.isInteger(concurrency)) {
		throw new TypeError("concurrency должен быть целым числом");
	}

	if (concurrency < 1) {
		throw new RangeError("concurrency должен быть >= 1");
	}
}

/**
 * Выполняет задачи над набором входных данных с ограничением по параллелизму.
 *
 * Ключевые свойства:
 * - не останавливается на первой ошибке;
 * - всегда собирает полный список success/error для уже стартовавших задач;
 * - поддерживает progress callbacks;
 * - поддерживает abort на уровне постановки новых задач;
 * - не зависит от конкретного transport/query stack.
 *
 * Исключения:
 * - выбрасывает только при невалидных аргументах;
 * - ошибки отдельных задач НЕ выбрасываются наружу, а попадают в `result.errors`.
 */
export async function runConcurrentTasks<TInput, TResult>(
	inputs: readonly TInput[],
	task: ConcurrentTaskFn<TInput, TResult>,
	options: RunConcurrentTasksOptions<TInput, TResult> = {}
): Promise<RunConcurrentTasksResult<TInput, TResult>> {
	const { concurrency = 4, signal, onProgress, onItemSuccess, onItemError } = options;

	validateConcurrency(concurrency);

	if (inputs.length === 0) {
		return {
			settled: [],
			successes: [],
			errors: [],
			unprocessed: [],
			aborted: Boolean(signal?.aborted),
			summary: {
				total: 0,
				completed: 0,
				succeeded: 0,
				failed: 0,
				unprocessed: 0
			}
		};
	}

	const settledByIndex = new Array<ConcurrentTaskSettled<TInput, TResult> | undefined>(inputs.length);

	let nextIndex = 0;
	let completed = 0;
	let succeeded = 0;
	let failed = 0;
	let running = 0;

	const isAborted = (): boolean => Boolean(signal?.aborted);

	const emitProgress = (lastSettled?: ConcurrentTaskSettled<TInput, TResult>): void => {
		onProgress?.({
			total: inputs.length,
			completed,
			succeeded,
			failed,
			running,
			pending: Math.max(inputs.length - completed - running, 0),
			percentage: inputs.length === 0 ? 100 : Math.round((completed / inputs.length) * 100),
			aborted: isAborted(),
			lastSettled
		});
	};

	const workerCount = Math.min(concurrency, inputs.length);

	const worker = async (): Promise<void> => {
		while (true) {
			if (isAborted()) {
				return;
			}

			const currentIndex = nextIndex;
			nextIndex += 1;

			if (currentIndex >= inputs.length) {
				return;
			}

			const input = inputs[currentIndex];
			running += 1;

			try {
				const data = await task(input, {
					index: currentIndex,
					signal
				});

				const item: ConcurrentTaskSuccess<TInput, TResult> = {
					status: "fulfilled",
					index: currentIndex,
					input,
					data
				};

				settledByIndex[currentIndex] = item;
				succeeded += 1;
				onItemSuccess?.(item);
			} catch (error) {
				const item: ConcurrentTaskError<TInput> = {
					status: "rejected",
					index: currentIndex,
					input,
					error
				};

				settledByIndex[currentIndex] = item;
				failed += 1;
				onItemError?.(item);
			} finally {
				running -= 1;
				completed += 1;

				const settledItem = settledByIndex[currentIndex];
				if (settledItem) {
					emitProgress(settledItem);
				}
			}
		}
	};

	await Promise.all(Array.from({ length: workerCount }, () => worker()));

	const settled: ConcurrentTaskSettled<TInput, TResult>[] = [];
	const successes: ConcurrentTaskSuccess<TInput, TResult>[] = [];
	const errors: ConcurrentTaskError<TInput>[] = [];
	const unprocessed: ConcurrentTaskUnprocessed<TInput>[] = [];

	for (const [index, input] of inputs.entries()) {
		const item = settledByIndex[index];

		if (!item) {
			unprocessed.push({ index, input });
			continue;
		}

		settled.push(item);

		if (item.status === "fulfilled") {
			successes.push(item);
		} else {
			errors.push(item);
		}
	}

	return {
		settled,
		successes,
		errors,
		unprocessed,
		aborted: isAborted(),
		summary: {
			total: inputs.length,
			completed: settled.length,
			succeeded: successes.length,
			failed: errors.length,
			unprocessed: unprocessed.length
		}
	};
}
