# persisted

Внутренний infrastructural-модуль для переиспользуемой работы с сохранёнными записями: `variant`, `view-config`, `preset` и похожими сущностями.

## Зачем нужен модуль

До выноса общей логики разные доменные API независимо решали один и тот же набор задач:

- строили `queryKey`;
- нормализовали `scope`;
- разбирали JSON payload;
- подключали `useQuery` и `useMutation`;
- инвалидировали кэш после сохранения;
- оборачивали транспортные детали OData, REST или TanStack Start serverFn.

`persisted` собирает этот повтор в один слой, но не пытается унифицировать доменную бизнес-логику.

Модуль специально не знает, что такое variant, view-config или preset. Он знает только:

- у ресурса есть `scope`;
- ресурс может поддерживать часть стандартных операций;
- операции могут быть реализованы через разный transport;
- после мутаций нужно применить переиспользуемую cache policy.

## Главная идея

Архитектура строится вокруг descriptor ресурса.

Descriptor описывает:

- идентичность ресурса в кэше;
- политику нормализации `scope`;
- проверку, что `scope` вообще пригоден для выполнения операции;
- набор capability: `list`, `latest`, `history`, `save`, `create`, `delete`;
- transport-specific реализацию каждой capability.

Из descriptor затем строятся:

- `usePersistedListQuery`
- `usePersistedLatestQuery`
- `usePersistedHistoryQuery`
- `usePersistedSaveMutation`
- `usePersistedCreateMutation`
- `usePersistedDeleteMutation`
- `getPersistedListData`
- `getPersistedLatestData`
- `getPersistedHistoryData`

## Слои модуля

### `payload.ts`

Содержит безопасный JSON codec:

- `parsePersistedJson<T>`
- `stringifyPersistedJson<T>`
- `createPersistedJsonCodec<T>`

Это deliberate-ограничение: parser принимает только строку или `null/undefined`, чтобы нельзя было случайно передать туда весь record.

### `keys.ts`

Содержит фабрику `createPersistedRecordKeys`.

Она строит ключи по схеме:

`namespace -> resource -> normalizedScope -> operation -> optionalArgs`

Нормализация нужна, чтобы:

- trim-ить строки;
- стабилизировать объекты через сортировку ключей;
- не плодить разные ключи для эквивалентных scope.

### `cache.ts`

Содержит стандартные cache strategy:

- `createInvalidatePersistedScopeCacheStrategy`
- `createSetPersistedQueryDataCacheStrategy`
- `composePersistedCacheStrategies`

### `odata.ts`

Содержит адаптеры для OData:

- `createPersistedODataQueryOperation`
- `createPersistedODataMutationOperation`

### `rest.ts`

Содержит адаптеры для обычного REST:

- `createPersistedRestQueryOperation`
- `createPersistedRestMutationOperation`

### `resource.ts`

Главный orchestration-слой.

Тут живут:

- `createPersistedResourceDescriptor`
- query hooks
- mutation hooks
- imperative preload helpers

Именно этот слой связывает:

- descriptor;
- transport capability;
- react-query;
- проверку scope;
- cache strategy.

### `../server-fn`

Соседний слой `shared/api/server-fn` содержит переносимые адаптеры для
TanStack Start server functions:

- `createServerFnQueryOperation`
- `createServerFnMutationOperation`

Адаптер не импортирует `@tanstack/react-start`. Он знает только публичную
форму вызова serverFn: `{ data } -> Promise<response>`. Благодаря этому общий
shared-слой можно синхронизировать между SAP/OData SPA и SSR-проектом, а
конкретный проект выбирает transport на уровне descriptor-а ресурса.

## Capability model

Модуль принципиально не требует полный CRUD.

Ресурс может поддерживать только нужные операции.

Примеры:

- `viewConfig` использует `latest`, `history`, `save`
- `targetNodePreset` использует `list`, `save`
- `variantApi` использует `list`, `save`, `create`, `delete`

Если попытаться вызвать хук для capability, которой у descriptor нет, общий слой даст раннюю ошибку.

## Что оставляем вне общего слоя

В `persisted` нельзя складывать доменную бизнес-логику.

Снаружи должны оставаться:

- выбор default variant;
- нормализация конкретного snapshot;
- пользовательские уведомления;
- специфичные мутации, например `setDefault`;
- валидация бизнес-правил;
- подготовка payload, зависящая от доменной модели.

Хорошее правило:

Если код можно описать как «это одинаково для любого ресурса, который хранит записи», его место здесь.

Если код можно описать как «это знание именно про variant/view-config/preset», его место в доменном модуле.

## Быстрый рецепт подключения нового ресурса

