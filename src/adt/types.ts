export interface UserTransport {
	transportNo: string;
	description: string | undefined;
	owner: string | undefined;
	targetSystem: string | undefined;
	functionCode: string | undefined;
	statusCode: string | undefined;
	parentTransportNo: string | undefined;
}
