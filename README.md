# @ryuzaki13/react-foundation-api

Библиотечный пакет для инфраструктуры бывшего `src/shared/api`: HTTP-транспорт, async/resource helpers, persisted resources, OData/SAP Gateway helpers и adapters для transport/server function сценариев.

Пакет публикуется в npm как публичная библиотека, но его основная задача практическая: вынести повторно используемый API-слой из собственных проектов автора и подключать его одинаково в нескольких host-приложениях. Это не универсальный API SDK. Контракты, transport helpers и OData wrappers в первую очередь оптимизируются под семейство проектов, где общий технический фундамент находится в `@ryuzaki13/react-foundation-lib`, а UI-компоненты живут в `@ryuzaki13/react-foundation-ui`.

`react-foundation-api` зависит от `@ryuzaki13/react-foundation-lib` и находится между `lib` и host/UI-слоем: `lib` не знает про API, а `api` переиспользует `lib` для форматтеров, OData metadata, query-client policy, validators и error-report infrastructure.

## Установка

```bash
npm install @ryuzaki13/react-foundation-api @ryuzaki13/react-foundation-lib
```

Пакет распространяется как ESM и не открывает корневой импорт. Используйте только точечные entrypoints из `exports`:

```ts
import { httpJsonQueryFn } from "@ryuzaki13/react-foundation-api/http";
import { runAsyncTasks } from "@ryuzaki13/react-foundation-api/async";
import { createResourceDescriptor } from "@ryuzaki13/react-foundation-api/resource";
import { odataQueryFn, useODataCollectionQuery } from "@ryuzaki13/react-foundation-api/odata";
import type { ODataCollectionConfig } from "@ryuzaki13/react-foundation-api/odata";
```

Импорт вида `@ryuzaki13/react-foundation-api` намеренно недоступен. Consumer явно выбирает нужный subpath, а сборщик host-проекта не получает общий barrel со всеми transport adapters и React hooks. Типы экспортируются теми же subpath entrypoints через `exports.types`.

## Public Entrypoints

| Entry point                                       | Назначение                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `@ryuzaki13/react-foundation-api/http`            | Обычный HTTP/REST transport без SAP/OData side effects.                    |
| `@ryuzaki13/react-foundation-api/async`           | Batch и concurrent async runners с нормализованными ошибками.              |
| `@ryuzaki13/react-foundation-api/resource`        | Generic resource descriptors поверх TanStack Query.                        |
| `@ryuzaki13/react-foundation-api/persisted`       | Persisted resource helpers, payload codec, REST/OData adapters.            |
| `@ryuzaki13/react-foundation-api/odata`           | OData/SAP Gateway fetchers, metadata queries, collection hooks и wrappers. |
| `@ryuzaki13/react-foundation-api/transport`       | Нормализация transport request payloads.                                   |
| `@ryuzaki13/react-foundation-api/server-fn`       | Adapters для server function query/mutation operations.                    |
| `@ryuzaki13/react-foundation-api/adt`             | ADT user transports: fetch и XML parser.                                   |
| `@ryuzaki13/react-foundation-api/error-report`    | API-level adapters для error report delivery и draft lifecycle.            |

Других публичных subpath exports сейчас нет. Если модуль не перечислен в `package.json exports`, его нельзя импортировать из host-проекта.

## Peer-зависимости

`@ryuzaki13/react-foundation-lib` является обязательной peer-зависимостью: этот пакет использует его как нижний технический слой.

Остальные внешние пакеты объявлены как optional peers. Это означает только то, что их не нужно ставить для каждого сценария. Если host использует entrypoint, который импортирует внешний пакет, совместимая peer-зависимость должна быть установлена в host-проекте.

| Entry point                         | Что может потребоваться в host-проекте                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `http`, `async`, `transport`        | Обычно не требуют дополнительных runtime-зависимостей сверх `@ryuzaki13/react-foundation-lib`.              |
| `resource`, `persisted`, `server-fn` | `@tanstack/react-query`; для persisted/query metadata также могут использоваться query persistence helpers. |
| `odata`                             | `react`, `@tanstack/react-query`, `@ryuzaki13/react-foundation-lib`; для store/cache сценариев также peers `zustand`, `immer`, `zod` могут приходить через используемые `lib` entrypoints. |
| `adt`                               | `fast-xml-parser` для разбора ADT XML.                                                                      |
| `error-report`                      | `@tanstack/react-query` и error-report helpers из `@ryuzaki13/react-foundation-lib`.                        |

Такая схема оставляет пакет библиотечным: React, TanStack Query, XML parser и остальные runtime-библиотеки контролируются host-приложением, а не зашиваются в bundle.

## Проверка пакета

Основные команды разработки:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Перед публикацией можно проверить полный npm-артефакт:

```bash
npm run pack:dry-run
```

`npm run build` собирает ESM-файлы через Vite и декларации типов через `tsc`. `npm run pack:dry-run` прогоняет `validate` и показывает состав npm package без публикации.
