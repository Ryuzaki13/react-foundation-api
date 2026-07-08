# Async helpers

Модуль `src/shared/api/async` содержит инфраструктурный helper для пакетного запуска async-задач с ограничением по параллелизму.

Подходит для сценариев, где нужно:

- обработать массив элементов с лимитом одновременных запусков;
- собрать полный partial result без раннего падения на первой ошибке;
- показывать прогресс в UI;
- поддержать остановку очереди через `AbortSignal`.

## Публичный API

```ts
import {
	ConcurrencyPartialError,
	type ConcurrentTaskContext,
	type ConcurrentTaskProgress,
	type RunConcurrentTasksOptions,
	type RunConcurrentTasksResult,
	runConcurrentTasks
} from "@/shared/api";
```

Экспорты модуля:

- `runConcurrentTasks` — основной helper выполнения batch-задач;
- `ConcurrencyPartialError` — удобная error-обертка для strict-сценариев;
- `ConcurrentTaskContext` — контекст, который helper передает в `task`;
- `ConcurrentTaskProgress` — срез прогресса после каждого завершенного элемента;
- `RunConcurrentTasksOptions` — опции запуска;
- `RunConcurrentTasksResult` — итоговая структура результата.

## Базовый контракт

```ts
runConcurrentTasks<TInput, TResult>(
	inputs: readonly TInput[],
	task: (input: TInput, context: ConcurrentTaskContext) => Promise<TResult>,
	options?: RunConcurrentTasksOptions<TInput, TResult>
): Promise<RunConcurrentTasksResult<TInput, TResult>>
```

Что гарантирует helper:

- не выбрасывает ошибки отдельных задач наружу;
- складывает их в `result.errors`;
- сохраняет порядок `settled`, `successes` и `errors` по исходному массиву `inputs`;
- вызывает progress callbacks после каждого завершенного элемента;
- ограничивает число одновременно выполняемых задач через `concurrency`;
- поддерживает остановку очереди через `AbortSignal`.

Что helper не делает:

- не отменяет уже начатую async-операцию сам по себе;
- не знает ничего про React Query, OData или конкретный transport;
- не превращает partial success в exception автоматически.

## Входы и выходы

### `ConcurrentTaskContext`

Контекст, который передается в `task`:

- `index` — индекс элемента во входном массиве;
- `signal` — внешний `AbortSignal`, если он был передан в options.

### `RunConcurrentTasksOptions`

Поддерживаемые опции:

- `concurrency?: number` — максимальное число одновременно выполняемых задач, по умолчанию `4`;
- `signal?: AbortSignal` — внешний сигнал остановки очереди;
- `onProgress?: (progress) => void` — вызывается после каждого завершенного элемента;
- `onItemSuccess?: (item) => void` — вызывается при успешной обработке элемента;
- `onItemError?: (item) => void` — вызывается при ошибке элемента.

Важно: эти callback-функции лучше считать вспомогательными уведомлениями о ходе выполнения, а не частью основной бизнес-логики.

Практически это означает следующее:

- callback может обновить локальный state UI, записать событие в лог, отправить метрику, показать прогресс;
- callback не должен менять внешний поток выполнения batch-а;
- callback не должен содержать критически важную логику, от которой зависит корректность результата `runConcurrentTasks`;
- callback не должен бросать исключения, потому что helper не рассчитан на обработку ошибок внутри `onProgress`, `onItemSuccess` и `onItemError`.

Хороший подход:

- обновить счетчики в интерфейсе;
- записать `console.log` или telemetry;
- сохранить служебную информацию о последнем обработанном элементе.

Плохой подход:

- внутри callback валидировать обязательные бизнес-условия через `throw`;
- запускать логику, без которой результат batch-а считается некорректным;
- использовать callback как единственное место, где сохраняются критичные данные.

Если нужна обязательная бизнес-проверка или ошибка должна остановить вызывающий код, это лучше делать после завершения `runConcurrentTasks`, анализируя `result.errors`, `result.aborted` и `result.summary`.

### `ConcurrentTaskProgress`

Структура прогресса:

- `total` — всего элементов во входном массиве;
- `completed` — уже завершено;
- `succeeded` — завершено успешно;
- `failed` — завершено с ошибкой;
- `running` — сейчас выполняется;
- `pending` — еще не завершено и не выполняется;
- `percentage` — округленный процент завершения;
- `aborted` — был ли активирован внешний `signal`;
- `lastSettled` — последний завершенный элемент.

### `RunConcurrentTasksResult`

Итог результата:

- `settled` — все завершенные элементы в порядке `inputs`;
- `successes` — только успешные элементы;
- `errors` — только ошибки отдельных элементов;
- `unprocessed` — элементы, которые не были запущены;
- `aborted` — batch был остановлен внешним `signal`;
- `summary` — компактная сводка для UI и логов.

## Partial success и порядок результатов

`runConcurrentTasks` рассчитан на сценарий, где успех отдельных элементов и общий успех batch-а определяются вызывающим кодом.

Например:

- если из `10` файлов загрузились `8`, helper вернет `8` элементов в `successes` и `2` в `errors`;
- если элементы завершились в порядке `2 -> 1 -> 3`, итоговый `settled` все равно будет отсортирован по порядку исходного массива.

Именно поэтому helper хорошо подходит для:

- массовой загрузки файлов;
- пакетных мутаций;
- многошаговых запросов по списку ID;
- UI, где нужен промежуточный прогресс и итоговая сводка.

## Пример 1. Загрузка N файлов

```ts
import { fetchJson } from "@/shared/api";
import { type ConcurrentTaskContext, runConcurrentTasks } from "@/shared/api/async";

type UploadFileResponse = {
	id: string;
	name: string;
	url: string;
};

async function uploadSingleFile(file: File, { signal }: ConcurrentTaskContext): Promise<UploadFileResponse> {
	const formData = new FormData();
	formData.append("file", file);

	return fetchJson<UploadFileResponse>(
		"/api/files/upload",
		{
			method: "POST",
			body: formData,
			signal
		},
		""
	);
}

const result = await runConcurrentTasks(files, uploadSingleFile, {
	concurrency: 4,
	onProgress: (progress) => {
		console.log(`[${progress.completed}/${progress.total}] ok=${progress.succeeded} fail=${progress.failed}`);
	},
	onItemError: (item) => {
		console.error("Ошибка загрузки файла", item.input.name, item.error);
	}
});

console.log(result.successes);
console.log(result.errors);
console.log(result.unprocessed);
```

Внутри `task` в проекте стоит использовать не голый `fetch`, а shared-обёртки из `@/shared/api`.

Для этого helper-а чаще всего подходят:

- `fetchJson` — если нужен одиночный JSON-запрос;
- `fetchJsonMutationFn` — если удобнее заранее собрать mutation-функцию;
- `odataQueryFn` — если задача работает через OData-слой.

## Strict-сценарий через `ConcurrencyPartialError`

Ниже более прикладной пример в стиле реального batch-upload слоя: каждый отдельный запрос идет через `fetchJsonMutationFn`, а общий orchestration и сбор partial result берет на себя `runConcurrentTasks`.

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useViewScope } from "@/entities/view";
import { ConcurrencyPartialError, fetchJsonMutationFn, runConcurrentTasks } from "@/shared/api";
import { useNotify } from "@/shared/ui";

type UploadDocumentInput = readonly {
	name: string;
	value: string | ArrayBuffer;
}[];

type UploadResponse = {
	EResponse: string;
};

type UploadRequestBody = {
	ImCallFmJson: string;
	ImUpdateBwJson: string;
	ImCheckBeforeUpdate: string;
	ImView: string;
};

const uploadDocumentMutation = fetchJsonMutationFn<UploadResponse, UploadRequestBody>(
	"/TEXT_TEST_SRV;o=QC0CLNT700/TextEntitySet",
	"POST"
);

function buildUploadDocumentRequest(file: UploadDocumentInput, viewId: string): UploadRequestBody {
	return {
		ImCallFmJson: JSON.stringify({
			fm_name: "TEXT_FUNCTION",
			params: JSON.stringify(file)
		}),
		ImUpdateBwJson: "",
		ImCheckBeforeUpdate: "",
		ImView: viewId
	};
}

