# shared/api: руководство пользователя публичного API

Этот документ описывает, как пользоваться публичным API слоя `src/shared/api`.

Если нужно сопровождать внутреннюю реализацию, менять границы слоёв, добавлять transport или править cache orchestration, сначала читать [ARCHITECTURE.md](./ARCHITECTURE.md).

## Быстрый выбор слоя

`shared/api` теперь разделён на несколько независимых назначений:

| Слой                         | Когда использовать                                                                        | Что не делать                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `shared/api/http`            | Обычный HTTP/REST без SAP, OData, SAML2 и CSRF                                            | Не использовать для OData Gateway                                 |
| `shared/api/odata`           | SAP Gateway / OData v2 / metadata-aware запросы                                           | Не собирать OData URL вручную в feature/entity                    |
| `shared/api/odata/transport` | Низкоуровневый OData transport: `fetchJson`, `fetchBase`, SSO, CSRF                       | Не использовать как общий fetch для SSR/REST                      |
| `shared/api/resource`        | Универсальная модель ресурса с произвольными read/write operation names                   | Не вшивать сюда конкретные transport details                      |
| `shared/api/server-fn`       | Адаптация TanStack Start server functions к `resource`/`persisted` operation contract     | Не импортировать `@tanstack/react-start` в shared                 |
| `shared/api/persisted`       | Узкий фасад для сохранённых записей с capability `list/latest/history/save/create/delete` | Не расширять под произвольные операции, для этого есть `resource` |

## Правило выбора

1. Если endpoint OData/SAP Gateway, использовать `shared/api/odata`.
2. Если endpoint обычный HTTP/REST, использовать `shared/api/http`.
3. Если нужно описать ресурс с query/mutation, query keys и cache policy, использовать `shared/api/resource`.
4. Если ресурс хранит сохранённые записи и укладывается в `list/latest/history/save/create/delete`, можно использовать `shared/api/persisted`.
5. Если проект на TanStack Start вызывает serverFn, транспортную operation создавать через `shared/api/server-fn`.

## Импорты

Для прикладного кода предпочтителен публичный barrel:

```ts
import { httpJsonQueryFn, odataQueryFn } from "@/shared/api";
```

Для специализированных подслоёв допустимы точные публичные импорты:

```ts
import { createResourceDescriptor } from "@/shared/api/resource";
import { createServerFnQueryOperation } from "@/shared/api/server-fn";
import { createPersistedResourceDescriptor } from "@/shared/api/persisted";
```

Не использовать удалённый путь:

```ts
// Нельзя: такого слоя больше нет.
import { fetchJson } from "@/shared/api/fetch";
```

Если нужен `fetchJson`, это OData-specific transport:

```ts
import { fetchJson } from "@/shared/api";
```

или внутри `shared/api`:

```ts
import { fetchJson } from "../odata/transport";
```

## `shared/api/http`

`http` — это чистый HTTP-слой без SAP/OData side effects.

Он не добавляет:

- SAP base URL;
- SAP client;
- X-CSRF token;
- SAML2/SSO recovery;
- OData envelope parsing;
- OData metadata;
- OData-specific error reporting.

### Публичные функции

```ts
httpFetch(input, options): Promise<Response>
httpFetchPayload(input, options): Promise<unknown>
httpJsonQueryFn(url, options): queryFn
httpJsonMutationFn(url, options): mutationFn
```

### `httpFetch`

Использовать, когда нужен сырой `Response`.

```ts
import { httpFetch } from "@/shared/api";

const response = await httpFetch("/api/files/report", {
	baseUrl: "",
	init: {
		headers: {
			Accept: "application/pdf"
		}
	}
});
```

`httpFetch` бросает `Error`, если `response.ok === false`.

### `httpFetchPayload`

Использовать, когда нужен JSON/text payload без TanStack Query factory.

```ts
import { httpFetchPayload } from "@/shared/api";

const payload = await httpFetchPayload("/api/profile", {
	baseUrl: ""
});
```

Результат всегда `unknown`. Его нужно сузить самостоятельно.

