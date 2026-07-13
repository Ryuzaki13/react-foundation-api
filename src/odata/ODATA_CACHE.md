# Кеширование OData metadata и справочников

Документ описывает механизм кеширования OData metadata и справочников, которые читаются через `useODataCollectionQuery`. Цель механизма — быстро открывать страницы с уже загруженными справочниками, но при этом точечно обновлять устаревшие данные без массового перезапроса всего IndexedDB-кеша.

## Участники механизма

| Зона                       | Файл                                                     | Ответственность                                                                  |
| -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TanStack Query persistence | `src/shared/lib/query-client/persistence.ts`             | Ленивое сохранение opt-in query в IndexedDB через per-query persister            |
| Metadata query             | `src/shared/api/odata/useODataMetadataQuery.ts`          | Загрузка и кеширование `$metadata` OData-сервиса                                 |
| Metadata version check     | `src/shared/api/odata/metadataVersionCheck.ts`           | Проверка времени последней генерации сервиса через `ZP_ZARM_APP_SERVICE_UPDATED` |
| Collection updates query   | `src/shared/api/odata/useODataCollectionUpdatesQuery.ts` | Проверка списка изменённых справочников через `ZP_ZARM_APP_TABLES_UPDATED`       |
| Collection query           | `src/shared/api/odata/useODataCollectionQuery.ts`        | Загрузка справочника, сравнение сигналов свежести и выбор `x-sw-cache` policy    |
| Service Worker cache       | `src/app/sw.ts` и `src/shared/lib/pwa`                   | HTTP-кеширование ответов по заголовку `x-sw-cache`                               |
| Azure critical update      | `azure-pipeline.yml` и `config/vite/define.ts`           | Выпуск нового стабильного `__APP_BUILD_ID__` для принудительной проверки         |

## Общий принцип

Справочники и metadata сохраняются только для query с `meta: persistedQueryMeta`. Persistence не гидратит весь кеш на старте приложения. Query восстанавливается лениво, когда пользователь открывает страницу, где этот query реально нужен.

Это важно для нагрузки:

- открытие страницы с одним справочником не трогает все остальные справочники в IndexedDB;
- критическое обновление не запускает массовый refetch сохранённых query;
- старые inactive query могут быть помечены устаревшими, но сеть пойдёт только при появлении активного потребителя.

## IndexedDB persistence

`createReactQueryPersister()` подключается в `createQueryClient()` как default `persister` для TanStack Query. Фильтр persistence пропускает только query, у которых `query.meta.persist === true`.

Текущие настройки:

- `REACT_QUERY_PERSISTENCE_BUSTER` берётся из `VITE_REACT_QUERY_PERSISTENCE_BUSTER`, значение по умолчанию — `"arm-persist-v4"`;
- `REACT_QUERY_PERSISTENCE_MAX_AGE = 90 дней`;
- `refetchOnRestore = true`;
- физическое хранилище: IndexedDB database текущего SAP/system контекста, object store `queries`;
- ключ записи строится TanStack persister-ом из prefix и `queryHash`.

`maxAge = 90 дней` ограничивает срок жизни IndexedDB-записей, чтобы старые ключи после смены `buildId` постепенно удалялись. Актуальность внутри этого окна контролируется отдельными query:

- metadata — через version-check;
- справочники — через список обновлений, timestamp metadata и недельный safety-window.

## Metadata

Metadata загружается через `odataMetadataQueryOptions()`:

- query key: `["odata", "metadata", { service, baseUrl: resolvedBaseUrl }]`;
- `staleTime = Infinity`;
- `gcTime = Infinity`;
- `meta = persistedQueryMeta`.

`baseUrl` в ключе всегда канонизируется через `resolveODataBaseUrl()`. Поэтому вызовы без `baseUrl` и с явным default-значением используют одну запись кеша, а реально разные SAP endpoints остаются разделены.

Сам query считается бесконечно fresh, чтобы не перезагружать `$metadata` при каждом открытии страницы. Решение об обновлении принимает отдельный query версии.

### Проверка версии metadata

`odataMetadataVersionQueryOptions()` читает технический target `ZP_ZARM_APP_SERVICE_UPDATED` сервиса `ZARM_APP_SRV`:

- query key: `["odata", "metadata-version", { service, buildId: __APP_BUILD_ID__ }]`;
- стандартный `staleTime` — 24 часа;
- query тоже сохраняется в IndexedDB.

`buildId` в ключе нужен для критического обновления. Если Azure pipeline получил коммит с `[critical-update]`, он выпускает новый `VITE_CRITICAL_UPDATE_TOKEN`, который попадает в runtime как `__APP_BUILD_ID__`. После такого билда старый `metadata-version` query key больше не совпадает, поэтому следующая страница с metadata принудительно запросит версию у бэкенда даже если прошлый version-check ещё fresh.