export function useUploadDocumentsMutation() {
	const notify = useNotify();
	const queryClient = useQueryClient();
	const scope = useViewScope();

	return useMutation({
		mutationFn: async (files: readonly UploadDocumentInput[]) => {
			const result = await runConcurrentTasks(
				files,
				(file, { signal }) => uploadDocumentMutation(buildUploadDocumentRequest(file, scope.viewId), signal),
				{
					concurrency: 4
				}
			);

			// Если необходимо, чтобы мутация ушла в onError, тогда делаем throw.
			// Иначе в onSuccess получаем тот же result и при необходимости обрабатываем.
			if (result.errors.length > 0 || result.aborted) {
				throw new ConcurrencyPartialError("Загрузка документов завершилась с ошибками.", result);
			}

			return result;
		},

		onError: async (error) => {
			if (error instanceof ConcurrencyPartialError && error.result.successes.length > 0) {
				await queryClient.invalidateQueries({ queryKey: ["claims", "claimDocuments"] });
				notify.warning(`Загружено файлов: ${error.result.successes.length} из ${error.result.summary.total}.`);
				return;
			}

			notify.error("Ошибка отправки данных");
		},

		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["claims", "claimDocuments"] });
			notify.success(`Файлы загружены успешно: ${result.successes.length}.`);
		}
	});
}
```

Что показывает этот паттерн:

- отдельный сетевой запрос инкапсулирован в `fetchJsonMutationFn`;
- batch-слой получает лимит параллелизма и общий `result` через `runConcurrentTasks`;
- partial success превращается в `ConcurrencyPartialError`, но при этом доступен `error.result`;
- UI может отдельно обработать полный успех, частичный успех и полный провал.

Если strict-семантика не нужна, можно просто вернуть `RunConcurrentTasksResult` как валидный partial success.

## Пример 2. Интеграция с useMutation без strict-ошибки

```ts
import { useMutation } from "@tanstack/react-query";

import { runConcurrentTasks } from "@/shared/api/async";

export function useUploadFilesMutation() {
	return useMutation({
		mutationFn: async (files: readonly File[]) => {
			return runConcurrentTasks(files, uploadSingleFile, {
				concurrency: 4
			});
		}
	});
}
```

Использование:

```ts
const uploadMutation = useUploadFilesMutation();

const result = await uploadMutation.mutateAsync(files);

if (result.errors.length > 0) {
	// показать пользователю частично успешный сценарий
	// например: "7 файлов загружено, 2 завершились ошибкой"
}
```

## Пример 3. Прогресс в UI

```ts
import { runConcurrentTasks } from "@/shared/api/async";

const controller = new AbortController();

const result = await runConcurrentTasks(files, uploadSingleFile, {
	concurrency: 3,
	signal: controller.signal,
	onProgress: (progress) => {
		setUploadState({
			total: progress.total,
			completed: progress.completed,
			succeeded: progress.succeeded,
			failed: progress.failed,
			percentage: progress.percentage,
			aborted: progress.aborted
		});
	}
});

// где-то в UI:
controller.abort();
```

## Поведение `abort`

Это важная часть контракта.

Что делает helper при `signal.abort()`:

- перестает стартовать новые задачи;
- уже начатые задачи не останавливает сам;
- возвращает `aborted: true`;
- переносит неуспевшие стартовать элементы в `unprocessed`.

Что helper не гарантирует:

- отмену уже начатого HTTP-запроса;
- мгновенное завершение уже выполняющихся задач.

Для реальной отмены сетевых операций нужно пробрасывать `signal` в shared-обёртку, которая внутри выполняет сетевой запрос:

```ts
odataQueryFn({ ... })({ client, signal });
fetchJsonQueryFn(...)({ signal });
fetchJsonMutationFn(...)(body, signal);
fetchDeleteFn(...)(signal);
```

Иначе helper остановит только очередь постановки новых задач, а уже начатые запросы продолжат выполняться.

## Когда использовать этот helper

Подходит, если нужно:

- выполнять много однотипных async-задач с лимитом параллелизма;
- отделять per-item ошибки от общего статуса batch-а;
- показывать пользователю прогресс и итоговую статистику;
- поддержать cancel кнопкой без потери уже собранных результатов.

Не подходит, если нужен сценарий:

- fail-fast на первой ошибке;
- полная отмена уже начатых операций без участия task-реализации;
- сложная orchestration-логика между задачами, зависящая не только от лимита параллелизма.

---

## Пошаговый пример: загрузка N изображений с оптимистичным UI

### Шаг 1. Определяем типы состояния

Каждый загружаемый файл проходит три состояния: `uploading → success | error`.

```ts
export type ImageUploadStatus = "uploading" | "success" | "error";

