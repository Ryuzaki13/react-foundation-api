export type SsoForm = {
	action: string;
	method: string;
	inputs: Record<string, string>;
};

export type SsoRecoveryArgs = {
	form?: SsoForm;
	recoveryUrl?: string;
};

export type SsoRequiredErrorOptions = {
	recoverable?: boolean;
};

let ssoRecoveryPromise: Promise<boolean> | null = null;
let ssoIframeCounter = 0;

function normalizeSsoAction(action: string) {
	if (typeof window === "undefined") return action;

	try {
		const originRegExp = new RegExp(__ORIGIN_REG_EXP__, "i");
		const url = new URL(action, window.location.origin);
		const isSapHost = originRegExp.test(url.origin);
		const isSsoHost = url.origin === __SSO_ORIGIN__;

		if (isSapHost || isSsoHost || url.origin === window.location.origin) {
			return `${url.pathname}${url.search}${url.hash}`;
		}

		return url.toString();
	} catch {
		return action;
	}
}

export function isSsoForm(form?: SsoForm): form is SsoForm {
	if (!form) return false;

	return typeof form.inputs.SAMLRequest === "string" || typeof form.inputs.SAMLResponse === "string";
}

function createHiddenIframe() {
	const iframeName = `${__APP_ID__}-sso-iframe-${++ssoIframeCounter}`;
	const iframe = document.createElement("iframe");
	iframe.name = iframeName;
	iframe.style.display = "none";
	return iframe;
}

function waitForIframe(iframe: HTMLIFrameElement, cleanup: () => void) {
	return new Promise<boolean>((resolve) => {
		let settleTimer: number | null = null;
		const complete = () => {
			if (settleTimer !== null) {
				window.clearTimeout(settleTimer);
			}

			settleTimer = window.setTimeout(() => {
				cleanup();
				resolve(true);
			}, 400);
		};

		iframe.addEventListener("load", complete);
		iframe.addEventListener("error", complete);
	});
}

function createSsoFormElement(form: SsoForm, target: string) {
	const formElement = document.createElement("form");
	formElement.method = form.method === "GET" ? "GET" : "POST";
	formElement.action = normalizeSsoAction(form.action);
	formElement.target = target;
	formElement.style.display = "none";

	for (const [name, value] of Object.entries(form.inputs)) {
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = name;
		input.value = value;
		formElement.appendChild(input);
	}

	return formElement;
}

function getMountPoint() {
	if (typeof document === "undefined") return null;
	return document.body ?? document.documentElement;
}

export function submitSsoForm(form?: SsoForm) {
	if (!isSsoForm(form)) return false;
	if (typeof document === "undefined") return false;

	const mountPoint = getMountPoint();
	if (!mountPoint) return false;

	const iframe = createHiddenIframe();
	const formElement = createSsoFormElement(form, iframe.name);

	mountPoint.appendChild(iframe);
	mountPoint.appendChild(formElement);
	formElement.submit();
	return true;
}

function recoverBySsoForm(form: SsoForm) {
	const mountPoint = getMountPoint();
	if (!mountPoint) return Promise.resolve(false);

	const iframe = createHiddenIframe();
	const formElement = createSsoFormElement(form, iframe.name);
	const recovery = waitForIframe(iframe, () => {
		iframe.remove();
		formElement.remove();
	});

	mountPoint.appendChild(iframe);
	mountPoint.appendChild(formElement);
	formElement.submit();

	return recovery;
}

function recoverByDocumentNavigation(recoveryUrl: string) {
	const mountPoint = getMountPoint();
	if (!mountPoint) return Promise.resolve(false);

	const iframe = createHiddenIframe();
	const recovery = waitForIframe(iframe, () => {
		iframe.remove();
	});

	mountPoint.appendChild(iframe);
	iframe.src = normalizeSsoAction(recoveryUrl);

	return recovery;
}

export function recoverSsoSession({ form, recoveryUrl }: SsoRecoveryArgs = {}) {
	if (ssoRecoveryPromise) return ssoRecoveryPromise;
	if (typeof window === "undefined") return false;

	ssoRecoveryPromise = (async () => {
		if (isSsoForm(form)) return recoverBySsoForm(form);
		if (recoveryUrl) return recoverByDocumentNavigation(recoveryUrl);
		return false;
	})().finally(() => {
		ssoRecoveryPromise = null;
	});

	return ssoRecoveryPromise;
}

export class SsoRequiredError extends Error {
	public readonly form?: SsoForm;
	public readonly recoveryUrl?: string;
	public readonly recoverable: boolean;
	constructor(message: string, form?: SsoForm, recoveryUrl?: string, options: SsoRequiredErrorOptions = {}) {
		super(message);
		this.form = form;
		this.recoveryUrl = recoveryUrl;
		this.recoverable = options.recoverable ?? true;
		Object.setPrototypeOf(this, SsoRequiredError.prototype);
	}
}