### Применение результата version-check

`applyODataMetadataVersion()` сравнивает:

- `version.changedAt` — время последней генерации сервиса на бэкенде;
- `metadataState.dataUpdatedAt` — время записи текущего metadata query в TanStack Query.

Если `version.changedAt > metadataState.dataUpdatedAt`, инвалидируется только metadata указанного сервиса. Version-check другого сервиса и metadata других сервисов не трогаются.

Если version-check временно недоступен, сохранённые metadata остаются рабочим источником. Это позволяет открыть приложение с persisted metadata даже при кратковременной проблеме технического target.

Ошибка фонового refetch `$metadata` также не удаляет уже восстановленные данные и не переводит страницу в error boundary. Ошибка остаётся в состоянии TanStack Query и общей диагностике, а страница использует сохранённые metadata до успешной повторной загрузки. Ошибка бросается только при первичной загрузке, когда рабочих metadata ещё нет.

## Справочники

`useODataCollectionQuery()` используется потребителями справочников. Query key строится через `createODataCollectionQueryKey()` и включает:

- `service`;
- `target`;
- `limitedKeys`;
- `serverFilter`.

Результат справочника содержит `cacheUpdatedAt`. Это прикладной timestamp, который сохраняется вместе с данными и нужен для сравнения с внешними сигналами свежести.

Настройки query:

- `meta = persistedQueryMeta`;
- `staleTime = 2 часа`;
- `gcTime = 1 час`;
- фоновая загрузка включается только после готовности metadata и завершения текущей проверки обновлений; восстановленный кеш при этом может показываться сразу.

### Список обновлений справочников

`useODataCollectionUpdatesQuery()` читает технический target `ZP_ZARM_APP_TABLES_UPDATED`:

- query key: `["odata", "collection-updates", { buildId: __APP_BUILD_ID__ }]`;
- `staleTime = 4 часа`;
- `gcTime = Infinity`;
- `x-sw-cache = "ttl=4h;name=ref-updates"`;
- query сохраняется в IndexedDB.

`buildId` в ключе нужен по той же причине, что и для metadata-version: критический билд принудительно создаёт новый query key для проверки списка обновлений. Это не перезагружает справочники само по себе. Оно только заставляет открыть свежий список обновлений при следующем использовании `useODataCollectionQuery`.

Результат содержит:

- `items` — нормализованные записи бэкенда;
- `byEntityName` — быстрый доступ по имени target;
- `fetchedAt` — когда список был получен;
- `coverageStartedAt` — нижняя граница недельного окна бэкенд-сервиса.

## Когда справочник обновляется

Для каждого открытого справочника `useODataCollectionQuery()` вычисляет `shouldBustCollectionCache`. Справочник обновляется только для текущего query key, если сработал хотя бы один сигнал.

### 1. Target есть в списке обновлений

Если `byEntityName[target].lastChangedAt` новее `cacheUpdatedAt`, справочник инвалидируется и следующий запрос идёт с `bust` policy для Service Worker.

Это основной регулярный путь, который покрывает изменения справочников в пределах окна бэкенд-сервиса.

### 2. Metadata обновилась позже справочника

`useODataMetadata()` прокидывает `metadataUpdatedAt` из metadata query. Если metadata сервиса была реально перезагружена и её `dataUpdatedAt` новее `cacheUpdatedAt` справочника, открытый справочник считается устаревшим.

Это закрывает критический сценарий:

1. выходит билд с `[critical-update]`;
2. новый `__APP_BUILD_ID__` заставляет заново проверить `metadata-version`;
3. бэкенд сообщает, что metadata сервиса новее persisted metadata;
4. metadata query инвалидируется и перезагружается;
5. открытые или позже открытые справочники этого сервиса видят более новый `metadataUpdatedAt`;
6. обновляется только этот справочник, а не весь persisted cache.

### 3. Локальный кеш старше недельного окна

Бэкенд-список обновлений справочников содержит изменения только за последнюю неделю. Поэтому отсутствие target в `ZP_ZARM_APP_TABLES_UPDATED` не доказывает актуальность, если пользователь не открывал приложение дольше недели.

Для этого `useODataCollectionUpdatesQuery()` рассчитывает `coverageStartedAt = fetchedAt - 7 дней`. Если `cacheUpdatedAt < coverageStartedAt`, открытый справочник обновляется даже без записи в `byEntityName`.

Так пользователь, вернувшийся из отпуска, не остаётся с устаревшим persisted справочником. При этом нагрузка остаётся ленивой: обновляются только справочники страниц, которые пользователь реально открыл.