export type ImageUploadItem = {
	file: File;
	previewUrl: string; // blob-URL для предпросмотра
	status: ImageUploadStatus;
	uploadedUrl?: string; // URL с сервера (только при success)
	errorMessage?: string; // сообщение об ошибке (только при error)
};
```

### Шаг 2. Пишем task-функцию для одного файла

Task-функция получает `File` и `ConcurrentTaskContext` (с `signal`). Возвращает
Promise с данными от сервера.

```ts
import { type ConcurrentTaskContext } from "@/shared/api";

type UploadResult = { url: string; name: string };

async function uploadImage(file: File, { signal }: ConcurrentTaskContext): Promise<UploadResult> {
	const formData = new FormData();
	formData.append("file", file);

	return odataCreateFn()({ client });
	return fetchJson<UploadResult>("/api/images/upload", { method: "POST", body: formData, signal }, "");
}
```

### Шаг 3. Создаём хук `useImageUploadMutation`

Ключ паттерна — три точки обновления UI:

| Момент          | Что делаем                                                |
| --------------- | --------------------------------------------------------- |
| `onMutate`      | Создаём заглушки со `status: "uploading"` — **мгновенно** |
| `onItemSuccess` | Обновляем конкретный индекс: `status: "success"`          |
| `onItemError`   | Обновляем конкретный индекс: `status: "error"`            |

```ts
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { runConcurrentTasks } from "@/shared/api/async";

export function useImageUploadMutation() {
	const [items, setItems] = useState<ImageUploadItem[]>([]);

	const mutation = useMutation({
		/**
		 * onMutate вызывается синхронно ДО mutationFn.
		 * Здесь создаём оптимистичные заглушки — UI реагирует мгновенно.
		 */
		onMutate(files: File[]) {
			const stubs: ImageUploadItem[] = files.map((file) => ({
				file,
				previewUrl: URL.createObjectURL(file),
				status: "uploading"
			}));
			setItems(stubs);
		},

		mutationFn: async (files: File[]) => {
			return runConcurrentTasks(files, uploadImage, {
				concurrency: 3,

				// Вызывается сразу после успеха конкретного файла
				onItemSuccess(item) {
					setItems((prev) =>
						prev.map((stub, i) => (i === item.index ? { ...stub, status: "success", uploadedUrl: item.data.url } : stub))
					);
				},

				// Вызывается сразу после ошибки конкретного файла
				onItemError(item) {
					const message = item.error instanceof Error ? item.error.message : String(item.error);
					setItems((prev) =>
						prev.map((stub, i) => (i === item.index ? { ...stub, status: "error", errorMessage: message } : stub))
					);
				}
			});
		}
	});

	const reset = () => {
		setItems([]);
		mutation.reset();
	};

	return { items, mutation, reset };
}
```

> **Почему `onMutate`, а не начало `mutationFn`?**
> `onMutate` — синхронный lifecycle-хук TanStack Query. Он выполняется до
> промиса `mutationFn`, поэтому React батчит `setItems` в тот же render-цикл,
> что и переход `mutation.status` в `"pending"`. Если поставить `setItems`
> в начало `mutationFn` — React батчит его со следующим рендером, и заглушки
> появятся чуть позже.

### Шаг 4. Компонент одной карточки `ImageCard`

```tsx
import React from "react";
import styles from "./ImageCard.module.scss";
import { type ImageUploadItem } from "./useImageUploadMutation";

