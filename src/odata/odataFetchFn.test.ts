import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { odataFetchFn } from "./odataFetchFn";
import { getODataMetadataData } from "./useODataMetadataQuery";

import type { ServiceMetadata } from "@ryuzaki13/react-foundation-lib/odata-service";

const { fetchODataJson, resolveODataBaseUrl } = vi.hoisted(() => ({
	fetchODataJson: vi.fn(),
	resolveODataBaseUrl: vi.fn(() => "odata")
}));

vi.mock("./transport/fetch", () => ({
	fetchODataJson,
	isNoContentResponse: (value: unknown) => !!value && typeof value === "object" && "__noContent" in value,
	resolveODataBaseUrl
}));

vi.mock("./transport", () => ({
	BaseUrlMap: {
		odata: "/sap/opu/odata/sap",
		odataDP0: "/sap-dp0/opu/odata/sap",
		root: ""
	},
	fetchODataJson,
	isNoContentResponse: (value: unknown) => !!value && typeof value === "object" && "__noContent" in value,
	resolveODataBaseUrl
}));

vi.mock("./useODataMetadataQuery", () => ({
	getODataMetadataData: vi.fn()
}));

const mockedGetODataMetadataData = vi.mocked(getODataMetadataData);

function createEntityMetadata(): ServiceMetadata {
	return {
		entities: {
			TextEntity: {
				title: "Demo Entity",
				columns: [],
				parameters: [
					{
						id: "ID",
						label: "ID",
						type: "string",
						originalType: "Edm.String",
						mandatory: true
					}
				]
			}
		},
		functionImports: {}
	};
}

function createParameterizedEntityMetadata(): ServiceMetadata {
	return {
		entities: {
			TextEntity: {
				title: "Demo Entity",
				columns: [],
				parameters: [
					{
						id: "ID",
						label: "ID",
						type: "string",
						originalType: "Edm.String",
						mandatory: true
					}
				],
				result: "Set"
			}
		},
		functionImports: {}
	};
}

function createAutoParseEntityMetadata(): ServiceMetadata {
	return {
		entities: {
			TextEntity: {
				title: "Demo Entity",
				columns: [
					{
						id: "FLAG",
						label: "FLAG",
						type: "string",
						originalType: "Edm.String",
						maxLength: 1,
						abapBooleanLike: true,
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "dimension"
					},
					{
						id: "AMOUNT",
						label: "AMOUNT",
						type: "decimal",
						originalType: "Edm.Decimal",
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "measure"
					},
					{
						id: "AEDAT",
						label: "AEDAT",
						type: "datetime",
						originalType: "Edm.DateTime",
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "dimension"
					}
				]
			}
		},
		functionImports: {}
	};
}

function createFunctionImportMetadata(): ServiceMetadata {
	return {
		entities: {
			TEXT_VARIANT: {
				title: "Variant",
				columns: [
					{
						id: "isDefault",
						label: "isDefault",
						type: "string",
						originalType: "Edm.String",
						maxLength: 1,
						abapBooleanLike: true,
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "dimension"
					}
				]
			},
			TRANSPORT_REQUEST: {
				title: "Transport request",
				columns: [
					{
						id: "id",
						label: "id",
						type: "string",
						originalType: "Edm.String",
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "dimension"
					},
					{
						id: "type",
						label: "type",
						type: "string",
						originalType: "Edm.String",
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "dimension"
					},
					{
						id: "text",
						label: "text",
						type: "string",
						originalType: "Edm.String",
						semanticType: "none",
						sortable: true,
						filterable: true,
						role: "dimension"
					}
				]
			}
		},
		functionImports: {
			setTextVariantDefault: {
				name: "setTextVariantDefault",
				title: "Set default variant",
				httpMethod: "POST",
				returnType: "TEXT_APP_SRV.TEXT_VARIANT",
				entitySet: "TEXT_VARIANT",
				actionFor: "TEXT_APP_SRV.TEXT_VARIANT",
				resultEntity: "TEXT_VARIANT",
				parameters: [
					{
						id: "variantId",
						label: "variantId",
						type: "string",
						originalType: "Edm.String",
						mandatory: true
					},
					{
						id: "appId",
						label: "appId",
						type: "string",
						originalType: "Edm.String"
					},
					{
						id: "viewId",
						label: "viewId",
						type: "string",
						originalType: "Edm.String"
					}
				]
			},
			createTextRequest: {
				name: "createTextRequest",
				title: "Create transport",
				httpMethod: "POST",
				returnType: "TEXT_APP_SRV.TEXT_TRANSPORT_REQUEST",
				entitySet: "TRANSPORT_REQUEST",
				resultEntity: "TRANSPORT_REQUEST",
				parameters: [
					{
						id: "type",
						label: "type",
						type: "string",
						originalType: "Edm.String",
						mandatory: true
					},
					{
						id: "text",
						label: "text",
						type: "string",
						originalType: "Edm.String",
						mandatory: true
					}
				]
			}
		}
	};
}