## Service Worker cache policy

Справочники по умолчанию используют:

```ts
ODATA_COLLECTION_DEFAULT_SW_CACHE = "ttl=forever;name=ref";
```

Когда есть подтверждённый сигнал устаревания, `resolveODataCollectionSwCachePolicy()` переводит `ttl=` в `bust=`:

```text
ttl=forever;name=ref -> bust=forever;name=ref
ttl=10m;name=custom -> bust=10m;name=custom
```

Если policy уже `off` или уже начинается с `bust=`, она не меняется.

Это важно: одной инвалидации React Query недостаточно, потому что HTTP-ответ справочника может лежать в Service Worker runtime cache. `bust` заставляет SW обойти старую запись и сохранить свежий ответ по той же cache policy.

## Что происходит при критическом обновлении

Критический билд не чистит IndexedDB и не меняет общий `REACT_QUERY_PERSISTENCE_BUSTER`.

Вместо этого меняется `__APP_BUILD_ID__`, который участвует только в ключах технических проверок:

- `metadata-version`;
- `collection-updates`.

Итоговый поток:

1. Пользователь открывает страницу после деплоя.
2. Metadata и справочники могут восстановиться из IndexedDB.
3. Новый `metadata-version` query key заставляет проверить версию metadata.
4. Новый `collection-updates` query key заставляет проверить список изменённых справочников.
5. Если metadata не менялась, справочники не перезагружаются только из-за факта нового билда.
6. Если metadata изменилась, обновляются только справочники, которые открыты сейчас или будут открыты позже.
7. Если список обновлений содержит конкретный target, обновляется только этот target.
8. Если локальный справочник старше недельного coverage-window, обновляется только этот открытый справочник.

## Почему не используется общий buster для всего persistence

`REACT_QUERY_PERSISTENCE_BUSTER` нужен для несовместимых изменений формата persisted данных или политики хранения. Поднимать его для каждого `[critical-update]` нельзя:

- это сбросит все opt-in query;
- страницы начнут массово восстанавливать справочники с бэкенда;
- исчезнет точечность проверки metadata и справочников;
- обычный фронтенд-билд станет причиной лишней нагрузки на SAP Gateway.

Критическое обновление должно менять ключи проверок свежести, а не физический формат всего IndexedDB-кеша.

## Правила для новых справочников

Если новый справочник использует `useODataCollectionQuery`, отдельная интеграция не нужна. Он автоматически получает:

- ожидание metadata;
- persisted cache;
- проверку списка обновлений;
- реакцию на обновление metadata;
- защиту от недельного окна бэкенда;
- `bust` policy для Service Worker при подтверждённом устаревании.

Если справочник реализован отдельным query, нужно явно решить:

- можно ли сохранять его через `persistedQueryMeta`;
- какой query key описывает все параметры результата;
- есть ли технический источник свежести;
- как обходить Service Worker cache при устаревании;
- что делать при долгом отсутствии пользователя.

## Диагностика

Для проверки в браузере:

1. Открыть DevTools.
2. Перейти в `Application`.
3. Открыть `IndexedDB`.
4. Найти database текущего system/client контекста.
5. Проверить object store `queries`.
6. Найти query keys `metadata`, `metadata-version`, `collection-updates`, `collection`.

Полезные поля:

- `state.dataUpdatedAt` у metadata query;
- `state.data.cacheUpdatedAt` у collection query;
- `state.data.coverageStartedAt` у collection-updates query;
- `queryKey[2].buildId` у technical check query.

## Тесты

Целевые тесты механизма:

```bash
npm run test -- src/shared/api/odata/queryPersistence.test.ts src/shared/api/odata/useODataCollectionUpdatesQuery.test.ts src/shared/api/odata/useODataCollectionQuery.test.ts src/shared/api/odata/useODataTableColumns.test.tsx src/shared/lib/query-client/persistence.test.ts
```

Перед завершением задач, которые меняют TypeScript-код механизма, дополнительно запускать:

```bash
npm run typecheck
npm run lint
```

## Ограничения

- Недельное окно `ZP_ZARM_APP_TABLES_UPDATED` остаётся бэкенд-ограничением. Фронтенд компенсирует его ленивым обновлением открытых справочников, но не получает точную историю изменений старше недели.
- Если технический target списка обновлений недоступен, справочник может загрузиться по обычной policy. Metadata version-check остаётся отдельным сигналом.
- `buildId` создаёт новые persisted записи технических query после критических билдов. Это осознанная плата за принудительную проверку без сброса всех справочников.
- Смена структуры данных справочника, несовместимая с persisted payload, должна решаться поднятием `REACT_QUERY_PERSISTENCE_BUSTER`, а не только `[critical-update]`.
