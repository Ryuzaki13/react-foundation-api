# OData API Helpers

Этот каталог содержит helper-функции для выполнения OData-запросов с опорой на metadata сервиса.

Для прикладного кода доступны отдельные функции под разные сценарии:

- `odataCreateFn`
- `odataUpdateFn`
- `odataDeleteFn`
- `odataReadFn`
- `odataQueryFn`
- `odataFunctionImportFn`

Все они используют общий низкоуровневый helper `odataFetchFn`.

Важно:

- через публичный barrel `@/shared/api` доступны специализированные helper-ы;
- `odataFetchFn` не реэкспортируется из публичного barrel и обычно импортируется напрямую только для низкоуровневых сценариев.

Механизм кеширования `$metadata`, version-check, справочников `useODataCollectionQuery` и critical update описан отдельно в [docs/odata-reference-cache.md](/docs/odata-reference-cache.md).

## Что делают helper-ы

Все OData helper-ы:

- загружают metadata OData-сервиса через `react-query`;
- находят `target` в metadata;
- проверяют совместимость операции и target;
- вычисляют HTTP-метод;
- строят URL по metadata;
- объединяют `params` target и OData query options;
- сериализуют `body`, если он есть;
- могут автоматически распарсить ответ по metadata;
- могут преобразовать raw-ответ через `transform`.

## Публичный API

Из `index.ts` наружу экспортируются:

```ts
export { odataFetch, type ODataFetchOptions } from "./odataFetch";
export {
	odataCreateFn,
	odataDeleteFn,
	odataFunctionImportFn,
	odataQueryFn,
	odataReadFn,
	odataUpdateFn,
	type ODataFetchFnRequest
} from "./odataQueryFn";
```

## Общая модель вызова

Каждый helper вызывается в два шага:

```ts
const queryFn = odataQueryFn({
	odata: { service: "TEXT_DEMO_SRV", target: "TextEntity" }
});

const result = await queryFn({ client, signal });
```

На первом шаге вы описываете запрос.  
На втором шаге вызываете функцию с runtime-контекстом:

```ts
{
	client: QueryClient;
	signal?: AbortSignal;
}
```

- `client` обязателен, потому что metadata читается через `react-query`;
- `signal` обычно приходит из `useQuery`, `useInfiniteQuery` или `useMutation`.

## Generics

Все helper-ы используют одну и ту же generic-модель:

```ts
<I, O = I, T = I>
```

Перед чтением generics полезно держать в голове простое правило:

- `I` обычно описывает одну OData-сущность в том виде, в котором она опубликована в metadata;
- на практике это прикладной TypeScript-тип для `EntityType`, построенный по полям metadata соответствующей сущности;
- `O` описывает доменную модель после преобразования;
- `T` используется только там, где нужно отдельно типизировать `body` у `create/update`.

### `I`

`I` — тип одной сущности в OData-форме.

Проще всего думать о нём как о TypeScript-представлении `EntityType` из metadata.

Пример:

```ts
type RawRow = {
	ID: string;
	NAME: string;
};
```

### `O`

`O` — итоговый тип после `transform`.

Для `odataCreateFn`, `odataUpdateFn`, `odataDeleteFn`, `odataReadFn`, `odataFunctionImportFn`:

- без `transform` результат имеет тип `I`;
- с `transform` результат имеет тип `O`.

Для `odataQueryFn`:

- без `transform` результат имеет тип `I[]`;
- `transform` получает `I[]`;
- `transform` может вернуть `O[]` или один `O`.

### `T`

`T` нужен только для `odataCreateFn` и `odataUpdateFn`, если тип тела запроса нужно описать отдельно от raw-ответа.

`options` всегда типизируются по `I`, потому что:

- `select`
- `expand`
- `sorts`
- `expression`

должны ссылаться на поля OData `EntityType`, опубликованные в metadata.

### Когда достаточно одного generic

Если:

- ответ не трансформируется;
- `options` описывают поля raw-сущности;
- `body` совпадает по форме с raw-ответом;

то обычно достаточно одного generic:

```ts
const queryFn = odataQueryFn<RawRow>({
	odata: { service: "TEXT_DEMO_SRV", target: "TextEntity" }
});
```

### Когда нужен `O`

Если вы используете `transform`, укажите тип результата:

```ts
type Row = {
	id: string;
	name: string;
};

const queryFn = odataQueryFn<RawRow, Row>({
	odata: { service: "TEXT_DEMO_SRV", target: "TextEntity" },
	transform: (rows) =>
		rows.map((row) => ({
			id: row.ID,
			name: row.NAME
		}))
});
```

### Когда нужен `T`

