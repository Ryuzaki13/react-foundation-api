export class RouteError extends Error {
	public readonly status: number;
	constructor(status: number) {
		super();
		this.status = status;
		Object.setPrototypeOf(this, RouteError.prototype);
	}
}