1. Определить `scope`.
2. Определить, какие capability реально нужны.
3. Подобрать transport adapter: OData/REST из `shared/api/persisted` или serverFn из `shared/api/server-fn`.
4. Создать descriptor через `createPersistedResourceDescriptor`.
5. Экспортировать доменные хуки-обёртки поверх generic-хуков.
6. Оставить domain-specific transform, notify и validation вне shared-слоя.

## Пример 1. OData ресурс с `latest` и `save`

Ниже упрощённый пример в стиле `viewConfig`.

```ts
import type { QueryClient } from "@tanstack/react-query";

import { BaseURLType } from "@/shared/api";
import {
  createInvalidatePersistedScopeCacheStrategy,
  createPersistedODataMutationOperation,
  createPersistedODataQueryOperation,
  createPersistedResourceDescriptor,
  getPersistedLatestData,
  parsePersistedJson,
  stringifyPersistedJson,
  usePersistedLatestQuery,
  usePersistedSaveMutation
} from "@/shared/api/persisted";
import { createFilterEqual } from "@ryuzaki13/react-foundation-lib/odata-service";

type ViewConfigScope = {
  appId: string;
  viewId: string;
};

type ViewConfigPayload = {
  title: string;
  columns: string[];
};

type ViewConfigRaw = {
  id: string;
  appId: string;
  viewId: string;
  payload: string;
};

type SaveViewConfigInput = {
  payload: ViewConfigPayload;
  transportRequest: string;
};

const SERVICE = "TEXT_CONFIG_SRV";
const ENTITY = "CONFIG";
const ENTITY_LATEST = "TEXT_CONFIG_LATEST";
const SERVICE_BASE_URL: BaseURLType | undefined = __DEV__ ? "odataDp0" : undefined;

const viewConfigResource = createPersistedResourceDescriptor({
  namespace: "viewConfig",
  resource: "view",
  normalizeScope: (scope: ViewConfigScope | null | undefined) => ({
    appId: scope?.appId?.trim() ?? "",
    viewId: scope?.viewId?.trim() ?? ""
  }),
  isEnabled: (scope) => Boolean(scope?.appId && scope?.viewId),
  getScopeError: () => "Не удалось выполнить операцию с конфигурацией: scope appId/viewId не задан.",
  transport: {
    latest: createPersistedODataQueryOperation<ViewConfigScope, void, ViewConfigRaw[], ViewConfigPayload | null>({
      odata: { service: SERVICE, target: ENTITY_LATEST },
      baseUrl: SERVICE_BASE_URL,
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60 * 24,
      buildOptions: (scope) => ({
        expression: {
          and: true,
          filters: [
            createFilterEqual("appId", scope.appId),
            createFilterEqual("viewId", scope.viewId)
          ]
        }
      }),
      transform: (rows) => parsePersistedJson<ViewConfigPayload>(rows[0]?.payload)
    }),
    save: createPersistedODataMutationOperation<ViewConfigScope, SaveViewConfigInput, unknown, unknown>({
      odata: { service: SERVICE, target: ENTITY },
      baseUrl: SERVICE_BASE_URL,
      method: "POST",
      bodyMapper: (scope, input) => ({
        id: "",
        appId: scope.appId,
        viewId: scope.viewId,
        payload: stringifyPersistedJson(input.payload),
        transportRequest: input.transportRequest
      }),
      cacheStrategy: createInvalidatePersistedScopeCacheStrategy()
    })
  }
});

export function useViewConfigLatestQuery(scope: ViewConfigScope) {
  return usePersistedLatestQuery<ViewConfigScope, ViewConfigPayload | null>(viewConfigResource, scope);
}

export function useSaveViewConfigMutation(scope: ViewConfigScope) {
  return usePersistedSaveMutation<ViewConfigScope, SaveViewConfigInput, unknown>(viewConfigResource, scope);
}

export async function getViewConfigLatestData(scope: ViewConfigScope, queryClient: QueryClient) {
  return await getPersistedLatestData<ViewConfigScope, ViewConfigPayload | null>(viewConfigResource, scope, queryClient);
}
```

### Что здесь важно

- descriptor ничего не знает про UI;
- payload-parsing остаётся доменным;
- `latest` возвращает уже доменную модель, а не transport envelope;
- cache strategy задаётся один раз на уровне ресурса.

## Пример 2. SSR ресурс поверх TanStack Start serverFn

Ниже упрощённый вариант для проекта с TanStack Start: descriptor остаётся тем же
generic-слоем, но transport подключается через serverFn вместо OData.

