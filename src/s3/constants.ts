export const BUCKET = "auditls-4f02df71";
export const BASE_PATH = `${__DEV__ ? "" : "https://files-api.example.test"}/s3/1/object`;

/**
 * Имя сервиса (что-то типа прокси) для использования https://files-api.example.test в обход CORS
 */
export const S3_SERVICE_NAME = "TEXT_FILE_PROXY_SRV";

/**
 * Имя сущности сервиса `SERVICE_NAME` для заливки файлов в S3
 */
export const ENTITY_NAME = "TEXT_FILE_UPLOAD";

// FIXME: теперь нужно понять, нужен ли вообще TEXT_FILE_UPLOAD?
export const S3_ENTITY_NAME = "s3File";
