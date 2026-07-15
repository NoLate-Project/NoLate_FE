import { getBusArrivalStationIdentifiers } from "../src/modules/schedule/transitArrivalIdentifiers";

describe("transit arrival station identifiers", () => {
    it("명시적인 서울 ARS ID와 TAGO 도시·노드 ID를 분리한다", () => {
        expect(getBusArrivalStationIdentifiers([
            { code: "ARS:02005" },
            { code: "25:DJB8001793" },
        ], " 서울역버스환승센터 ")).toEqual({
            arsId: "02005",
            cityCode: "25",
            nodeId: "DJB8001793",
            stationName: "서울역버스환승센터",
        });
    });

    it("TMAP 6자리 내부 stationID를 서울 ARS ID로 오인하지 않는다", () => {
        expect(getBusArrivalStationIdentifiers([
            { code: "757384" },
        ], "서울역버스환승센터(6번승강장)(중)")).toEqual({
            arsId: undefined,
            cityCode: undefined,
            nodeId: undefined,
            stationName: "서울역버스환승센터(6번승강장)(중)",
        });
    });
});
