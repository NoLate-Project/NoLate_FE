import type { TransitLegDetail } from "../src/modules/map/routingService";
import { normalizeJourneyRoute } from "../src/modules/journey/journeyRoute";

describe("normalizeJourneyRoute", () => {
    it("실제 leg를 합치지 않고 provider 원본 정보를 깊은 복사로 보존한다", () => {
        const legs: TransitLegDetail[] = [
            {
                kind: "WALK",
                label: "출발지에서 정류장까지 도보",
                startName: "집",
                endName: "푸른마을 정류장",
                pathCoords: [{ lat: 37.1, lng: 127.1 }],
            },
            {
                kind: "BUS",
                label: "버스 31",
                lineName: "31",
                providerRouteId: "provider-31",
                localRouteId: "local-31",
                directionName: "판교역 방면",
                startName: "푸른마을 정류장",
                endName: "판교역 정류장",
                startCoord: { lat: 37.2, lng: 127.2 },
                endCoord: { lat: 37.3, lng: 127.3 },
                passStops: [
                    { name: "중간 정류장", sequence: 1, coord: { lat: 37.25, lng: 127.25 } },
                ],
                pathCoords: [
                    { lat: 37.2, lng: 127.2 },
                    { lat: 37.3, lng: 127.3 },
                ],
            },
            {
                kind: "SUBWAY",
                label: "신분당선",
                lineName: "신분당선",
                startName: "판교역",
                endName: "강남역",
            },
        ];

        const route = normalizeJourneyRoute(legs);

        expect(route.firstRideLegIndex).toBe(1);
        expect(route.lastRideLegIndex).toBe(2);
        expect(route.legs.map(({ index, isRide }) => ({ index, isRide }))).toEqual([
            { index: 0, isRide: false },
            { index: 1, isRide: true },
            { index: 2, isRide: true },
        ]);
        expect(route.legs[1]?.detail).toEqual(legs[1]);
        expect(route.legs[1]?.detail).not.toBe(legs[1]);
        expect(route.legs[1]?.detail.passStops).not.toBe(legs[1]?.passStops);
        expect(route.legs[1]?.detail.passStops?.[0]?.coord).not.toBe(legs[1]?.passStops?.[0]?.coord);
        expect(route.legs[1]?.detail.pathCoords).not.toBe(legs[1]?.pathCoords);

        legs[1]!.lineName = "변경된 원본";
        legs[1]!.passStops![0]!.name = "변경된 정류장";
        expect(route.legs[1]?.detail.lineName).toBe("31");
        expect(route.legs[1]?.detail.passStops?.[0]?.name).toBe("중간 정류장");
    });

    it("수동 대중교통 MVP가 지원하지 않는 빈 경로, ETC, ride 없는 경로를 거부한다", () => {
        expect(() => normalizeJourneyRoute([])).toThrow(RangeError);
        expect(() => normalizeJourneyRoute([
            { kind: "ETC", label: "기타 이동" },
            { kind: "BUS", label: "버스" },
        ])).toThrow(/ETC/u);
        expect(() => normalizeJourneyRoute([
            { kind: "FERRY", label: "지원하지 않는 이동" } as unknown as TransitLegDetail,
            { kind: "BUS", label: "버스" },
        ])).toThrow(/FERRY/u);
        expect(() => normalizeJourneyRoute([
            { kind: "WALK", label: "도보" },
        ])).toThrow(/bus or subway/u);
    });
});