```ts
type Profile = {
	readonly id: string;
	readonly name: string;
};

function parseProfile(payload: unknown): Profile {
	if (typeof payload !== "object" || payload === null || !("id" in payload) || !("name" in payload)) {
		throw new Error("Некорректный профиль.");
	}

	if (typeof payload.id !== "string" || typeof payload.name !== "string") {
		throw new Error("Некорректный профиль.");
	}

	return {
		id: payload.id,
		name: payload.name
	};
}

const profile = parseProfile(payload);
```

### `httpJsonQueryFn`

Использовать как `queryFn` для обычного REST endpoint.

```ts
import { queryOptions, useQuery } from "@tanstack/react-query";

import { httpJsonQueryFn } from "@/shared/api";

type Profile = {
	readonly id: string;
	readonly name: string;
};

function parseProfile(payload: unknown): Profile {
	if (typeof payload !== "object" || payload === null || !("id" in payload) || !("name" in payload)) {
		throw new Error("Некорректный профиль.");
	}

	if (typeof payload.id !== "string" || typeof payload.name !== "string") {
		throw new Error("Некорректный профиль.");
	}

	return {
		id: payload.id,
		name: payload.name
	};
}

const profileQueryOptions = (userId: string) =>
	queryOptions({
		queryKey: ["profile", userId],
		queryFn: httpJsonQueryFn(`/api/users/${userId}/profile`, {
			parse: parseProfile
		})
	});

export function useProfileQuery(userId: string) {
	return useQuery(profileQueryOptions(userId));
}
```

Особенности:

- `parse` обязателен;
- `signal` из TanStack Query добавляется автоматически, если в `init.signal` не передан свой;
- `swCache` добавляет заголовок `x-sw-cache`;
- JSON определяется по `Content-Type: application/json`, иначе payload будет строкой.

### `httpJsonMutationFn`

Использовать как `mutationFn` для REST endpoint.

```ts
import { useMutation } from "@tanstack/react-query";

import { httpJsonMutationFn } from "@/shared/api";

type SaveProfileInput = {
	readonly name: string;
};

type SaveProfileResult = {
	readonly id: string;
};

function parseSaveProfileResult(payload: unknown): SaveProfileResult {
	if (typeof payload !== "object" || payload === null || !("id" in payload) || typeof payload.id !== "string") {
		throw new Error("Некорректный результат сохранения профиля.");
	}

	return { id: payload.id };
}

export function useSaveProfileMutation(userId: string) {
	return useMutation({
		mutationKey: ["profile", userId, "save"],
		mutationFn: httpJsonMutationFn<SaveProfileInput, SaveProfileResult>(`/api/users/${userId}/profile`, {
			method: "PUT",
			parse: parseSaveProfileResult
		})
	});
}
```

Если нужно изменить body перед отправкой, использовать `mapBody`:

```ts
httpJsonMutationFn<SaveProfileInput, SaveProfileResult>("/api/profile", {
	method: "POST",
	mapBody: (input) => ({
		displayName: input.name.trim()
	}),
	parse: parseSaveProfileResult
});
```

## `shared/api/odata`

`odata` — слой для SAP Gateway / OData v2.

Использовать его, если запрос зависит от:

- OData metadata;
- TextEntitySet / EntityType / FunctionImport;
- `$select`, `$expand`, `$filter`, `$orderby`, `$top`, `$skip`;
- OData key serialization;
- SAP base URL;
- X-CSRF;
- SAML2/SSO handling.

### Высокоуровневые helper-ы

Для большинства задач использовать:

```ts
odataQueryFn;
odataReadFn;
odataCreateFn;
odataUpdateFn;
odataDeleteFn;
odataFunctionImportFn;
```

Пример query:

```ts
import { queryOptions, useQuery } from "@tanstack/react-query";

import { odataQueryFn } from "@/shared/api";
import { createFilterEqual } from "@ryuzaki13/react-foundation-lib/odata-service";

type RawUser = {
	ID: string;
	NAME: string;
};

type User = {
	readonly id: string;
	readonly name: string;
};

const usersQueryOptions = (departmentId: string) =>
	queryOptions({
		queryKey: ["users", departmentId],
		queryFn: odataQueryFn<RawUser, User>({
			odata: {
				service: "TEXT_USER_SRV",
				target: "TextUserSet"
			},
			options: {
				expression: {
					filters: [createFilterEqual("DEPARTMENT_ID", departmentId)]
				}
			},
			transform: (rows) =>
				rows.map((row) => ({
					id: row.ID,
					name: row.NAME
				}))
		})
	});

export function useUsersQuery(departmentId: string) {
	return useQuery(usersQueryOptions(departmentId));
}
```