Для `odataCreateFn` и `odataUpdateFn` `body` типизируется через `T`.

Если тело отличается от raw-ответа, укажите третий generic:

```ts
type CreateBody = {
	name: string;
};

type RawResponse = {
	id: string;
	name: string;
};

const mutationFn = odataCreateFn<RawResponse, RawResponse, CreateBody>({
	odata: { service: "TEXT_DEMO_SRV", target: "ENTITY" },
	body: { name: "Demo" }
});
```

## Общие поля конфигурации

## `odata`

```ts
odata: {
	service: string;
	target: string;
}
```

- `service` — имя OData-сервиса;
- `target` — имя target ровно в том виде, как оно опубликовано в metadata.

`target` может быть:

- обычной `Entity`;
- `FunctionImport`.

## `options`

Тип: `ODataFetchOptions<I>`.

Это дополнительные OData query options:

```ts
options?: {
	expression?: FilterExpression<T>;
	sorts?: Sort<keyof T>[];
	select?: (keyof T)[];
	expand?: (keyof T)[];
	top?: number;
	skip?: number;
	inlinecount?: string;
	format?: "json";
	baseUrl?: BaseURLType;
	swCache?: string;
}
```

Они преобразуются в стандартные OData query-параметры:

- `$filter`
- `$orderby`
- `$select`
- `$expand`
- `$top`
- `$skip`
- `$inlinecount`

Пример:

```ts
options: {
	select: ["ID", "NAME"],
	top: 20,
	sorts: [{ key: "NAME", desc: false }]
}
```

## `params`

`params` — это параметры самого target, описанные в metadata.

Тип:

```ts
type ODataParameters = Partial<Record<string, ODataValue>>;

type ODataValue = {
	value: InputType;
	formatter?: ODataFormatterFn;
};
```

Пример:

```ts
params: {
	p_date: { value: new Date() },
	p_customer: { value: "100015" }
}
```

Эти параметры участвуют в построении URL target.

## `init`

Тип:

```ts
init?: Omit<RequestInit, "signal" | "method" | "body">
```

Сюда можно передавать дополнительные fetch-опции, кроме:

- `signal`
- `method`
- `body`

Обычно через `init` передают:

- `headers`
- `credentials`
- `mode`
- `cache`

## `transform`

Для single-result helper-ов:

```ts
transform?: (data: I, target: ODataTargetMetadata) => O;
```

Для `odataQueryFn`:

```ts
transform?: (data: I[], target: ODataTargetMetadata) => O[] | O;
```

`transform` нужен для преобразования raw-ответа в доменную модель.

Пример:

```ts
transform: (rows) =>
	rows.map((row) => ({
		id: row.ID,
		name: row.NAME
	}));
```

## `autoParse`

```ts
autoParse?: boolean;
```

Если включить `autoParse`, ответ сначала проходит через `parseODataResponseByMetadata`, а затем через `transform`.

Автоматически парсятся:

- `abapBooleanLike` значения;
- даты;
- числа;
- другие primitive-типы, если они известны из metadata.

Для `FunctionImport` автопарсинг работает, когда metadata указывает `resultEntity`.

Порядок обработки:

1. выполняется запрос;
2. приходит raw-ответ;
3. применяется `autoParse`;
4. применяется `transform`;
5. возвращается `{ data, totalCount }`.

## `swCache`

Политика кеширования для Service Worker.

Прокидывается через заголовок `x-sw-cache`.

Поддерживаемые примеры:

- `"off"`
- `"ttl=24h"`
- `"ttl=6h;name=ref"`
- `"ttl=10m;max=200;name=ui"`
- `"ttl=30s;max=300;name=fast"`
- `"bust=24h;name=ref"`

## `params` и `options` — это разные уровни

- `params` описывают сам target;
- `options` описывают способ чтения результата.

Проще говоря:

- `params` влияют на path target;
- `options` влияют на `$filter`, `$select`, `$top` и другие OData query options.

## Helper `wrapODataParams`

Часто параметры удобно собирать через `wrapODataParams`:

```ts
import { wrapODataParams } from "@ryuzaki13/react-foundation-lib/odata-service";

params: wrapODataParams({
	variantId: "uuid-1",
	appId: "app"
});
```

## Матрица операций

