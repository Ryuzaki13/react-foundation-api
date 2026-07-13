import { setErrorReportTransportErrorReporter } from "@ryuzaki13/react-foundation-lib/error-report";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBase, fetchJson, fetchQueryFn } from "./fetch";
import { SsoRequiredError } from "./SsoRequiredError";

describe("fetchBase", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		setErrorReportTransportErrorReporter(undefined);
		vi.restoreAllMocks();
	});

	it("парсит SAP OData ошибку из вложенного JSON", async () => {
		global.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: "SY/530",
						message: {
							lang: "ru",
							value: "Необходимо указать запрос на перенос!"
						},
						innererror: {
							application: {
								component_id: "",
								service_namespace: "/SAP/",
								service_id: "TEXT_APP_SRV",
								service_version: "0001"
							},
							transactionid: "68963D462E400020E0069B1AE196C71D",
							timestamp: "",
							Error_Resolution: {
								SAP_Transaction: "",
								SAP_Note: "See SAP Note 1797736 for error analysis"
							},
							errordetails: [
								{
									code: "/IWBEP/CX_MGW_BUSI_EXCEPTION",
									message: "Обнаружена особая ситуация",
									propertyref: "",
									severity: "error",
									transition: false,
									target: ""
								}
							]
						}
					}
				}),
				{
					status: 400,
					statusText: "Bad Request",
					headers: {
						"Content-Type": "application/json; charset=utf-8"
					}
				}
			)
		) as typeof fetch;

		await expect(fetchBase("/TEXT_APP_SRV/SomeSet")).rejects.toThrow("SY/530 | Необходимо указать запрос на перенос!");
	});

	it("не отправляет Content-Type для GET JSON-запроса без тела", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					"Content-Type": "application/json; charset=utf-8"
				}
			})
		);
		global.fetch = fetchMock as typeof fetch;

		await expect(fetchJson("/Filters?cfo-count", {}, "config")).resolves.toEqual({ ok: true });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0] ?? [];
		const headers = new Headers(init?.headers);

		expect(headers.get("Accept")).toBe("application/json");
		expect(headers.get("Content-Type")).toBeNull();
		expect(init?.redirect).toBe("manual");
	});

	it("использует новый AbortSignal при повторном запуске queryFn", async () => {
		const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("metadata", { status: 200 })));
		global.fetch = fetchMock as typeof fetch;
		const queryFn = fetchQueryFn("/ZDEMO_SRV/$metadata", {
			baseUrl: "",
			transform: (response) => response.text()
		});
		const firstController = new AbortController();
		const secondController = new AbortController();

		await queryFn({ signal: firstController.signal });
		firstController.abort();
		await queryFn({ signal: secondController.signal });

		const firstRequestInit = fetchMock.mock.calls[0]?.[1];
		const secondRequestInit = fetchMock.mock.calls[1]?.[1];

		expect(firstRequestInit?.signal).toBe(firstController.signal);
		expect(secondRequestInit?.signal).toBe(secondController.signal);
	});

	it("останавливает SAP SSO-редирект до перехода fetch в ADFS", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			type: "opaqueredirect"
		} as Response);

		await expect(fetchBase("/Filters?cfo-count", {}, "config")).rejects.toMatchObject({
			recoveryUrl: "/text-app/config/Filters?cfo-count",
			recoverable: false
		});
	});

	it("распознаёт SSO-форму с SAMLResponse в успешном HTML-ответе", async () => {
		global.fetch = vi.fn().mockResolvedValue(
			new Response(
				`<html><body><form method="post" action="https://sap-auth.example.test/sap/saml2/sp/acs/300">
					<input type="hidden" name="SAMLResponse" value="token" />
					<input type="hidden" name="RelayState" value="state" />
				</form></body></html>`,
				{
					status: 200,
					headers: {
						"Content-Type": "text/html; charset=utf-8"
					}
				}
			)
		) as typeof fetch;

		await expect(fetchJson("/Filters?cfo-count", {}, "config")).rejects.toBeInstanceOf(SsoRequiredError);
	});

	it("распознаёт SSO-форму с SAMLResponse в ответе 401", async () => {
		global.fetch = vi.fn().mockResolvedValue(
			new Response(
				`<html><body><form method="post" action="https://sap-auth.example.test/sap/saml2/sp/acs/300">
					<input type="hidden" name="SAMLResponse" value="token" />
					<input type="hidden" name="RelayState" value="state" />
				</form></body></html>`,
				{
					status: 401,
					statusText: "Unauthorized",
					headers: {
						"Content-Type": "text/html; charset=utf-8"
					}
				}
			)
		) as typeof fetch;

		await expect(fetchJson("/Filters?cfo-count", {}, "config")).rejects.toBeInstanceOf(SsoRequiredError);
	});

	it("публикует транспортный отчет для HTML-ответа без SSO-формы", async () => {
		const reporter = vi.fn();
		setErrorReportTransportErrorReporter(reporter);
		global.fetch = vi.fn().mockResolvedValue(
			new Response("<html><head><title>Gateway error</title></head><body><h1>Proxy returned login page</h1></body></html>", {
				status: 200,
				headers: {
					"Content-Type": "text/html; charset=utf-8"
				}
			})
		) as typeof fetch;

		await expect(fetchJson("/Filters?cfo-count", {}, "config")).rejects.toThrow("Unexpected HTML response from OData endpoint");
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 300);
		});

		expect(reporter).toHaveBeenCalledTimes(1);
		expect(reporter).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Unexpected HTML response from OData endpoint" }),
			expect.objectContaining({
				source: "fetch.parseResponse",
				requestUrl: "/text-app/config/Filters",
				method: "GET",
				baseUrlType: "config",
				status: 200,
				contentType: "text/html; charset=utf-8",
				html: expect.objectContaining({
					title: "Gateway error",
					formCount: 0,
					textPreview: expect.stringContaining("Proxy returned login page")
				})
			})
		);
	});
});