Подробнее по metadata-aware helper-ам: [odata/README.md](./odata/README.md).

### Низкоуровневый OData transport

Из `shared/api/odata/transport` доступны:

```ts
fetchBase;
fetchODataJson;
fetchJson;
fetchJsonQueryFn;
fetchJsonMutationFn;
fetchDeleteFn;
fetchQueryFn;
fetchMetadata;
resolveODataBaseUrl;
normalizeODataServiceName;
SsoRequiredError;
recoverSsoSession;
```

Этот слой исторически назывался `shared/api/fetch`, но теперь находится внутри `odata`, потому что его поведение SAP/OData-specific.

Использовать transport напрямую стоит только если:

- нужен запрос к SAP endpoint без metadata-aware `odataFetchFn`;
- нужен bootstrap-запрос;
- нужен SSO recovery;
- нужен raw OData JSON helper;
- существующий helper не покрывает сценарий.

Пример:

```ts
import { fetchJson } from "@/shared/api";

type TransportRequestRaw = {
	readonly TRKORR: string;
	readonly AS4TEXT: string;
};

const rows = await fetchJson<TransportRequestRaw[]>("/TextTransportRequestSet", undefined, "odataDp0");
```

Не использовать `fetchJson` для обычного REST/SSR endpoint. Для этого есть `http`.

## `shared/api/resource`

`resource` — generic orchestration-слой поверх TanStack Query.

Он решает задачи:

- стабильные query keys;
- нормализация `scope`;
- произвольные read operation names;
- произвольные write operation names;
- `queryOptions`;
- `useQuery`;
- `fetchQuery`;
- `useMutation`;
- cache strategies после успешных мутаций.

Он не знает:

- как выполнять HTTP;
- как выполнять OData;
- как вызывать serverFn;
- что такое конкретная бизнес-сущность;
- какие operation names должны существовать.

### Базовая модель

Ресурс описывается descriptor-ом:

```ts
const descriptor = createResourceDescriptor({
	namespace: "profile",
	resource: "settings",
	normalizeScope: (scope: ProfileScope | null | undefined) => ({
		userId: scope?.userId.trim() ?? ""
	}),
	isEnabled: (scope) => Boolean(scope?.userId),
	getScopeError: () => "Не указан userId.",
	operations: {
		queries: {
			detail: createResourceQueryOperation(...)
		},
		mutations: {
			save: createResourceMutationOperation(...)
		}
	}
});
```

`namespace` и `resource` участвуют в query key. Они должны быть стабильными строками.

`scope` — внешний контекст ресурса: пользователь, приложение, ракурс, tenant, документ или другой идентификатор.

`args` — аргументы конкретной read-операции.

`input` — payload write-операции.

### Query key

По умолчанию ключ строится так:

```ts
[namespace, resource, normalizedScope, operationName, normalizedArgs?]
```

Пример:

```ts
descriptor.keys.operation("detail", { userId: " USER " }, { version: 2 });
// ["profile", "settings", { userId: "USER" }, "detail", { version: 2 }]
```

Нормализация:

- `null` и `undefined` превращаются в `null`;
- строки trim-ятся;
- массивы нормализуются поэлементно;
- ключи объектов сортируются;
- остальные значения приводятся к строке.

Если этого недостаточно, передать `normalizeScope`.

### Read operation

```ts
import { createResourceQueryOperation } from "@/shared/api/resource";

type ProfileScope = {
	readonly userId: string;
};

type ProfileArgs = {
	readonly includePermissions: boolean;
};

type Profile = {
	readonly id: string;
	readonly name: string;
};

const detail = createResourceQueryOperation<ProfileScope, ProfileArgs, Profile>({
	staleTime: 1000 * 60,
	execute: async ({ scope, args, signal }) => {
		const response = await fetch(`/api/users/${scope.userId}?permissions=${args.includePermissions}`, { signal });
		const payload: unknown = await response.json();
		return parseProfile(payload);
	}
});
```

### Descriptor + hook

