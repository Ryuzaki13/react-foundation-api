# `@ryuzaki13/react-foundation-api`

Переиспользуемый API-слой для React/TypeScript-приложений: обычный HTTP, OData V2 и SAP Gateway, TanStack Query resource descriptors, persisted records, server-function adapters, пакетные async-задачи, SAP transports и доставка error reports.

Документация написана как самостоятельный справочник: для её чтения не нужен доступ к исходникам пакета.

## Установка

```bash
npm install @ryuzaki13/react-foundation-api @ryuzaki13/react-foundation-lib
```

Пакет распространяется как ESM и не имеет корневого entrypoint. Импортируйте только опубликованные subpath:

```ts
import { httpJsonQueryFn } from "@ryuzaki13/react-foundation-api/http";
import { odataQueryFn } from "@ryuzaki13/react-foundation-api/odata";
import { createResourceDescriptor } from "@ryuzaki13/react-foundation-api/resource";
```

```ts
// Неверно: корневой import не опубликован.
import { odataQueryFn } from "@ryuzaki13/react-foundation-api";
```

## Каталог документации

| Entrypoint | Когда использовать | Подробная страница |
| --- | --- | --- |
| `adt` | Получить пользовательские SAP ADT transports и разобрать XML | [ADT](./src/adt/README.mdx) |
| `async` | Запустить независимые задачи параллельно или с ограничением concurrency | [Async](./src/async/README.mdx) |
| `error-report` | Доставить подготовленный в `foundation-lib` черновик отчёта | [Error Report](./src/error-report/README.mdx) |
| `http` | Обычный HTTP/REST без SAP, OData, SSO и X-CSRF | [HTTP](./src/http/README.mdx) |
| `odata` | OData V2, SAP Gateway, metadata, SSO, X-CSRF, справочники и таблицы | [OData](./src/odata/README.mdx) |
| `persisted` | Стандартные сохранённые записи: list/latest/history/save/create/delete | [Persisted](./src/persisted/README.mdx) |
| `resource` | Произвольный transport-agnostic ресурс поверх TanStack Query | [Resource](./src/resource/README.mdx) |
| `server-fn` | Адаптировать функцию контракта `{ data }` к resource/persisted operation | [Server Function](./src/server-fn/README.mdx) |
| `transport` | Получить workbench/customizing transport requests пользователя SAP | [SAP Transport Requests](./src/transport/README.mdx) |

Общая карта пакета, границы ответственности и схема выбора entrypoint находятся на странице [Foundation API: обзор](./src/foundationApi.mdx).

## Peer dependencies

`@ryuzaki13/react-foundation-lib` обязателен. Остальные peers нужны только тем entrypoint, которые их используют.

| Dependency | Где нужна |
| --- | --- |
| `@tanstack/react-query` | `resource`, `persisted`, `server-fn`, `odata`, `error-report` |
| `@tanstack/react-table` | табличный adapter из `odata` |
| `react` | React hooks из `odata`, `resource`, `persisted` |
| `fast-xml-parser` | XML parser из `adt` |

Проверяйте фактический peer-контракт установленной версии пакета. Optional peer означает «не нужен каждому entrypoint», а не «будет автоматически установлен при первом использовании».

## Проверка пакета

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run pack:dry-run
```

Если символ не экспортируется через указанный в `package.json#exports` subpath, глубокий импорт из `src` или `dist` не является публичным API.
