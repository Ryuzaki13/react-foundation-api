# shared/api: внутренняя архитектура и сопровождение

Этот документ предназначен для разработчиков, которые сопровождают слой `src/shared/api`, меняют его границы, добавляют transport adapters или правят взаимодействие с TanStack Query.

Документ для пользователей публичного API: [README.md](./README.md).

## Цель слоя

`shared/api` — infrastructure boundary для доступа к внешним данным.

Он должен:

- централизовать API transport;
- не допускать дублирование fetch/OData/SAML/CSRF логики в features/widgets/pages;
- давать reusable orchestration для query keys, queries, mutations и cache strategies;
- оставаться независимым от конкретных entities/features/widgets;
- быть переносимым между SPA SAP/OData проектом и SSR/TanStack Start проектом на уровне shared-контрактов.

Он не должен:

- знать доменную бизнес-логику;
- импортировать `entities`, `features`, `widgets`, `pages`, `app`;
- импортировать `@tanstack/react-start`;
- превращать `persisted` в универсальный resource;
- скрыто поддерживать старый `shared/api/fetch` через compatibility re-export.

## Текущая карта слоёв

```text
src/shared/api
  http/             neutral HTTP transport
  odata/            OData v2 + metadata-aware API
    transport/      SAP/OData fetch transport, SSO, CSRF, OData envelope
  resource/         generic resource orchestration over TanStack Query
  server-fn/        serverFn -> resource operation adapters
  persisted/        fixed capability facade for saved records
  async/            concurrent task helpers
  analytics/        analytics helpers
  adt/              ADT-specific OData helpers
  s3/               S3/OData upload helpers
  transport/        transport request domain helpers
```

## Зависимости между новыми слоями

```text
persisted/rest  -> http
persisted/keys  -> resource/keys
server-fn       -> resource/types
resource        -> @tanstack/react-query
odata           -> odata/transport
odata/transport -> shared/config, shared/lib
http            -> browser fetch only
```

Специально отсутствует зависимость:

```text
odata/transport -> http
```

Причина описана ниже в разделе про transport boundaries.

## Public API

Корневой barrel `src/shared/api/index.ts` экспортирует:

- `./http`;
- `./odata`;
- `./persisted`;
- `./resource`;
- `./server-fn`;
- существующие соседние API-модули.

Удалённый слой `./fetch` не экспортируется. Это breaking change по правилам репозитория: compatibility layer не добавлялся.

`src/shared/api/odata/index.ts` экспортирует `./transport`, чтобы старые OData-oriented символы (`fetchJson`, `fetchBase`, `SsoRequiredError`) оставались доступны как часть OData API, а не как generic fetch.

## Граница `http`

### Назначение

`shared/api/http` — минимальный transport для обычного HTTP.

Он предоставляет:

- `httpFetch`;
- `httpFetchPayload`;
- `httpJsonQueryFn`;
- `httpJsonMutationFn`;
- типы `HttpRequestOptions`, `HttpQueryFnOptions`, `HttpMutationFnOptions`;
- `RouteError`.

### Инварианты

`http` не должен знать:

- SAP;
- OData;
- SAML2;
- X-CSRF;
- metadata;
- QueryClient;
- service worker стратегии кроме pass-through заголовка `x-sw-cache` в query factory.

### Почему `httpFetchPayload` возвращает `unknown`

Внешний HTTP payload не является доверенным контрактом TypeScript.

Поэтому `httpFetchPayload`, `httpJsonQueryFn` и `httpJsonMutationFn` не приводят данные к generic-типу самостоятельно. Пользователь обязан передать `parse`.

Это защищает от старой проблемы `fetchJson<T>`, где `T` мог создать иллюзию проверенного ответа.

### Error policy

`httpFetch` бросает обычный `Error`, если `response.ok === false`.

Текущая политика минимальная:

- если payload ошибки строковый и непустой, он попадает в message;
- иначе используется `${status} ${statusText}`;
- специализированные error-классы для REST пока не вводились.

Если в будущем потребуется богатая HTTP error model, добавлять её в `http`, но не затрагивать OData error flow.

## Граница `odata`

### Назначение

`shared/api/odata` — OData v2 слой.

Он содержит:

- metadata-aware helper-ы (`odataQueryFn`, `odataReadFn`, `odataCreateFn`, `odataUpdateFn`, `odataDeleteFn`, `odataFunctionImportFn`);
- низкоуровневый transport в `odata/transport`;
- hooks для OData collections и metadata;
- utility для query keys, dependent services, sorting, collection model.

### `odata/transport`

Этот каталог содержит бывший `shared/api/fetch`.

Файлы:

- `fetch.ts` — основной SAP/OData transport;
- `SsoRequiredError.ts` — SSO error + recovery helpers;
- `errorReport.ts` — report unexpected HTML/SAML response;
- `types.ts` — `BaseURLType`, request init aliases;
- `url.ts` — base URL map и URL normalization;
- тесты transport-а.