```ts
import { createResourceDescriptor, useResourceQuery } from "@/shared/api/resource";

const profileResource = createResourceDescriptor({
	namespace: "profile",
	resource: "user",
	isEnabled: (scope: ProfileScope | null | undefined) => Boolean(scope?.userId),
	operations: {
		queries: {
			detail
		}
	}
});

export function useProfileQuery(scope: ProfileScope, args: ProfileArgs) {
	return useResourceQuery(profileResource, "detail", scope, args);
}
```

### Imperative preload

```ts
import { getResourceQueryData } from "@/shared/api/resource";

const profile = await getResourceQueryData(profileResource, "detail", scope, args, queryClient);
```

### Mutation operation

```ts
import { createResourceMutationOperation, createInvalidateResourceScopeCacheStrategy } from "@/shared/api/resource";

type SaveProfileInput = {
	readonly name: string;
};

const save = createResourceMutationOperation<ProfileScope, SaveProfileInput, Profile, typeof profileResource>({
	execute: async ({ scope, input }) => {
		const response = await fetch(`/api/users/${scope.userId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input)
		});
		const payload: unknown = await response.json();
		return parseProfile(payload);
	},
	cacheStrategy: createInvalidateResourceScopeCacheStrategy()
});
```

На практике `typeof profileResource` в mutation operation часто неудобен из-за порядка объявления. В таком случае можно:

- объявить mutation после descriptor через отдельный factory;
- использовать `ResourceDescriptor<Scope, Queries, Mutations>` как именованный тип;
- передать cache strategy на уровне `useResourceMutation`.

### Mutation hook

```ts
import { useResourceMutation } from "@/shared/api/resource";

export function useSaveProfileMutation(scope: ProfileScope) {
	return useResourceMutation(profileResource, "save", scope);
}
```

### Cache strategies

Доступны:

```ts
createInvalidateResourceScopeCacheStrategy;
createSetResourceQueryDataCacheStrategy;
composeResourceCacheStrategies;
applyResourceCacheStrategy;
```

Инвалидация всего scope:

```ts
cacheStrategy: createInvalidateResourceScopeCacheStrategy();
```

Точечное обновление query:

```ts
createSetResourceQueryDataCacheStrategy({
	getQueryKey: ({ descriptor, scope }) => descriptor.keys.operation("detail", scope, undefined),
	update: (_current, { result }) => result
});
```

Композиция:

```ts
composeResourceCacheStrategies(
	createSetResourceQueryDataCacheStrategy(...),
	createInvalidateResourceScopeCacheStrategy()
);
```

## `shared/api/server-fn`

`server-fn` адаптирует TanStack Start server functions к operation contract из `resource`.

Слой специально не импортирует `@tanstack/react-start`.

Он знает только переносимую форму:

```ts
type ServerFnTransport<TData, TResponse> = (request: { readonly data: TData }) => Promise<TResponse>;
```

### Query operation

```ts
import { createResourceDescriptor, useResourceQuery } from "@/shared/api/resource";
import { createServerFnQueryOperation } from "@/shared/api/server-fn";

type Scope = {
	readonly userId: string;
};

type Profile = {
	readonly id: string;
	readonly name: string;
};

const profileResource = createResourceDescriptor({
	namespace: "profile",
	resource: "user",
	operations: {
		queries: {
			detail: createServerFnQueryOperation<Scope, void, Scope, Profile>({
				serverFn: getProfileServerFn,
				buildData: (scope) => scope,
				staleTime: 1000 * 60
			})
		}
	}
});

export function useProfileQuery(scope: Scope) {
	return useResourceQuery(profileResource, "detail", scope, undefined);
}
```

### Mutation operation

```ts
import { createServerFnMutationOperation } from "@/shared/api/server-fn";

type SaveProfileInput = {
	readonly name: string;
};

type SaveProfileData = Scope & SaveProfileInput;

