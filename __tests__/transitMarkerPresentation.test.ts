import {
    getTransitEventMarkerPresentation,
    getTransitModeMarkerStyle,
    shouldPreserveTransitBoundaryEvents,
    shouldShowTransitRouteIdentityLabel,
} from "../src/modules/map/transitMarkerPresentation";

describe("transitMarkerPresentation", () => {
    it("전체 경로 배율에서는 핵심 승차·환승 노드와 노선 태그를 보존한다", () => {
        expect(getTransitEventMarkerPresentation("transfer", 12)).toEqual({
            visible: true,
            nodeSize: 21,
            showRouteLabel: false,
        });
        expect(getTransitEventMarkerPresentation("board", 12)).toEqual({
            visible: true,
            nodeSize: 21,
            showRouteLabel: false,
        });
        expect(getTransitEventMarkerPresentation("alight", 12).visible).toBe(false);
    });

    it("전체 경로 노선 태그와 상세 승차 문구의 표시 구간이 겹치지 않는다", () => {
        expect(getTransitEventMarkerPresentation("board", 14)).toEqual({
            visible: true,
            nodeSize: 23,
            showRouteLabel: false,
        });
        expect(getTransitEventMarkerPresentation("board", 15)).toEqual({
            visible: true,
            nodeSize: 24,
            showRouteLabel: false,
        });
        expect(shouldShowTransitRouteIdentityLabel(11.7)).toBe(false);
        expect(shouldShowTransitRouteIdentityLabel(11.8)).toBe(true);
        expect(shouldShowTransitRouteIdentityLabel(16.7)).toBe(true);
        expect(shouldShowTransitRouteIdentityLabel(16.8)).toBe(false);
        expect(getTransitEventMarkerPresentation("board", 16.7).showRouteLabel).toBe(false);
        expect(getTransitEventMarkerPresentation("board", 16.8).showRouteLabel).toBe(true);
        expect(getTransitEventMarkerPresentation("board", 18).nodeSize).toBe(26);
    });

    it("상세 배율에서는 환승 양 끝 경계를 보존한다", () => {
        expect(getTransitEventMarkerPresentation("transfer", 18).nodeSize).toBe(26);
        expect(getTransitEventMarkerPresentation("alight", 18)).toEqual({
            visible: true,
            nodeSize: 22,
            showRouteLabel: false,
        });
        expect(shouldPreserveTransitBoundaryEvents(16.7)).toBe(false);
        expect(shouldPreserveTransitBoundaryEvents(16.8)).toBe(true);
    });

    it("환승 지점에도 범용 환승 문양 대신 다음 탑승 수단 아이콘을 사용한다", () => {
        expect(getTransitModeMarkerStyle("BUS")).toBe("bus");
        expect(getTransitModeMarkerStyle("SUBWAY")).toBe("subway");
        expect(getTransitModeMarkerStyle("WALK")).toBe("walk");
    });

    it("renders the previous alight of a transfer as a compact boundary ring", () => {
        expect(getTransitEventMarkerPresentation("alight", 18, true)).toMatchObject({
            visible: true,
            nodeSize: 16,
            showRouteLabel: false,
            stationVariant: "compact",
        });
    });
});
