// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { recoverSsoSession, submitSsoForm } from "./SsoRequiredError";

describe("submitSsoForm", () => {
	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("отправляет SSO-форму в скрытый iframe, не меняя текущее окно", () => {
		const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);

		expect(
			submitSsoForm({
				action: "https://sapbpcxx0.some.site/sap/saml2/sp/acs/300",
				method: "POST",
				inputs: {
					SAMLResponse: "token",
					RelayState: "state"
				}
			})
		).toBe(true);

		const iframe = document.querySelector("iframe");
		const form = document.querySelector("form");

		expect(iframe).not.toBeNull();
		expect(form).not.toBeNull();
		expect(form?.getAttribute("target")).toBe(iframe?.getAttribute("name"));
		expect(form?.getAttribute("action")).toBe("/sap/saml2/sp/acs/300");
		expect(submitSpy).toHaveBeenCalledTimes(1);
	});

	it("восстанавливает SSO по исходному URL в скрытом iframe без перезагрузки страницы", async () => {
		vi.useFakeTimers();

		const recovery = recoverSsoSession({ recoveryUrl: "/some/config/Filters?cfo-count" });
		const iframe = document.querySelector("iframe");

		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute("src")).toBe("/some/config/Filters?cfo-count");

		iframe?.dispatchEvent(new Event("load"));
		await vi.advanceTimersByTimeAsync(400);

		await expect(recovery).resolves.toBe(true);
		expect(document.querySelector("form")).toBeNull();
	});
});
