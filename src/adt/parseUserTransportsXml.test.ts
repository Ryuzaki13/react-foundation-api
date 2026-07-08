import { describe, expect, it } from "vitest";

import { parseUserTransportsXml } from "./parseUserTransportsXml";

describe("parseUserTransportsXml", () => {
	it("разбирает одиночный заголовок транспорта из ответа ADT", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
	<asx:values>
		<DATA>
			<CTS_REQ_HEADER>
				<TRKORR>DEVK900001</TRKORR>
				<AS4TEXT>Загрузка UI5</AS4TEXT>
				<AS4USER>ALEC</AS4USER>
				<TARSYSTEM>DEV</TARSYSTEM>
				<TRFUNCTION>K</TRFUNCTION>
				<TRSTATUS>D</TRSTATUS>
				<STRKORR>DEVK900000</STRKORR>
			</CTS_REQ_HEADER>
		</DATA>
	</asx:values>
</asx:abap>`;

		expect(parseUserTransportsXml(xml)).toEqual([
			{
				transportNo: "DEVK900001",
				description: "Загрузка UI5",
				owner: "ALEC",
				targetSystem: "DEV",
				functionCode: "K",
				statusCode: "D",
				parentTransportNo: "DEVK900000"
			}
		]);
	});

	it("разбирает несколько транспортов и удаляет дубликаты по номеру", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
	<asx:values>
		<DATA>
			<CTS_REQ_HEADER>
				<TRKORR>DEVK900001</TRKORR>
				<AS4TEXT>Первый</AS4TEXT>
			</CTS_REQ_HEADER>
			<CTS_REQ_HEADER>
				<TRKORR>DEVK900002</TRKORR>
				<AS4TEXT>Второй</AS4TEXT>
			</CTS_REQ_HEADER>
			<CTS_REQ_HEADER>
				<TRKORR>DEVK900001</TRKORR>
				<AS4TEXT>Дубликат</AS4TEXT>
			</CTS_REQ_HEADER>
		</DATA>
	</asx:values>
</asx:abap>`;

		expect(parseUserTransportsXml(xml)).toEqual([
			{
				transportNo: "DEVK900001",
				description: "Первый",
				owner: undefined,
				targetSystem: undefined,
				functionCode: undefined,
				statusCode: undefined,
				parentTransportNo: undefined
			},
			{
				transportNo: "DEVK900002",
				description: "Второй",
				owner: undefined,
				targetSystem: undefined,
				functionCode: undefined,
				statusCode: undefined,
				parentTransportNo: undefined
			}
		]);
	});

	it("возвращает транспортные номера даже если в XML нет полного CTS_REQ_HEADER", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<root>
	<DATA>
		<RESULT>
			<TRKORR>DEVK900003</TRKORR>
		</RESULT>
		<RESULT>
			<TRKORR>DEVK900004</TRKORR>
		</RESULT>
	</DATA>
</root>`;

		expect(parseUserTransportsXml(xml)).toEqual([
			{
				transportNo: "DEVK900003",
				description: undefined,
				owner: undefined,
				targetSystem: undefined,
				functionCode: undefined,
				statusCode: undefined,
				parentTransportNo: undefined
			},
			{
				transportNo: "DEVK900004",
				description: undefined,
				owner: undefined,
				targetSystem: undefined,
				functionCode: undefined,
				statusCode: undefined,
				parentTransportNo: undefined
			}
		]);
	});
});
