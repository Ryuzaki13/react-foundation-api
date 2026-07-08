import { wrapODataParams } from "@ryuzaki13/react-foundation-lib/odata-service";
import { QueryClient } from "@tanstack/react-query";

import { odataReadFn } from "../odata";

import { S3_ENTITY_NAME, S3_SERVICE_NAME } from "./constants";

export type S3ResponseData = {
	fileContent: string;
	objectName: string;
	bucketName: string;
};

export type FetchS3Params = {
	objectName: string;
	bucketName: string;
	client: QueryClient;
};

export async function fetchFileFromS3({ client, bucketName, objectName }: FetchS3Params) {
	const queryFn = odataReadFn<S3ResponseData, S3ResponseData>({
		odata: { service: S3_SERVICE_NAME, target: S3_ENTITY_NAME },
		params: wrapODataParams({
			objectName: objectName,
			bucketName: bucketName
		}),
		autoParse: true
	});

	return queryFn({ client });
}