| Функция                 | Target                    | HTTP        | `params`                     | `body`     | URL                                       |
| ----------------------- | ------------------------- | ----------- | ---------------------------- | ---------- | ----------------------------------------- |
| `odataCreateFn`         | `Entity`                  | `POST`      | нет                          | обязателен | `/SERVICE/ENTITY`                         |
| `odataUpdateFn`         | `Entity`                  | `PUT`       | обязательны                  | обязателен | `/SERVICE/ENTITY(params...)`              |
| `odataDeleteFn`         | `Entity`                  | `DELETE`    | обязательны                  | нет        | `/SERVICE/ENTITY(params...)`              |
| `odataReadFn`           | `Entity`                  | `GET`       | обязательны                  | нет        | `/SERVICE/ENTITY(params...)`              |
| `odataQueryFn`          | plain `Entity`            | `GET`       | опциональны, но игнорируются | нет        | `/SERVICE/ENTITY`                         |
| `odataQueryFn`          | query `Entity` с `result` | `GET`       | участвуют в URL              | нет        | `/SERVICE/ENTITY(params...)/Set\|Results` |
| `odataFunctionImportFn` | `FunctionImport`          | из metadata | обязательны                  | нет        | `/SERVICE/FI?param=...`                   |

## `odataCreateFn`

Используйте для создания сущности.

Конфигурация:

```ts
{
	odata: ODataServiceConfig;
	body: T;
}
```

Поведение:

- только для `Entity`;
- HTTP-метод: `POST`;
- путь: `/SERVICE/ENTITY`;
- `body` обязателен;
- `params` не используются.

Пример:

```ts
const mutationFn = odataCreateFn<Variant>({
	odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_VARIANT" },
	body: {
		id: "uuid-4",
		name: "Новый вариант"
	}
});
```

## `odataUpdateFn`

Используйте для обновления сущности по ключу.

Конфигурация:

```ts
{
	odata: ODataServiceConfig;
	params: ODataParameters;
	body: T;
}
```

Поведение:

- только для `Entity`;
- HTTP-метод: `PUT`;
- путь: `/SERVICE/ENTITY(params...)`;
- `params` обязательны;
- `body` обязателен.

Пример:

```ts
const mutationFn = odataUpdateFn<ThemeRaw, ThemeRaw, { name: string }>({
	odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_THEME" },
	params: wrapODataParams({ name: "dark" }),
	body: { name: "dark" }
});
```

## `odataDeleteFn`

Используйте для удаления сущности по ключу.

Конфигурация:

```ts
{
	odata: ODataServiceConfig;
	params: ODataParameters;
}
```

Поведение:

- только для `Entity`;
- HTTP-метод: `DELETE`;
- путь: `/SERVICE/ENTITY(params...)`;
- `body` не используется.

Пример:

```ts
const mutationFn = odataDeleteFn({
	odata: { service: "TEXT_CONFIG_SRV", target: "TextPresetSet" },
	params: wrapODataParams({ recId: "uuid-1" })
});
```

## `odataReadFn`

Используйте для чтения одной сущности по ключу.

Конфигурация:

```ts
{
	odata: ODataServiceConfig;
	params: ODataParameters;
}
```

Поведение:

- только для `Entity`;
- HTTP-метод: `GET`;
- путь: `/SERVICE/ENTITY(params...)`;
- `body` не поддерживается.

`odataReadFn` не подходит для query entity, у которой в metadata есть `result`.  
Для таких target используйте `odataQueryFn`.

Пример:

```ts
const queryFn = odataReadFn<Variant>({
	odata: { service: "TEXT_CONFIG_SRV", target: "TEXT_VARIANT" },
	params: wrapODataParams({ variantId: "uuid-1" })
});
```

## `odataQueryFn`

Это основной helper для чтения списков и query-сущностей.

Конфигурация:

```ts
{
	odata: ODataServiceConfig;
	params?: ODataParameters;
	options?: ODataFetchOptions<I>;
}
```

### Plain entity

Если target — обычная `Entity`, URL будет таким:

```txt
/SERVICE/ENTITY
```

Если для такого target передать `params`, они будут проигнорированы.

### Parameterized query entity

Если metadata содержит `result: "Set"` или `result: "Results"`, URL будет таким:

```txt
/SERVICE/ENTITY(params...)/Set
```

или:

```txt
/SERVICE/ENTITY(params...)/Results
```

В этом случае `params` участвуют в построении URL.

### Пример списка с transform

```ts
type RawRow = {
	ID: string;
	NAME: string;
};

type Row = {
	id: string;
	name: string;
};

const queryFn = odataQueryFn<RawRow, Row>({
	odata: { service: "TEXT_REPORT_SRV", target: "TEXT_REPORT_ENTITY" },
	params: wrapODataParams({
		p_date: new Date(),
		p_date_to: new Date(),
		type_manager: "main"
	}),
	options: {
		select: ["ID", "NAME"]
	},
	autoParse: true,
	transform: (rows) =>
		rows.map((row) => ({
			id: row.ID,
			name: row.NAME
		}))
});
```