const saveProfileOperation = createServerFnMutationOperation<Scope, SaveProfileInput, SaveProfileData, Profile, typeof profileResource>({
	serverFn: saveProfileServerFn,
	buildData: (scope, input) => ({
		...scope,
		name: input.name
	})
});
```

### `transform`

Если serverFn возвращает DTO, а resource должен отдавать доменную модель, использовать `transform`:

```ts
createServerFnQueryOperation<Scope, void, Scope, RawProfile, Profile>({
	serverFn: getProfileServerFn,
	buildData: (scope) => scope,
	transform: (raw) => ({
		id: raw.ID,
		name: raw.NAME
	})
});
```

### `executor`

`executor` нужен редко:

- тесты;
- tracing;
- retry wrapper;
- дополнительная интеграционная обвязка конкретного проекта.

```ts
createServerFnQueryOperation({
	serverFn,
	buildData,
	executor: async (currentServerFn, request, context) => {
		console.debug("serverFn", context.client);
		return await currentServerFn(request);
	}
});
```

## `shared/api/persisted`

`persisted` — специализированный фасад для ресурсов сохранённых записей.

Использовать, если ресурс действительно описывается capability:

```ts
list
latest
history
save
create
delete
```

Если нужны операции вроде `publish`, `archive`, `clone`, `recalculate`, `preview`, `restore`, лучше использовать `shared/api/resource`.

### Что делает `persisted`

- создаёт стандартные query keys;
- нормализует scope через `resource` key normalization;
- предоставляет hooks под фиксированные capability;
- содержит JSON payload helpers;
- содержит OData и REST operation adapters;
- применяет cache strategies после mutation.

### Descriptor

```ts
import { createPersistedResourceDescriptor, usePersistedLatestQuery, usePersistedSaveMutation } from "@/shared/api/persisted";

type ViewConfigScope = {
	readonly appId: string;
	readonly viewId: string;
};

const viewConfigResource = createPersistedResourceDescriptor({
	namespace: "viewConfig",
	resource: "view",
	normalizeScope: (scope: ViewConfigScope | null | undefined) => ({
		appId: scope?.appId.trim() ?? "",
		viewId: scope?.viewId.trim() ?? ""
	}),
	isEnabled: (scope) => Boolean(scope?.appId && scope?.viewId),
	getScopeError: () => "Не задан scope конфигурации.",
	transport: {
		latest: latestOperation,
		save: saveOperation
	}
});

export function useViewConfigLatestQuery(scope: ViewConfigScope) {
	return usePersistedLatestQuery(viewConfigResource, scope);
}

export function useSaveViewConfigMutation(scope: ViewConfigScope) {
	return usePersistedSaveMutation(viewConfigResource, scope);
}
```

### OData persisted operation

```ts
import {
	createInvalidatePersistedScopeCacheStrategy,
	createPersistedODataMutationOperation,
	createPersistedODataQueryOperation,
	parsePersistedJson,
	stringifyPersistedJson
} from "@/shared/api/persisted";
import { createFilterEqual } from "@ryuzaki13/react-foundation-lib/odata-service";

type ViewConfigRaw = {
	readonly APP_ID: string;
	readonly VIEW_ID: string;
	readonly PAYLOAD: string | null;
};

type ViewConfigPayload = {
	readonly columns: readonly string[];
};

const latestOperation = createPersistedODataQueryOperation<ViewConfigScope, void, readonly ViewConfigRaw[], ViewConfigPayload | null>({
	odata: {
		service: "TEXT_CONFIG_SRV",
		target: "TextConfigLatestSet"
	},
	buildOptions: (scope) => ({
		expression: {
			filters: [createFilterEqual("APP_ID", scope.appId), createFilterEqual("VIEW_ID", scope.viewId)]
		}
	}),
	transform: (rows) => parsePersistedJson<ViewConfigPayload>(rows[0]?.PAYLOAD)
});

const saveOperation = createPersistedODataMutationOperation<ViewConfigScope, { readonly payload: ViewConfigPayload }, unknown, unknown>({
	odata: {
		service: "TEXT_CONFIG_SRV",
		target: "TextConfigSet"
	},
	method: "create",
	bodyMapper: (scope, input) => ({
		APP_ID: scope.appId,
		VIEW_ID: scope.viewId,
		PAYLOAD: stringifyPersistedJson(input.payload)
	}),
	cacheStrategy: createInvalidatePersistedScopeCacheStrategy()
});
```

### REST persisted operation

REST operation использует `shared/api/http`, поэтому без `executor` нужно обязательно передать `parseResponse`.

```ts
import { createPersistedRestQueryOperation, createPersistedRestMutationOperation } from "@/shared/api/persisted";

type Preset = {
	readonly id: string;
	readonly title: string;
};