```ts
import type { QueryClient } from "@tanstack/react-query";

import {
  createInvalidatePersistedScopeCacheStrategy,
  createPersistedResourceDescriptor,
  getPersistedLatestData,
  usePersistedLatestQuery,
  usePersistedSaveMutation
} from "@/shared/api/persisted";
import {
  createServerFnMutationOperation,
  createServerFnQueryOperation
} from "@/shared/api/server-fn";
import { getViewConfigServerFn, saveViewConfigServerFn } from "@/server/serverFns";

type ViewConfigScope = {
  appId: string;
  viewId: string;
};

type ViewConfigPayload = {
  title: string;
  columns: string[];
};

type SaveViewConfigInput = {
  payload: ViewConfigPayload;
};

const viewConfigResource = createPersistedResourceDescriptor({
  namespace: "viewConfig",
  resource: "view",
  normalizeScope: (scope: ViewConfigScope | null | undefined) => ({
    appId: scope?.appId?.trim() ?? "",
    viewId: scope?.viewId?.trim() ?? ""
  }),
  isEnabled: (scope) => Boolean(scope?.appId && scope?.viewId),
  getScopeError: () => "Не удалось выполнить операцию с конфигурацией: scope appId/viewId не задан.",
  transport: {
    latest: createServerFnQueryOperation({
      serverFn: getViewConfigServerFn,
      buildData: (scope) => scope
    }),
    save: createServerFnMutationOperation({
      serverFn: saveViewConfigServerFn,
      buildData: (scope, input) => ({
        ...scope,
        payload: input.payload
      }),
      cacheStrategy: createInvalidatePersistedScopeCacheStrategy()
    })
  }
});

export function useViewConfigLatestQuery(scope: ViewConfigScope) {
  return usePersistedLatestQuery<ViewConfigScope, ViewConfigPayload | null>(viewConfigResource, scope);
}

export function useSaveViewConfigMutation(scope: ViewConfigScope) {
  return usePersistedSaveMutation<ViewConfigScope, SaveViewConfigInput, void>(viewConfigResource, scope);
}

export async function getViewConfigLatestData(scope: ViewConfigScope, queryClient: QueryClient) {
  return await getPersistedLatestData<ViewConfigScope, ViewConfigPayload | null>(viewConfigResource, scope, queryClient);
}
```

### Что здесь важно

- shared API не импортирует `@tanstack/react-start`;
- `{ data }` собирается в `buildData`, а не размазывается по UI/hooks;
- cache strategy остаётся общей для OData и SSR transport.

## Пример 3. REST ресурс с `list` и `save`

Ниже упрощённый пример в стиле `targetNodePreset`.

```ts
import {
  createInvalidatePersistedScopeCacheStrategy,
  createPersistedResourceDescriptor,
  createPersistedRestMutationOperation,
  createPersistedRestQueryOperation,
  parsePersistedJson,
  usePersistedListQuery,
  usePersistedSaveMutation
} from "@/shared/api/persisted";

type ConfigPresetScope = {
  userId: string;
};

type TargetNodePayload = {
  name: string;
  description: string;
  type: string;
  config: unknown;
};

type ConfigPresetRecord = {
  recId: string;
  cfgType: string;
  userId: string;
  payload: string;
  crtUtc: string;
};

type ConfigPresetsResponse = {
  data: ConfigPresetRecord[] | null;
  meta: {
    limit: number;
    offset: number;
  };
};

type TargetNodePreset = {
  recId: string;
  cfgType: "target_node_preset";
  userId: string;
  payload: TargetNodePayload;
  crtUtc: string;
};

type TargetNodePresetInput = {
  payload: TargetNodePayload;
};

const BASE = "/api/config-presets";
const CFG_TYPE = "target_node_preset" as const;

const targetNodePresetResource = createPersistedResourceDescriptor({
  namespace: "view-config",
  resource: CFG_TYPE,
  normalizeScope: (scope: ConfigPresetScope | null | undefined) => ({
    userId: scope?.userId?.trim() ?? ""
  }),
  isEnabled: (scope) => Boolean(scope?.userId?.trim()),
  getScopeError: () => "Не удалось выполнить операцию с пресетом узла: userId не задан.",
  transport: {
    list: createPersistedRestQueryOperation<
      ConfigPresetScope,
      void,
      ConfigPresetsResponse,
      TargetNodePreset[]
    >({
      buildUrl: (scope) => `${BASE}/list?cfgType=${CFG_TYPE}&userId=${scope.userId}`,
      transform: (response) =>
        (response.data ?? []).flatMap((record) => {
          const payload = parsePersistedJson<TargetNodePayload>(record.payload);
          return payload
            ? [{
                ...record,
                cfgType: CFG_TYPE,
                payload
              }]
            : [];
        })
    }),
    save: createPersistedRestMutationOperation<
      ConfigPresetScope,
      TargetNodePresetInput,
      { data: ConfigPresetRecord | null },
      ConfigPresetRecord | null
    >({
      buildUrl: () => BASE,
      method: "PUT",
      bodyMapper: (scope, input) => ({
        cfgType: CFG_TYPE,
        userId: scope.userId,
        payload: input.payload
      }),
      transform: (response) => response.data,
      cacheStrategy: createInvalidatePersistedScopeCacheStrategy()
    })
  }
});

export function useTargetNodePresetsQuery(scope: ConfigPresetScope | null | undefined) {
  return usePersistedListQuery<ConfigPresetScope, TargetNodePreset[]>(targetNodePresetResource, scope);
}

export function useTargetNodePresetMutation(scope: ConfigPresetScope | null | undefined) {
  return usePersistedSaveMutation<ConfigPresetScope, TargetNodePresetInput, ConfigPresetRecord | null>(
    targetNodePresetResource,
    scope
  );
}
```

