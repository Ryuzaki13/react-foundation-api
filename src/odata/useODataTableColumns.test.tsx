import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useODataMetadata } from "./useODataMetadata";
import { useODataTableColumns } from "./useODataTableColumns";

import type { EntityMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";
import type { TableColumnDef } from "@ryuzaki13/react-foundation-lib/table";

vi.mock("./useODataMetadata", () => ({
	useODataMetadata: vi.fn()
}));

const mockedUseODataMetadata = vi.mocked(useODataMetadata);
const TEST_METADATA_UPDATED_AT = new Date(2026, 4, 13, 12, 0, 0).getTime();

type DemoRow = {
	AMOUNT: number;
	NAME: string;
};

/**
 * Создаёт metadata сущности для build/enrich сценариев.
 */
function createEntityMetadata(): EntityMetadata {
	return {
		title: "Демо",
		columns: [
			{
				id: "AMOUNT",
				type: "decimal",
				originalType: "Edm.Decimal",
				label: "Сумма",
				semanticType: "none",
				sortable: true,
				filterable: true,
				role: "measure"
			},
			{
				id: "NAME",
				type: "string",
				originalType: "Edm.String",
				label: "Наименование",
				semanticType: "none",
				sortable: true,
				filterable: true,
				role: "dimension"
			}
		]
	};
}

describe("useODataTableColumns", () => {
	it("в режиме build возвращает generated columns", () => {
		mockedUseODataMetadata.mockReturnValue({
			metadata: createEntityMetadata(),
			metadataUpdatedAt: TEST_METADATA_UPDATED_AT,
			isLoading: false
		});

		function Probe() {
			const result = useODataTableColumns<DemoRow>({
				service: "TEXT_DEMO_SRV",
				target: "TextEntitySet",
				mode: "build"
			});

			return (
				<div
					data-loading={String(result.isLoading)}
					data-title={result.metadata?.title ?? "none"}
					data-first-header={String(result.columns[0]?.header ?? "")}
					data-first-role={result.columns[0]?.meta?.formatting?.role ?? "none"}
					data-name-visible={String(result.defaultColumnVisibility?.NAME ?? false)}>
					{result.columns.length}
				</div>
			);
		}

		const html = renderToStaticMarkup(<Probe />);

		expect(html).toContain('data-loading="false"');
		expect(html).toContain('data-title="Демо"');
		expect(html).toContain('data-first-header="Сумма"');
		expect(html).toContain('data-first-role="measure"');
		expect(html).toContain('data-name-visible="true"');
		expect(html).toContain(">2<");
	});

	it("в режиме enrich возвращает обогащённые колонки", () => {
		mockedUseODataMetadata.mockReturnValue({
			metadata: createEntityMetadata(),
			metadataUpdatedAt: TEST_METADATA_UPDATED_AT,
			isLoading: false
		});

		const columns: TableColumnDef<DemoRow>[] = [
			{
				id: "AMOUNT",
				accessorKey: "AMOUNT",
				header: "Сумма"
			}
		];

		function Probe() {
			const result = useODataTableColumns<DemoRow>({
				service: "TEXT_DEMO_SRV",
				target: "TextEntitySet",
				mode: "enrich",
				columns
			});

			return (
				<div
					data-first-role={result.columns[0]?.meta?.formatting?.role ?? "none"}
					data-first-visible={String(result.defaultColumnVisibility?.AMOUNT ?? false)}>
					{result.columns[0]?.meta?.formatting?.type ?? "none"}
				</div>
			);
		}

		const html = renderToStaticMarkup(<Probe />);

		expect(html).toContain('data-first-role="measure"');
		expect(html).toContain('data-first-visible="true"');
		expect(html).toContain(">decimal<");
	});

	it("в режиме build применяет resolveVisible к стартовой карте видимости", () => {
		mockedUseODataMetadata.mockReturnValue({
			metadata: createEntityMetadata(),
			metadataUpdatedAt: TEST_METADATA_UPDATED_AT,
			isLoading: false
		});

		function Probe() {
			const result = useODataTableColumns<DemoRow>({
				service: "TEXT_DEMO_SRV",
				target: "TextEntitySet",
				mode: "build",
				resolveVisible: (column) => column.id === "NAME"
			});

			return (
				<div data-amount-visible={String(result.defaultColumnVisibility?.AMOUNT ?? true)}>
					{String(result.defaultColumnVisibility?.NAME ?? false)}
				</div>
			);
		}

		const html = renderToStaticMarkup(<Probe />);

		expect(html).toContain('data-amount-visible="false"');
		expect(html).toContain(">true<");
	});

	it("в режиме build применяет resolveFormatting и сохраняет auto role/type", () => {
		mockedUseODataMetadata.mockReturnValue({
			metadata: createEntityMetadata(),
			metadataUpdatedAt: TEST_METADATA_UPDATED_AT,
			isLoading: false
		});

		function Probe() {
			const result = useODataTableColumns<DemoRow>({
				service: "TEXT_DEMO_SRV",
				target: "TextEntitySet",
				mode: "build",
				resolveFormatting: (column) =>
					column.id === "AMOUNT"
						? {
								emptyWhenZero: true
							}
						: undefined
			});

			return (
				<div
					data-amount-empty-when-zero={String(result.columns[0]?.meta?.formatting?.emptyWhenZero ?? false)}
					data-amount-role={result.columns[0]?.meta?.formatting?.role ?? "none"}>
					{result.columns[1]?.meta?.formatting?.type ?? "none"}
				</div>
			);
		}

		const html = renderToStaticMarkup(<Probe />);

		expect(html).toContain('data-amount-empty-when-zero="true"');
		expect(html).toContain('data-amount-role="measure"');
		expect(html).toContain(">string<");
	});

	it("при отсутствии metadata не падает и возвращает пустой или неизменённый результат", () => {
		mockedUseODataMetadata.mockReturnValue({
			metadata: undefined,
			metadataUpdatedAt: 0,
			isLoading: true
		});

		const enrichColumns: TableColumnDef<DemoRow>[] = [
			{
				id: "NAME",
				accessorKey: "NAME",
				header: "Наименование"
			}
		];

		function BuildProbe() {
			const result = useODataTableColumns<DemoRow>({
				service: "TEXT_DEMO_SRV",
				target: "TextEntitySet",
				mode: "build"
			});

			return <div data-loading={String(result.isLoading)}>{String(result.defaultColumnVisibility === undefined)}</div>;
		}

		function EnrichProbe() {
			const result = useODataTableColumns<DemoRow>({
				service: "TEXT_DEMO_SRV",
				target: "TextEntitySet",
				mode: "enrich",
				columns: enrichColumns
			});

			return (
				<div data-loading={String(result.isLoading)} data-first-header={String(result.columns[0]?.header ?? "")}>
					{result.columns.length}
				</div>
			);
		}

		const buildHtml = renderToStaticMarkup(<BuildProbe />);
		const enrichHtml = renderToStaticMarkup(<EnrichProbe />);

		expect(buildHtml).toContain('data-loading="true"');
		expect(buildHtml).toContain(">true<");
		expect(enrichHtml).toContain('data-loading="true"');
		expect(enrichHtml).toContain('data-first-header="Наименование"');
		expect(enrichHtml).toContain(">1<");
	});
});
