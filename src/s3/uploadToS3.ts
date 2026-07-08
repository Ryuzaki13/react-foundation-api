import { uuidv4 } from "@ryuzaki13/react-foundation-lib/crypto";

import { fetchJson } from "../odata/transport";

import { ENTITY_NAME, S3_SERVICE_NAME } from "./constants";

/**
 * Загрузка файла в виде base64 в хранилище S3
 */
export async function uploadToS3<R>(options: {
	// TODO: если будет необходимость в вариативности этих параметров, тогда раскоментировать код, связанный с odata
	/**
	 * Если не указан, то используются значения по умолчанию:
	 *
	 * - service = "TEXT_FILE_PROXY_SRV"
	 * - entity = "TEXT_FILE_UPLOAD"
	 */
	// odata?: ODataServiceConfig;

	bucket?: string;

	filename?: string;
	/**
	 * Base64 file content
	 */
	content: string;
}) {
	const { /*odata,*/ bucket, filename, content } = options;
	const { service, entity } = /* odata ?? */ { service: S3_SERVICE_NAME, entity: ENTITY_NAME };

	const requestBody = JSON.stringify({
		fileContent: content,
		bucketName: bucket ?? "",
		objectName: filename ?? `${uuidv4()}`
	});

	// TODO: обновить на odataCreateFn
	return fetchJson<R>(`/${service}/${entity}Set`, {
		method: "POST",
		body: JSON.stringify({
			ImJson: requestBody
		})
	});
}
