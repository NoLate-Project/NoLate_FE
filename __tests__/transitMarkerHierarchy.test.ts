import {
    collapseRedundantTransferAlights,
    getTransitStationIdentity,
    isRedundantEndpointTransitEvent,
    isRedundantTransferAlight,
    type TransitMarkerHierarchyCandidate,
} from "../src/modules/map/transitMarkerHierarchy";

function candidate(
    intent: TransitMarkerHierarchyCandidate["intent"],
    legIndex: number,
    stopName: string,
    lat: number,
    lng: number
): TransitMarkerHierarchyCandidate {
    return { intent, legIndex, stopName, coord: { lat, lng } };
}

describe("transitMarkerHierarchy", () => {
    it("노선 표기가 다른 같은 역 이름을 하나의 환승 지점으로 인식한다", () => {
        expect(getTransitStationIdentity("사당역 4호선")).toBe("사당");
        expect(getTransitStationIdentity("사당역(2호선)")).toBe("사당");
    });

    it("플랫폼 좌표가 20m 이상 달라도 같은 역의 직전 하차 마커를 제거한다", () => {
        const alight = candidate("ALIGHT", 1, "사당역 4호선", 37.47660, 126.98160);
        const transfer = candidate("TRANSFER", 3, "사당역 2호선", 37.47684, 126.98161);

        expect(isRedundantTransferAlight(alight, transfer)).toBe(true);
        expect(collapseRedundantTransferAlights([
            alight,
            candidate("BOARD", 3, "사당역 2호선", 37.47684, 126.98161),
            transfer,
        ]).map((item) => item.intent)).toEqual(["BOARD", "TRANSFER"]);
    });

    it("이름이 다른 떨어진 정류장과 먼 동명이 역은 별도 마커로 유지한다", () => {
        const alight = candidate("ALIGHT", 1, "서울역", 37.55465, 126.97061);
        const differentStop = candidate("TRANSFER", 3, "회현역", 37.55620, 126.97200);
        const farSameName = candidate("TRANSFER", 3, "서울역", 37.55850, 126.97061);

        expect(isRedundantTransferAlight(alight, differentStop)).toBe(false);
        expect(isRedundantTransferAlight(alight, farSameName)).toBe(false);
    });

    it("출발·도착 핀과 겹치는 첫 승차와 마지막 하차만 숨긴다", () => {
        const origin = { lat: 37.55465, lng: 126.97061 };
        const destination = { lat: 37.49795, lng: 127.02762 };

        expect(isRedundantEndpointTransitEvent(
            "board",
            { lat: 37.55472, lng: 126.97061 },
            { origin, destination }
        )).toBe(true);
        expect(isRedundantEndpointTransitEvent(
            "alight",
            { lat: 37.49802, lng: 127.02762 },
            { origin, destination }
        )).toBe(true);
        expect(isRedundantEndpointTransitEvent(
            "transfer",
            destination,
            { origin, destination }
        )).toBe(false);
        expect(isRedundantEndpointTransitEvent(
            "alight",
            { lat: 37.49850, lng: 127.02762 },
            { origin, destination }
        )).toBe(false);
    });

    it("중간 배율에서는 핀 몸체와 겹치는 가까운 승차 마커도 숨긴다", () => {
        const origin = { lat: 37.55465, lng: 126.97061 };
        expect(isRedundantEndpointTransitEvent(
            "board",
            { lat: 37.55545, lng: 126.97061 },
            { origin },
            14
        )).toBe(true);
        expect(isRedundantEndpointTransitEvent(
            "board",
            { lat: 37.55545, lng: 126.97061 },
            { origin },
            18
        )).toBe(false);
    });
});