### Что делает `fetch.ts`

Основной lifecycle:

1. Определяет base URL через `BaseUrlMap` и `BaseURLType`.
2. Нормализует относительный путь.
3. Определяет, SAP это запрос или нет.
4. Определяет SAP client.
5. Для mutating methods получает X-CSRF token.
6. Выполняет `fetch`.
7. Если backend вернул HTML/SAML форму, строит `SsoRequiredError`.
8. Если ответ OData JSON, снимает envelope `{ d, results, __count }`.
9. Удаляет `__metadata` из OData record-ов.
10. Возвращает `{ data, totalCount? }` или raw data helper-ом верхнего уровня.

### Почему `odata/transport` не использует `http`

Это намеренное решение текущей миграции.

`http` — payload-oriented neutral transport. Он:

- вызывает `fetch`;
- проверяет `response.ok`;
- парсит JSON/text;
- возвращает `unknown`;
- строит generic HTTP error.

`odata/transport` — stateful SAP/OData transport. Ему нужен полный контроль над `Response`, текстом ответа, повторной авторизацией и CSRF lifecycle.

Если заменить внутренний `fetch` в OData на `httpFetchPayload`, будут смешаны несовместимые политики:

- `http` бросит generic error раньше, чем OData сможет распознать SSO HTML;
- `http` распарсит payload раньше, чем OData сможет обработать OData envelope;
- OData потеряет собственную report policy для unexpected HTML;
- CSRF retry и SSO recovery станут менее очевидными;
- generic HTTP error начнёт утекать в SAP/OData сценарии.

Допустимый будущий рефакторинг: выделить более низкий primitive, который не парсит payload и не применяет error policy.

Например:

```text
shared/api/http/rawFetch.ts
  -> только resolve baseUrl + fetch(input, init)
```

Тогда:

```text
http/http.ts          -> rawFetch + generic HTTP policy
odata/transport      -> rawFetch + SAP/OData policy
```

Но текущий `httpFetchPayload` не является таким primitive.

## Граница `resource`

### Назначение

`resource` — transport-agnostic orchestration поверх TanStack Query.

Он решает только generic-механику:

- query key factory;
- scope validation;
- произвольные query operation names;
- произвольные mutation operation names;
- `queryOptions`;
- `useQuery`;
- `fetchQuery`;
- `useMutation`;
- cache strategy после успешной mutation.

Он не выполняет HTTP/OData/serverFn напрямую.

### Основные сущности

`ResourceDescriptor<TScope, TQueries, TMutations>`:

- `namespace`;
- `resource`;
- `keys`;
- `operations.queries`;
- `operations.mutations`;
- `isEnabled`;
- `getScopeError`.

`ResourceQueryOperation<TScope, TArgs, TResult>`:

- `execute`;
- `isEnabled`;
- `staleTime`;
- `gcTime`.

`ResourceMutationOperation<TScope, TInput, TResult, TDescriptor>`:

- `execute`;
- `cacheStrategy`.

### Query key normalization

`createResourceKeys` строит ключи:

```text
[namespace, resource]
[namespace, resource, normalizedScope]
[namespace, resource, normalizedScope, operationName]
[namespace, resource, normalizedScope, operationName, normalizedArgs]
```

`normalizeResourceKeyValue`:

- `null`/`undefined` -> `null`;
- `string` -> `trim()`;
- `number`/`boolean` -> как есть;
- `array` -> рекурсивная нормализация;
- `object` -> сортировка ключей + рекурсивная нормализация;
- остальное -> `String(value)`.

Важно: эта нормализация предназначена для query key, а не для доменных данных.

### Scope validation

`assertResourceScope` считает scope валидным, если:

- scope не `null`;
- scope не `undefined`;
- `descriptor.isEnabled?.(scope) ?? true` возвращает `true`.

Если scope невалиден, бросается:

- `descriptor.getScopeError?.(scope)`;
- или дефолтная ошибка `Недостаточно данных scope...`.

`enabled` для query считается отдельно через `resolveResourceQueryEnabled`:

- если descriptor disabled, query disabled;
- иначе учитывается operation-level `isEnabled`.

Это важно: disabled query не должна выполнить `queryFn`, но если кто-то вызовет operation напрямую через imperative path с невалидным scope, будет ранняя ошибка.

### Runtime shape guard для операций

Descriptor generic-типы описывают контракт на compile time, но в runtime операция всё равно извлекается из object-map.

Поэтому `resource.ts` проверяет наличие функции `execute` перед использованием operation. Это не полноценная runtime validation всей структуры, а минимальная защита от отсутствующей operation или неправильного значения в descriptor.

### Cache strategy lifecycle