### Пример агрегации в один объект

```ts
type Summary = {
	total: number;
	firstId?: string;
};

const queryFn = odataQueryFn<RawRow, Summary>({
	odata: { service: "TEXT_DEMO_SRV", target: "TextEntity" },
	transform: (rows) => ({
		total: rows.length,
		firstId: rows[0]?.ID
	})
});
```

## `odataFunctionImportFn`

Используйте для вызова `FunctionImport`.

Конфигурация:

```ts
{
	odata: ODataServiceConfig;
	params: ODataParameters;
}
```

Поведение:

- target должен быть `FunctionImport`;
- HTTP-метод берётся из metadata;
- если `httpMethod` отсутствует, будет ошибка;
- `params` обязательны;
- `body` не используется;
- параметры target становятся query string-параметрами;
- `options` дописываются в тот же query string.

Пример:

```ts
const mutationFn = odataFunctionImportFn<CreateTransportRequestRaw, TransportRequest>({
	odata: { service: "TEXT_CONFIG_SRV", target: "createTextRequest" },
	params: wrapODataParams({
		type: "workbench",
		text: "Новый транспорт"
	}),
	transform: (raw) => mapCreatedTransportRequest(raw, "workbench")
});
```

URL будет вида:

```txt
/TEXT_CONFIG_SRV/createTextRequest?type='workbench'&text='Новый транспорт'
```

## Низкоуровневый helper `odataFetchFn`

`odataFetchFn` нужен, когда вы хотите явно указать семантику операции отдельным аргументом:

```ts
const queryFn = odataFetchFn("query", {
	odata: { service: "TEXT_REPORT_SRV", target: "TEXT_REPORT_ENTITY" }
});
```

Обычно в прикладном коде удобнее использовать специализированные helper-ы:

- `odataQueryFn`
- `odataReadFn`
- `odataCreateFn`
- `odataUpdateFn`
- `odataDeleteFn`
- `odataFunctionImportFn`

## Автопарсинг и transform

Только `autoParse`:

```ts
const queryFn = odataQueryFn<RawRow>({
	odata: { service: "TEXT_DEMO_SRV", target: "TextEntity" },
	autoParse: true
});
```

`autoParse` вместе с `transform`:

```ts
const queryFn = odataQueryFn<RawRow, Row>({
	odata: { service: "TEXT_DEMO_SRV", target: "TextEntity" },
	autoParse: true,
	transform: (rows) =>
		rows.map((row) => ({
			id: row.ID,
			name: row.NAME
		}))
});
```

Если включён `autoParse`, `transform` получает уже распарсенные данные.

## Runtime-валидация

Перед выполнением запроса helper:

- проверяет, что target существует в metadata;
- проверяет, что target не конфликтует одновременно как `Entity` и как `FunctionImport`;
- проверяет совместимость выбранной операции и target.

Ошибка будет, если:

- `odataFunctionImportFn` вызван для обычной `Entity`;
- `odataCreateFn`, `odataUpdateFn`, `odataDeleteFn`, `odataReadFn`, `odataQueryFn` вызваны для `FunctionImport`;
- `odataReadFn` вызван для query entity с `result`;
- metadata не содержит `httpMethod` для `FunctionImport`;
- отсутствует обязательный параметр target.

## Возвращаемое значение

Все helper-ы возвращают:

```ts
Promise<{
	data: ...;
	totalCount?: number;
}>
```

Тип `data` зависит от helper-а:

- `odataCreateFn`, `odataUpdateFn`, `odataDeleteFn`, `odataReadFn`, `odataFunctionImportFn`
    - без `transform`: `I`
    - с `transform`: `O`
- `odataQueryFn`
    - без `transform`: `I[]`
    - с `transform`: `O[]` или `O`

`totalCount` приходит из транспортного слоя, если backend его вернул.

## Что использовать в прикладном коде

Практическая рекомендация:

- чтение списка или query entity: `odataQueryFn`
- чтение одной сущности по ключу: `odataReadFn`
- создание: `odataCreateFn`
- обновление: `odataUpdateFn`
- удаление: `odataDeleteFn`
- вызов `FunctionImport`: `odataFunctionImportFn`
- низкоуровневый универсальный вход: `odataFetchFn`

## Связанные файлы

- `odataFetch.ts` — низкоуровневый transport helper без metadata-логики
- `parseODataResponseByMetadata.ts` — автопарсинг ответа по metadata
- `useODataMetadataQuery.ts` — загрузка metadata
- `wrapParams.ts` — helper для сборки `ODataParameters`
