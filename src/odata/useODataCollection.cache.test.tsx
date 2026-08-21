// @vitest-environment jsdom

import { act } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createODataCollectionBaseQueryKey, createODataCollectionQueryKey } from "./createODataCollectionQueryKey";
import { fetchCollectionData } from "./fetchCollectionData";
import { type ODataCollectionModel } from "./types";
import { useODataCollection } from "./useODataCollection";
import { type ODataCollectionResult } from "./useODataCollectionQuery";
import { useODataCollectionUpdatesQuery } from "./useODataCollectionUpdatesQuery";
import { useODataMetadata } from "./useODataMetadata";

import type { CollectionItem, EntityMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";

vi.mock("./fetchCollectionData", () => ({
	fetchCollectionData: vi.fn()
}));

vi.mock("./useODataCollectionUpdatesQuery", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./useODataCollectionUpdatesQuery")>();

	return {
		...actual,
		useODataCollectionUpdatesQuery: vi.fn()
	};
});

vi.mock("./useODataMetadata", () => ({
	useODataMetadata: vi.fn()
}));

const mockedFetchCollectionData = vi.mocked(fetchCollectionData);
const mockedUseODataCollectionUpdatesQuery = vi.mocked(useODataCollectionUpdatesQuery);
const mockedUseODataMetadata = vi.mocked(useODataMetadata);

const ODATA = {
	service: "TEXT_DEMO_SRV",
	target: "TextEntitySet"
} as const;

const TEXT_SORTED_ODATA = {
	...ODATA,
	sortByCode: false
} as const;

const MODEL = {
	codeKey: "CODE",
	maxVisibleItems: 20,
	minSearchCodeLength: 1,
	minSearchTextLength: 1,
	searchDebounceDelay: 0
} satisfies Required<ODataCollectionModel>;

const SOURCE_ITEMS = [
	{ CODE: "02", TEXT: "А" },
	{ CODE: "01", TEXT: "Я" }
] satisfies CollectionItem[];

const ENTITY_METADATA = {
	title: "Тестовый справочник",
	columns: [
		{
			id: "CODE",
			type: "string",
			originalType: "Edm.String",
			label: "Код",
			semanticType: "code",
			linkedColumnId: "TEXT",
			sortable: true,
			filterable: true,
			role: "dimension"
		},
		{
			id: "TEXT",
			type: "string",
			originalType: "Edm.String",
			label: "Наименование",
			semanticType: "text",
			sortable: true,
			filterable: true,
			role: "dimension"
		}
	]
} satisfies EntityMetadata;

let container: HTMLDivElement | null;
let root: Root | null;
let queryClient: QueryClient;

function CollectionSortingProbe({ textFirst }: { textFirst: boolean }) {
	const first = useODataCollection({
		odata: textFirst ? TEXT_SORTED_ODATA : ODATA,
		model: MODEL
	});
	const second = useODataCollection({
		odata: textFirst ? ODATA : TEXT_SORTED_ODATA,
		model: MODEL
	});
	const codeCollection = textFirst ? second : first;
	const textCollection = textFirst ? first : second;

	return (
		<div
			data-code-order={codeCollection.separatedItems.map((item) => item.CODE).join(",")}
			data-text-order={textCollection.separatedItems.map((item) => item.CODE).join(",")}
		/>
	);
}

function SwitchingSortingProbe({ sortByCode }: { sortByCode: boolean }) {
	const collection = useODataCollection({
		odata: sortByCode ? ODATA : TEXT_SORTED_ODATA,
		model: MODEL
	});

	return <div data-order={collection.separatedItems.map((item) => item.CODE).join(",")} />;
}

async function renderSortingProbe(textFirst: boolean) {
	await act(async () => {
		root?.render(
			<QueryClientProvider client={queryClient}>
				<CollectionSortingProbe textFirst={textFirst} />
			</QueryClientProvider>
		);
	});

	await act(async () => {
		await vi.waitFor(() => {
			const probe = container?.querySelector("div");
			expect(probe?.getAttribute("data-code-order")).toBe("01,02");
			expect(probe?.getAttribute("data-text-order")).toBe("02,01");
		});
	});
}

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false
			}
		}
	});

	mockedFetchCollectionData.mockReset();
	mockedUseODataCollectionUpdatesQuery.mockReset();
	mockedUseODataMetadata.mockReset();

	mockedFetchCollectionData.mockResolvedValue({ items: SOURCE_ITEMS });
	mockedUseODataMetadata.mockReturnValue({
		metadata: ENTITY_METADATA,
		metadataUpdatedAt: 1,
		isLoading: false
	});
	mockedUseODataCollectionUpdatesQuery.mockReturnValue({
		data: {
			items: [],
			byEntityName: {},
			fetchedAt: 1,
			coverageStartedAt: 1
		},
		isError: false,
		isSuccess: true,
		isFetching: false
	} as unknown as ReturnType<typeof useODataCollectionUpdatesQuery>);
});

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	queryClient.clear();
	container?.remove();
	container = null;
	root = null;
	delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("useODataCollection cache sorting", () => {
	it.each([
		{ name: "сначала код", textFirst: false },
		{ name: "сначала текст", textFirst: true }
	])("сохраняет один snapshot и независимо сортирует consumers: $name", async ({ textFirst }) => {
		await renderSortingProbe(textFirst);

		expect(mockedFetchCollectionData).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryCache().findAll({ queryKey: createODataCollectionBaseQueryKey() })).toHaveLength(1);
		expect(createODataCollectionQueryKey(TEXT_SORTED_ODATA)).toEqual(createODataCollectionQueryKey(ODATA));
		expect(createODataCollectionQueryKey(ODATA)[2].version).toBe(2);

		const cached = queryClient.getQueryData<ODataCollectionResult<CollectionItem>>(createODataCollectionQueryKey(ODATA));
		expect(cached?.separated.CODE.map((item) => item.CODE)).toEqual(["01", "02"]);
	});

	it("переключает порядок одного consumer без повторной загрузки и изменения cache", async () => {
		await act(async () => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<SwitchingSortingProbe sortByCode />
				</QueryClientProvider>
			);
		});
		await act(async () => {
			await vi.waitFor(() => {
				expect(container?.querySelector("div")?.getAttribute("data-order")).toBe("01,02");
			});
		});

		await act(async () => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<SwitchingSortingProbe sortByCode={false} />
				</QueryClientProvider>
			);
		});
		await act(async () => {
			await vi.waitFor(() => {
				expect(container?.querySelector("div")?.getAttribute("data-order")).toBe("02,01");
			});
		});

		expect(mockedFetchCollectionData).toHaveBeenCalledTimes(1);
		const cached = queryClient.getQueryData<ODataCollectionResult<CollectionItem>>(createODataCollectionQueryKey(ODATA));
		expect(cached?.separated.CODE.map((item) => item.CODE)).toEqual(["01", "02"]);
	});
});