Mutation lifecycle:

1. `useResourceMutation` получает `QueryClient`.
2. Проверяет scope.
3. Вызывает `operation.execute`.
4. После success повторно проверяет scope.
5. Выбирает strategy:
    - `options.cacheStrategy === undefined` -> strategy операции;
    - `options.cacheStrategy === null` -> cache strategy отключена;
    - иначе используется strategy из options.
6. Вызывает `applyResourceCacheStrategy`.
7. Затем вызывает `options.onSuccess`.

Такой порядок выбран намеренно: сначала кэш приводится в ожидаемое состояние, затем доменный callback может делать навигацию, уведомления или дополнительные действия.

## Граница `server-fn`

### Назначение

`server-fn` содержит adapter factories для TanStack Start server functions, но сам Start не импортирует.

Причина:

- `@tanstack/react-start` не должен попадать в client runtime shared layer;
- SSR-проект может передать уже созданную serverFn как обычную функцию.

### Контракт

```ts
type ServerFnTransport<TData, TResponse> = (request: { readonly data: TData }) => Promise<TResponse>;
```

Это минимальная публичная форма TanStack Start serverFn на клиенте.

### Query adapter

`createServerFnQueryOperation` возвращает `ResourceQueryOperation`.

Lifecycle:

1. Получает `scope`, `args`, `client`, `signal` от `resource`.
2. Строит `data` через `buildData(scope, args)`.
3. Вызывает serverFn как `{ data }`.
4. Если задан `transform`, возвращает transform-result.
5. Иначе возвращает response.

### Mutation adapter

`createServerFnMutationOperation` возвращает `ResourceMutationOperation`.

Lifecycle:

1. Получает `scope`, `input`, `client` от `resource`.
2. Строит `data` через `buildData(scope, input)`.
3. Вызывает serverFn как `{ data }`.
4. Применяет `transform`, если он задан.
5. Cache strategy остаётся в operation contract и применяется уже в `resource`/`persisted` hook.

### Executor

`executor` существует для тестов и редких интеграционных сценариев.

Он принимает:

- `serverFn`;
- normalized request `{ data }`;
- context `{ client, signal? }`.

Не использовать `executor` как место бизнес-логики. Бизнес-маппинг должен быть в `buildData`/`transform` или выше в entity/feature.

## Граница `persisted`

### Назначение

`persisted` — специализированный фасад поверх идеи сохранённых записей.

Он появился из задачи, где несколько сущностей имели одинаковый смысл:

- список записей;
- последняя запись;
- история;
- сохранение;
- создание;
- удаление.

Поэтому capability model фиксированная:

```text
queries:   list, latest, history
mutations: save, create, delete
```

Новые произвольные capability туда не добавлять. Для них существует `resource`.

### Внутренние части

- `payload.ts` — JSON codec для persisted payload;
- `keys.ts` — persisted key factory, теперь поверх `resource/createResourceKeys`;
- `cache.ts` — persisted cache strategies;
- `odata.ts` — OData operation adapters;
- `rest.ts` — REST operation adapters поверх `http`;
- `resource.ts` — persisted descriptor + hooks;
- `types.ts` — persisted contracts.

### Почему `persisted` не был удалён

`resource` решает общий случай, но `persisted` остаётся полезным:

- у него есть готовые имена hooks;
- он документирует legacy business pattern сохранённых записей;
- он сохраняет компактную настройку для variant/view-config/preset;
- он ограничивает старые операции, вместо того чтобы размывать generic resource.

### Связь persisted и resource

На текущем этапе:

- `persisted/keys.ts` использует `createResourceKeys`;
- `persisted/rest.ts` использует `http`;
- `persisted` может принимать operations из `server-fn`, потому что они структурно совместимы по `execute/cacheStrategy`;
- orchestration hooks в `persisted/resource.ts` пока собственные, потому что они завязаны на фиксированные capability и существующие persisted-типы.

Полностью переписывать `persisted/resource.ts` поверх `resource/useResourceQuery` можно, но это отдельный рефакторинг. Нужно будет аккуратно свести descriptor shape, cache strategy context и типы fixed capability.

## REST adapter внутри `persisted`

`createPersistedRestQueryOperation` и `createPersistedRestMutationOperation` используют `httpFetchPayload`.

Ключевой инвариант:

```text
executor задан       -> executor отвечает за тип результата
executor не задан    -> parseResponse обязателен
```

Так REST adapter не делает небезопасное приведение `unknown` к `TResponse`.

Если вызвать REST operation без `executor` и без `parseResponse`, будет runtime error:

```text
REST persisted operation requires executor or parseResponse.
```

Это осознанная защита внешней границы.

## OData adapter внутри `persisted`

`persisted/odata.ts` адаптирует fixed capability к `odataFetchFn`.

Он:

- принимает `odata: { service, target }`;
- строит `params`, `options`, `init`;
- вызывает `odataFetchFn`;
- возвращает `response.data`;
- применяет `transform`, если он задан;
- прокидывает `staleTime`, `gcTime`, `isEnabled`;
- поддерживает `cacheStrategy` для mutations.

Внутри есть typed bridge к `odataFetchFn`, потому что OData helper имеет метод-зависимые generics. Там используются приведения через `unknown` для сведения overload-like типов. Это место нужно менять осторожно: оно изолирует сложность OData method typing внутри adapter-а.

## Как добавлять новый transport adapter

Новый adapter должен возвращать:

- `ResourceQueryOperation<TScope, TArgs, TResult>`;
- или `ResourceMutationOperation<TScope, TInput, TResult, TDescriptor>`;
- либо persisted-compatible operation, если это строго fixed persisted capability.

Порядок:

1. Определить transport boundary.
2. Не импортировать верхние слои.
3. Внешний payload принимать как `unknown`, если transport получает непроверенные данные.
4. Добавить parser/transform contract.
5. Не добавлять compatibility alias.
6. Добавить тест на request shape.
7. Добавить тест на transform/result.
8. Добавить тест на cache strategy, если adapter работает с mutation.
9. Обновить README и ARCHITECTURE.

## Как добавлять новую resource operation в прикладном коде

Если операция бизнесовая и не является fixed persisted capability:

1. Создать operation через `createResourceQueryOperation` или transport adapter.
2. Добавить operation в `createResourceDescriptor`.
3. Экспортировать доменный hook из entity/api или app-local entity/api.
4. Не экспортировать descriptor наружу без необходимости.
5. Query key должен включать все аргументы, влияющие на результат.
6. Mutation cache strategy должна быть точечной, если возможно.

## Где должна жить domain mapping логика

Техническая нормализация protocol-level ответа может жить в `shared/api`.

Примеры:

- OData envelope `{ d, results }`;
- удаление `__metadata`;
- HTTP JSON/text parsing;
- query key normalization;
- SSO error detection.

Доменный mapping должен жить выше:

- entity API;
- app-local entity API;
- feature API, если mapping относится к сценарию.

Примеры domain mapping:

- выбор default variant;
- преобразование column layout конкретного ракурса;
- валидация прав пользователя на действие;
- уведомления;
- route navigation после mutation.

## Тестовая стратегия

Для слоя нужны три категории тестов:

1. Transport tests.
   Проверяют request/response/error lifecycle.
2. Adapter tests.
   Проверяют, что adapter строит правильный request и применяет transform.
3. Resource orchestration tests.
   Проверяют query keys, arbitrary operation names и cache strategies.

Сейчас ключевые тесты:

- `src/shared/api/odata/transport/fetch.test.ts`;
- `src/shared/api/odata/transport/SsoRequiredError.test.ts`;
- `src/shared/api/persisted/adapters.test.ts`;
- `src/shared/api/resource/resource.test.ts`.

## Проверки после изменений

Минимум:

```bash
npm run typecheck
npm run test -- run src/shared/api/resource/resource.test.ts src/shared/api/persisted/adapters.test.ts src/shared/api/odata/transport/fetch.test.ts src/shared/api/odata/transport/SsoRequiredError.test.ts
```

Если полный `typecheck` падает на unrelated ошибках, запускать и фиксировать в отчёте:

```bash
npx --yes -p typescript@5.9.3 tsc -p tsconfig.json --noEmit
```

Для import boundaries и стиля:

```bash
npx --yes -p eslint@9.39.4 eslint src/shared/api/http src/shared/api/odata/transport src/shared/api/resource src/shared/api/server-fn
```

## Архитектурные запреты

Нельзя:

- восстанавливать `shared/api/fetch` как compatibility layer;
- импортировать `@tanstack/react-start` из `src/shared/api`;
- использовать `httpFetchPayload` как внутренний OData parser;
- добавлять `any` или `as any`;
- делать `persisted` универсальным operation registry;
- добавлять бизнесовые operation names в `persisted`;
- дублировать SSO/CSRF logic вне `odata/transport`;
- делать UI-компоненты потребителями low-level transport;
- добавлять broad invalidation, если можно обновить конкретный query.

## Допустимые будущие улучшения

1. Выделить raw HTTP primitive без parsing/error policy, если появится реальное дублирование между `http` и `odata/transport`.
2. Переписать `persisted/resource.ts` поверх generic `resource`, если получится сохранить типы cache strategy без ухудшения public API.
3. Добавить более богатую HTTP error model для REST endpoint-ов.
4. Добавить больше typed parser helpers в `shared/lib`, если несколько REST adapters начнут повторять одинаковые runtime checks.
5. Сузить публичный root barrel, если broad exports начнут создавать неоднозначность между OData и neutral HTTP.
