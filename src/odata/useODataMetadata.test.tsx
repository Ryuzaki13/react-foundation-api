import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useODataMetadata } from "./useODataMetadata";
import { useODataMetadataQuery } from "./useODataMetadataQuery";

import type { ServiceMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";

vi.mock("./useODataMetadataQuery", () => ({
	useODataMetadataQuery: vi.fn()
}));

const mockedUseODataMetadataQuery = vi.mocked(useODataMetadataQuery);

function createServiceMetadata(): ServiceMetadata {
	return {
		entities: {
			TextEntitySet: {
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
					}
				]
			}
		},
		functionImports: {}
	};
}

function createFunctionImportMetadata(): ServiceMetadata {
	return {
		entities: {},
		functionImports: {
			setTextVariantDefault: {
				name: "setTextVariantDefault",
				title: "Set default variant",
				returnType: "Edm.String"
			}
		}
	};
}

describe("useODataMetadata", () => {
	it("возвращает metadata выбранного target и isLoading", () => {
		mockedUseODataMetadataQuery.mockReturnValue({
			data: createServiceMetadata(),
			isLoading: false
		} as ReturnType<typeof useODataMetadataQuery>);

		function Probe() {
			const result = useODataMetadata({ service: "TEXT_DEMO_SRV", target: "TextEntitySet" });

			return (
				<div data-loading={String(result.isLoading)} data-title={result.metadata?.title ?? "none"}>
					{result.metadata?.columns.length ?? 0}
				</div>
			);
		}

		const html = renderToStaticMarkup(<Probe />);

		expect(html).toContain('data-loading="false"');
		expect(html).toContain('data-title="Демо"');
		expect(html).toContain(">1<");
	});

	it("бросает явную ошибку, если target указывает на FunctionImport", () => {
		mockedUseODataMetadataQuery.mockReturnValue({
			data: createFunctionImportMetadata(),
			isLoading: false
		} as ReturnType<typeof useODataMetadataQuery>);

		function Probe() {
			useODataMetadata({ service: "TEXT_DEMO_SRV", target: "setTextVariantDefault" });
			return <div>unreachable</div>;
		}

		expect(() => renderToStaticMarkup(<Probe />)).toThrow(
			"OData target 'setTextVariantDefault' является FunctionImport и не может использоваться как сущность"
		);
	});

	it("сохраняет доступ к закешированным metadata при ошибке фонового обновления", () => {
		mockedUseODataMetadataQuery.mockReturnValue({
			data: createServiceMetadata(),
			dataUpdatedAt: 123,
			isLoading: false,
			isError: true,
			isLoadingError: false,
			isRefetchError: true
		} as ReturnType<typeof useODataMetadataQuery>);

		function Probe() {
			const result = useODataMetadata({ service: "ZDEMO_SRV", target: "DemoSet" });
			return <div data-updated-at={result.metadataUpdatedAt}>{result.metadata?.title}</div>;
		}

		const html = renderToStaticMarkup(<Probe />);

		expect(html).toContain('data-updated-at="123"');
		expect(html).toContain("Демо");
	});

	it("бросает ошибку, если metadata не удалось загрузить изначально", () => {
		mockedUseODataMetadataQuery.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			isLoadingError: true,
			isRefetchError: false
		} as ReturnType<typeof useODataMetadataQuery>);

		function Probe() {
			useODataMetadata({ service: "ZDEMO_SRV", target: "DemoSet" });
			return <div>unreachable</div>;
		}

		expect(() => renderToStaticMarkup(<Probe />)).toThrow("Ошибка загрузки метаданных сервиса ZDEMO_SRV");
	});
});