### Что здесь важно

- один и тот же orchestration-слой работает и для REST, и для OData;
- `scope.userId` участвует и в query key, и в `enabled`, и в request body;
- invalidation остаётся общей политикой, а не копипастой по модулям.

## Когда использовать `invalidate`, а когда `setQueryData`

### Выбирать `createInvalidatePersistedScopeCacheStrategy`, если:

- мутация влияет на несколько query одного scope;
- backend не возвращает достаточно данных для точного обновления;
- важнее надёжность, чем микрооптимизация.

### Выбирать `createSetPersistedQueryDataCacheStrategy`, если:

- нужно быстро обновить один конкретный query;
- мутация возвращает уже готовую доменную модель;
- есть уверенность, что не появится рассинхронизация с другими query.

### Выбирать `composePersistedCacheStrategies`, если:

- нужно совместить адресное обновление и более широкую инвалидацию;
- ресурс одновременно обновляет `latest` и `history`.

## Scope policy

Для каждого ресурса важно отдельно определить:

- как нормализуется scope;
- когда scope считается валидным;
- какое сообщение вернуть при невалидном scope.

Рекомендуемый подход:

```ts
normalizeScope: (scope) => ({
  appId: scope?.appId?.trim() ?? "",
  viewId: scope?.viewId?.trim() ?? ""
}),
isEnabled: (scope) => Boolean(scope?.appId && scope?.viewId),
getScopeError: () => "Не удалось выполнить операцию: scope appId/viewId не задан."
```

Это даёт сразу три выигрыша:

- одинаковые query key для эквивалентных scope;
- отсутствие сетевых запросов при неполном scope;
- понятную ошибку, если мутация всё же была вызвана.

## Рекомендации по проектированию

### Делайте `transform` доменным

Хорошо:

- `transform: (rows) => parsePersistedJson<ViewConfigPayload>(rows[0]?.payload)`
- `transform: (rows) => rows.map(mapVariantRecord)`

Плохо:

- переносить в shared-слой знание о `variantId`, `isDefault`, `cfgType`, `transportRequest`

### Не выносите отдельные бизнес-операции в общий CRUD

Например:

- `setDefaultVariant`
- `publishVariant`
- `duplicatePreset`

Если операция не является обычным `save/create/delete`, лучше оставить её доменной мутацией, но при желании переиспользовать `descriptor.keys.scope(...)` и общие cache strategy.

### Не заставляйте ресурс поддерживать лишние capability

Если backend умеет только `latest` и `save`, так и описывайте.

Capability-based модель нужна именно для того, чтобы не строить фальшивый универсальный CRUD.

## Тестирование

Модуль рассчитан на два уровня тестов:

### 1. Тесты shared-слоя

Проверяют:

- codec;
- key generation;
- transport adapters;
- cache strategies.

### 2. Тесты доменного подключения

Проверяют:

- корректный raw -> domain mapping;
- защиту от битого payload;
- специфичные scope policy;
- контракт возвращаемых данных доменного API.

Именно такое разделение сейчас используется в репозитории.

## Ограничения модуля

- модуль не заменяет domain layer;
- модуль не решает transport-specific business rules backend;
- модуль не хранит схемы payload и не валидирует их содержимое;
- модуль не синтезирует сложные optimistic update сам по себе.

Если ресурсу нужна сложная бизнес-валидация или нестандартная синхронизация, это должно остаться в доменном коде поверх shared-слоя.

## Чек-лист для нового ресурса

- Есть ли у ресурса стабильный `scope`?
- Нужно ли нормализовать строки и идентификаторы?
- Какие capability действительно нужны?
- Подходит OData adapter или пока нужен REST adapter?
- Можно ли после мутации ограничиться `invalidate(scope)`?
- Возвращает ли query уже доменную модель без transport envelope?
- Вынесена ли доменная бизнес-логика за пределы `persisted`?

Если на все вопросы есть понятный ответ, ресурс почти наверняка хорошо ложится на этот модуль.