function parsePresetList(payload: unknown): readonly Preset[] {
	if (!Array.isArray(payload)) {
		throw new Error("Некорректный список preset.");
	}

	return payload.map((item) => {
		if (typeof item !== "object" || item === null || !("id" in item) || !("title" in item)) {
			throw new Error("Некорректный preset.");
		}

		if (typeof item.id !== "string" || typeof item.title !== "string") {
			throw new Error("Некорректный preset.");
		}

		return {
			id: item.id,
			title: item.title
		};
	});
}

const listOperation = createPersistedRestQueryOperation<ViewConfigScope, void, readonly Preset[]>({
	baseUrl: "",
	buildUrl: (scope) => `/api/views/${scope.appId}/${scope.viewId}/presets`,
	parseResponse: parsePresetList
});
```

Если используется `executor`, он сам отвечает за тип результата:

```ts
const listOperation = createPersistedRestQueryOperation<ViewConfigScope, void, readonly Preset[]>({
	buildUrl: (scope) => `/api/views/${scope.appId}/${scope.viewId}/presets`,
	executor: async (request) => {
		const payload = await customHttpClient(request.url, request.init);
		return parsePresetList(payload);
	}
});
```

### serverFn внутри persisted descriptor

serverFn operation берётся из `shared/api/server-fn`, а descriptor остаётся `persisted`.

```ts
import { createPersistedResourceDescriptor, usePersistedLatestQuery } from "@/shared/api/persisted";
import { createServerFnQueryOperation } from "@/shared/api/server-fn";

const viewConfigResource = createPersistedResourceDescriptor({
	namespace: "viewConfig",
	resource: "view",
	transport: {
		latest: createServerFnQueryOperation<ViewConfigScope, void, ViewConfigScope, ViewConfigPayload | null>({
			serverFn: getViewConfigServerFn,
			buildData: (scope) => scope
		})
	}
});

export function useLatest(scope: ViewConfigScope) {
	return usePersistedLatestQuery(viewConfigResource, scope);
}
```

## Что не делать

### Не использовать OData transport как generic fetch

```ts
// Плохо: обычный REST endpoint идёт через OData/SAP transport.
fetchJson<Profile>("/api/profile", undefined, "");
```

Лучше:

```ts
httpJsonQueryFn("/api/profile", {
	parse: parseProfile
});
```

### Не расширять `persisted` новыми произвольными capability

```ts
// Плохо: persisted начинает превращаться в универсальный resource.
transport: {
	publish: ...
}
```

Лучше использовать `resource`:

```ts
operations: {
	mutations: {
		publish: createResourceMutationOperation(...)
	}
}
```

### Не импортировать TanStack Start в shared

```ts
// Плохо: shared начнёт зависеть от SSR runtime.
import { createServerFn } from "@tanstack/react-start";
```

В shared передаётся уже созданная serverFn через `ServerFnTransport`.

### Не приводить внешний payload без parser-а

```ts
// Плохо: внешний контракт не проверяется.
const payload = await httpFetchPayload("/api/profile");
return payload as Profile;
```

Лучше:

```ts
const payload = await httpFetchPayload("/api/profile");
return parseProfile(payload);
```

## Ответ на частый вопрос: почему `odata/transport` не использует `http`

Это сделано намеренно в текущей версии слоя.

`shared/api/http` — минимальный HTTP transport для обычных endpoint-ов. Он умеет получить `Response` или payload, но не знает ничего про SAP/OData.

`shared/api/odata/transport` — stateful transport для SAP Gateway. Он дополнительно отвечает за:

- выбор OData base URL;
- SAP client;
- X-CSRF token cache;
- повторное получение CSRF token;
- обнаружение HTML/SAML2 формы вместо JSON;
- восстановление SSO-сессии;
- `SsoRequiredError`;
- OData envelope `{ d, results, __count }`;
- report unexpected HTML response;
- поддержку `x-sw-cache` в OData-запросах.

Если заставить OData transport использовать текущий `httpFetchPayload`, он потеряет доступ к части lifecycle на уровне `Response` и ошибочно смешает generic HTTP error policy с SAP/OData policy.

Теоретически можно выделить ещё более низкий primitive, например `httpFetchRaw`, который только вызывает `fetch` и не парсит payload. Но это отдельный рефакторинг. Пока разделение намеренное: `http` для neutral HTTP, `odata/transport` для SAP/OData.