describe("odataFetchFn / explicit operation mode", () => {
	beforeEach(() => {
		fetchODataJson.mockReset();
		resolveODataBaseUrl.mockClear();
		mockedGetODataMetadataData.mockReset();
		fetchODataJson.mockResolvedValue({ data: { ok: true } });
	});

	it("подставляет http method из metadata для FunctionImport и объединяет query string", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createFunctionImportMetadata());

		const client = new QueryClient();
		const result = await odataFetchFn("fi", {
			odata: {
				service: "TEXT_APP_SRV",
				target: "setTextVariantDefault"
			},
			params: {
				variantId: { value: "uuid-1" },
				appId: { value: "app" },
				viewId: { value: "main" }
			},
			options: {
				select: ["variantId" as never]
			},
			transform: (data, target) => ({
				data,
				name: "name" in target ? target.name : "entity"
			})
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_APP_SRV/setTextVariantDefault?variantId=%27uuid-1%27&appId=%27app%27&viewId=%27main%27&%24select=variantId",
			expect.objectContaining({ method: "POST" }),
			"odata"
		);
		expect(result.data).toEqual({
			data: { ok: true },
			name: "setTextVariantDefault"
		});
	});

	it("строит запрос fi для createTextRequest по metadata FunctionImport", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createFunctionImportMetadata());

		const client = new QueryClient();

		await odataFetchFn("fi", {
			odata: {
				service: "TEXT_APP_SRV",
				target: "createTextRequest"
			},
			params: {
				type: { value: "workbench" },
				text: { value: "Новый транспорт" }
			}
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_APP_SRV/createTextRequest?type=%27workbench%27&text=%27%D0%9D%D0%BE%D0%B2%D1%8B%D0%B9+%D1%82%D1%80%D0%B0%D0%BD%D1%81%D0%BF%D0%BE%D1%80%D1%82%27",
			expect.objectContaining({ method: "POST" }),
			"odata"
		);
	});

	it("бросает ошибку, если metadata FunctionImport не содержит httpMethod", async () => {
		mockedGetODataMetadataData.mockResolvedValue({
			entities: {},
			functionImports: {
				GET_RAW: {
					name: "GET_RAW",
					title: "Raw function import",
					returnType: "Edm.String"
				}
			}
		});

		const client = new QueryClient();

		await expect(
			odataFetchFn("fi", {
				odata: {
					service: "TEXT_APP_SRV",
					target: "GET_RAW"
				},
				params: {}
			})({ client })
		).rejects.toThrow("FunctionImport 'GET_RAW' не содержит httpMethod");
	});

	it("бросает ошибку для несовместимой операции и FunctionImport", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createFunctionImportMetadata());

		const client = new QueryClient();

		await expect(
			odataFetchFn("create", {
				odata: {
					service: "TEXT_APP_SRV",
					target: "setTextVariantDefault"
				},
				body: { variantId: "uuid-1" }
			})({ client })
		).rejects.toThrow("Для FunctionImport используйте method: 'fi'");
	});

	it("бросает ошибку для неизвестного target", async () => {
		mockedGetODataMetadataData.mockResolvedValue({
			entities: {},
			functionImports: {}
		});

		const client = new QueryClient();

		await expect(
			odataFetchFn("query", {
				odata: {
					service: "TEXT_APP_SRV",
					target: "UNKNOWN_TARGET"
				}
			})({ client })
		).rejects.toThrow("OData target 'UNKNOWN_TARGET' не был загружен");
	});

	it("бросает ошибку при коллизии имени entity и FunctionImport", async () => {
		mockedGetODataMetadataData.mockResolvedValue({
			entities: {
				DUPLICATE: {
					title: "Entity",
					columns: []
				}
			},
			functionImports: {
				DUPLICATE: {
					name: "DUPLICATE",
					title: "Function import",
					returnType: ""
				}
			}
		});

		const client = new QueryClient();

		await expect(
			odataFetchFn("query", {
				odata: {
					service: "TEXT_APP_SRV",
					target: "DUPLICATE"
				}
			})({ client })
		).rejects.toThrow("Найден конфликт metadata: 'DUPLICATE' существует и как Entity, и как FunctionImport");
	});

	it("строит read path для entity без суффикса Set", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createEntityMetadata());

		const client = new QueryClient();

		await odataFetchFn("read", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			params: {
				ID: { value: "42" }
			}
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_DEMO_SRV/TextEntity(ID='42')",
			expect.objectContaining({ method: "GET", signal: undefined }),
			"odata"
		);
	});

	it("строит create path без params и сериализует body", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createEntityMetadata());

		const client = new QueryClient();
		const body = { ID: "42", name: "Demo" };

		await odataFetchFn("create", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			body
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_DEMO_SRV/TextEntity",
			expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
			"odata"
		);
	});

	it("строит update path c params и сериализует body", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createEntityMetadata());

		const client = new QueryClient();
		const body = { ID: "42", name: "Demo" };

		await odataFetchFn("update", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			params: {
				ID: { value: "42" }
			},
			body
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_DEMO_SRV/TextEntity(ID='42')",
			expect.objectContaining({ method: "PUT", body: JSON.stringify(body) }),
			"odata"
		);
	});

	it("строит delete path только c params", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createEntityMetadata());

		const client = new QueryClient();

		await odataFetchFn("delete", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			params: {
				ID: { value: "42" }
			}
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_DEMO_SRV/TextEntity(ID='42')",
			expect.objectContaining({ method: "DELETE" }),
			"odata"
		);
	});

	it("строит query path без params для plain entity", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createEntityMetadata());

		const client = new QueryClient();

		await odataFetchFn("query", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			}
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith("/TEXT_DEMO_SRV/TextEntity", expect.objectContaining({ method: "GET" }), "odata");
	});

	it("игнорирует params для plain entity query и пишет warning в dev-режиме", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createEntityMetadata());

		const client = new QueryClient();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		try {
			await odataFetchFn("query", {
				odata: {
					service: "TEXT_DEMO_SRV",
					target: "TextEntity"
				},
				params: {
					ID: { value: "42" }
				}
			})({ client });
			expect(fetchODataJson).toHaveBeenCalledWith("/TEXT_DEMO_SRV/TextEntity", expect.objectContaining({ method: "GET" }), "odata");
			if (__DEV__) {
				expect(warnSpy).toHaveBeenCalledTimes(1);
			} else {
				expect(warnSpy).not.toHaveBeenCalled();
			}
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("строит query path c params и суффиксом результата для parameterized entity", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createParameterizedEntityMetadata());

		const client = new QueryClient();

		await odataFetchFn("query", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			params: {
				ID: { value: "42" }
			}
		})({ client });

		expect(fetchODataJson).toHaveBeenCalledWith(
			"/TEXT_DEMO_SRV/TextEntity(ID='42')/Set",
			expect.objectContaining({ method: "GET" }),
			"odata"
		);
	});

	it("запрещает read для parameterized entity", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createParameterizedEntityMetadata());

		const client = new QueryClient();

		await expect(
			odataFetchFn("read", {
				odata: {
					service: "TEXT_DEMO_SRV",
					target: "TextEntity"
				},
				params: {
					ID: { value: "42" }
				}
			})({ client })
		).rejects.toThrow("используйте method: 'query'");
	});

	it("автоматически парсит entity-ответ по metadata до transform", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createAutoParseEntityMetadata());
		fetchODataJson.mockResolvedValue({
			data: [{ FLAG: "X", AMOUNT: "10.5", AEDAT: "/Date(1773090000000)/", NAME: "raw" }]
		});

		const client = new QueryClient();
		const result = await odataFetchFn<{ FLAG: boolean; AMOUNT: number; AEDAT: Date; NAME: string }>("query", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			autoParse: true
		})({ client });

		expect(result.data[0]).toMatchObject({
			FLAG: true,
			AMOUNT: 10.5,
			NAME: "raw"
		});
		expect(result.data[0]?.AEDAT).toBeInstanceOf(Date);
	});

	it("при autoParse передает в transform уже распарсенные данные", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createAutoParseEntityMetadata());
		fetchODataJson.mockResolvedValue({
			data: [{ FLAG: " ", AMOUNT: "7", AEDAT: "/Date(1773090000000)/" }]
		});

		const client = new QueryClient();
		const result = await odataFetchFn<{ FLAG: boolean; AMOUNT: number; AEDAT: Date }, string>("query", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			autoParse: true,
			transform: (rows) => `${typeof rows[0]?.FLAG}:${typeof rows[0]?.AMOUNT}:${rows[0]?.AEDAT instanceof Date}`
		})({ client });

		expect(result.data).toBe("boolean:number:true");
	});

	it("без autoParse сохраняет raw-ответ для transform", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createAutoParseEntityMetadata());
		fetchODataJson.mockResolvedValue({
			data: [{ FLAG: "X", AMOUNT: "7" }]
		});

		const client = new QueryClient();
		const result = await odataFetchFn<{ FLAG: string; AMOUNT: string }, string>("query", {
			odata: {
				service: "TEXT_DEMO_SRV",
				target: "TextEntity"
			},
			transform: (rows) => `${typeof rows[0]?.FLAG}:${typeof rows[0]?.AMOUNT}:${rows[0]?.FLAG}`
		})({ client });

		expect(result.data).toBe("string:string:X");
	});

	it("автоматически парсит ответ FunctionImport по resultEntity", async () => {
		mockedGetODataMetadataData.mockResolvedValue(createFunctionImportMetadata());
		fetchODataJson.mockResolvedValue({
			data: { isDefault: "X" }
		});

		const client = new QueryClient();
		const result = await odataFetchFn<{ isDefault: boolean }>("fi", {
			odata: {
				service: "TEXT_APP_SRV",
				target: "setTextVariantDefault"
			},
			params: {
				variantId: { value: "uuid-1" }
			},
			autoParse: true
		})({ client });

		expect(result.data.isDefault).toBe(true);
	});

	it("тихо пропускает autoParse для FunctionImport без metadata результата", async () => {
		mockedGetODataMetadataData.mockResolvedValue({
			entities: {},
			functionImports: {
				GET_RAW: {
					name: "GET_RAW",
					title: "Raw function import",
					httpMethod: "GET",
					returnType: "Edm.String"
				}
			}
		});
		fetchODataJson.mockResolvedValue({
			data: { value: "X" }
		});

		const client = new QueryClient();
		const result = await odataFetchFn<{ value: string }>("fi", {
			odata: {
				service: "TEXT_APP_SRV",
				target: "GET_RAW"
			},
			params: {},
			autoParse: true
		})({ client });

		expect(result.data).toEqual({ value: "X" });
	});
});
