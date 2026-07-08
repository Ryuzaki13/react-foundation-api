# @ryuzaki13/react-foundation-api

Библиотечный пакет для инфраструктуры `shared/api`: HTTP-транспорт, async/resource helpers, persisted resources и специализированные transport adapters.

## Публичные entrypoints

- `@ryuzaki13/react-foundation-api/http` — обычный HTTP/REST transport.
- `@ryuzaki13/react-foundation-api/async` — batch/concurrent async helpers.
- `@ryuzaki13/react-foundation-api/resource` — generic resource descriptors поверх TanStack Query.
- `@ryuzaki13/react-foundation-api/persisted` — persisted resource helpers.
- `@ryuzaki13/react-foundation-api/odata` — OData/SAP Gateway helpers.
- `@ryuzaki13/react-foundation-api/transport` — transport request normalization.
- `@ryuzaki13/react-foundation-api/server-fn` — adapters для server function operations.
- `@ryuzaki13/react-foundation-api/adt` — ADT/SAP transport helpers.
- `@ryuzaki13/react-foundation-api/s3` — S3 file transfer helpers.
- `@ryuzaki13/react-foundation-api/error-report` — API-level error report adapters.

## Peer-зависимости

`@ryuzaki13/react-foundation-lib`, `@tanstack/react-query`, `react` и `fast-xml-parser` объявлены как peerDependencies. `react`, `@tanstack/react-query` и `fast-xml-parser` помечены optional на уровне npm, потому что они нужны только отдельным subpath entrypoints.

## Сборка

```bash
npm install
npm run typecheck
npm run build
```

Сборка создаёт ESM-файлы через Vite и декларации типов через `tsc`.
