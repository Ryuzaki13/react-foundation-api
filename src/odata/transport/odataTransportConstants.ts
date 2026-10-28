import { HTTP_METHOD_GET, HTTP_METHOD_HEAD } from "../../http/httpProtocolConstants";

/** Общие параметры реального OData-транспорта и его DEV-просмотра. */
export const ODATA_HEADER_SERVICE_VERSION = "DataServiceVersion";
export const ODATA_HEADER_MAX_SERVICE_VERSION = "MaxDataServiceVersion";
export const ODATA_SERVICE_VERSION = "2.0";

export const SAP_HEADER_LANGUAGE = "sap-language";
export const SAP_REQUEST_LANGUAGE = "ru";
export const SAP_HEADER_CONTEXT_ID_ACCEPT = "sap-contextid-accept";
export const SAP_CONTEXT_ID_ACCEPT = "header";
export const SAP_HEADER_CSRF_TOKEN = "x-csrf-token";
export const SAP_HEADER_CLIENT = "sap-client";
export const SAP_PATH_PREFIX = "/sap/";
export const SAP_DP0_PATH_PREFIX = "/sap-dp0/";

/** Методы, для которых транспорт не запрашивает CSRF-токен и не добавляет тип тела. */
export const ODATA_READ_HTTP_METHODS: readonly string[] = [HTTP_METHOD_GET, HTTP_METHOD_HEAD];