export const ImageCard: React.FC<{ item: ImageUploadItem }> = ({ item }) => {
	const { status, previewUrl, uploadedUrl, file, errorMessage } = item;
	const displayUrl = status === "success" && uploadedUrl ? uploadedUrl : previewUrl;
	const cardClass = status === "success" ? styles.cardSuccess : status === "error" ? styles.cardError : styles.card;

	return (
		<div className={cardClass} title={file.name}>
			{/* Изображение видно всегда — локальный blob при загрузке, серверный URL при успехе */}
			<img src={displayUrl} alt={file.name} className={styles.image} />

			{status === "uploading" && (
				<div className={styles.overlayUploading}>
					<div className={styles.spinner} />
					<span className={styles.label}>Загружается...</span>
				</div>
			)}

			{status === "success" && <div className={styles.iconSuccess}>✓</div>}

			{status === "error" && (
				<div className={styles.overlayError}>
					<span className={styles.iconError}>✕</span>
					<span className={styles.labelError}>{errorMessage ?? "Ошибка"}</span>
				</div>
			)}

			<div className={styles.statusBar}>{file.name}</div>
		</div>
	);
};
```

### Шаг 5. Сборка в `ImageUploadDemo`

```tsx
import React, { useCallback, useRef, useState } from "react";
import { Button } from "@/shared/ui";
import { ImageCard } from "./ImageCard";
import { useImageUploadMutation } from "./useImageUploadMutation";

export const ImageUploadDemo: React.FC = () => {
	const inputRef = useRef<HTMLInputElement>(null);
	const [pendingFiles, setPendingFiles] = useState<File[]>([]);
	const { items, mutation, reset } = useImageUploadMutation();

	const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;
		setPendingFiles(Array.from(files));
		e.target.value = "";
	}, []);

	const handleUpload = useCallback(() => {
		if (pendingFiles.length === 0) return;
		// mutation.mutate() → синхронно вызывает onMutate (заглушки появляются)
		//                   → асинхронно запускает mutationFn (runConcurrentTasks)
		mutation.mutate(pendingFiles);
		setPendingFiles([]);
	}, [mutation, pendingFiles]);

	const isUploading = mutation.status === "pending";
	const isDone = mutation.status === "success" || mutation.status === "error";

	return (
		<div>
			<input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFileChange} />

			<Button onClick={() => inputRef.current?.click()} disabled={isUploading}>
				{pendingFiles.length > 0 ? `Выбрано: ${pendingFiles.length} файл(а)` : "Выбрать изображения"}
			</Button>

			<Button onClick={handleUpload} disabled={pendingFiles.length === 0 || isUploading}>
				{isUploading ? "Загружается..." : "Загрузить"}
			</Button>

			{isDone && mutation.data && (
				<p>
					Загружено: {mutation.data.summary.succeeded} из {mutation.data.summary.total}
				</p>
			)}

			<div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
				{items.map((item, i) => (
					<ImageCard key={`${item.file.name}-${i}`} item={item} />
				))}
			</div>
		</div>
	);
};
```

### Итоговый поток данных

```
Пользователь нажимает «Загрузить»
         │
         ▼
mutation.mutate(files)
         │
         ├─► onMutate()         → setItems(stubs)     → render: N заглушек (uploading)
         │
         └─► mutationFn(files)
                  │
                  └─► runConcurrentTasks(files, uploadImage, { concurrency: 3, ... })
                           │
                           ├─► [файл 0] uploadImage()  ──успех──► onItemSuccess → setItems → render: карточка 0 (success)
                           ├─► [файл 1] uploadImage()  ──ошибка─► onItemError  → setItems → render: карточка 1 (error)
                           ├─► [файл 2] uploadImage()  ──успех──► onItemSuccess → setItems → render: карточка 2 (success)
                           │   ... (следующие стартуют по мере освобождения слотов)
                           │
                           └─► Promise<RunConcurrentTasksResult>
                                        │
                                        └─► onSuccess / onError (опционально: queryClient.invalidate, уведомление)
```

### Почему `index` надёжен для обновления заглушек

`runConcurrentTasks` гарантирует, что `item.index` в `onItemSuccess` и
`onItemError` всегда соответствует позиции элемента в исходном массиве `files`.
`onMutate` создаёт заглушки в той же последовательности. Поэтому `prev[item.index]`
в `setItems` всегда указывает на правильную карточку — независимо от того,
в каком порядке завершились задачи.
