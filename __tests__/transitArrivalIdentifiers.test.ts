import { getBusArrivalStationIdentifiers } from "../src/modules/schedule/transitArrivalIdentifiers";
import { buildRouteInfoFromAlternative } from "../src/modules/schedule/routeInfo";

describe("transit arrival station identifiers", () => {
    it("ODsay 경로의 승차 정류장 도시코드와 ARS를 앱 조회에 전달한다", () => {
        const route = buildRouteInfoFromAlternative({
            id: "saved-odsay",
            mode: "TRANSIT",
            source: "api",
            provider: "odsay",
            minutes: 12,
            transitLegs: [{
                kind: "BUS",
                label: "N37",
                startName: "승차 정류장",
                startArsID: "01-001",
                startStationCityCode: "1000",
                startStationProviderCode: "4",
                passStops: [
                    { name: "중간 정류장", code: "3300:OTHER" },
                    { name: "하차 정류장", code: "ARS:99999" },
                ],
            }],
        });

        expect(route.steps[1].boardingBusArrival).toEqual({
            stationName: "승차 정류장",
            arsId: "01001",
            cityCode: "1000",
            cityCodeNamespace: "ODSAY_CID",
            providerCode: "4",
        });
    });

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
