import { getRouteEndpointMarkerPresentation } from "../src/modules/map/routeMarkerPresentation";

const origin = { lat: 37.5547, lng: 126.9706 };
const nearbyDestination = { lat: 37.5714, lng: 126.9769 };

describe("route endpoint marker presentation", () => {
    it("저배율에서 가까운 출발·도착 라벨을 축약한다", () => {
        const presentation = getRouteEndpointMarkerPresentation(origin, nearbyDestination, 12);
        expect(presentation.showLabels).toBe(false);
        expect(presentation.markerScale).toBe(0.84);
    });

    it("확대하면 같은 경로의 핀 라벨을 다시 표시한다", () => {
        const presentation = getRouteEndpointMarkerPresentation(origin, nearbyDestination, 14);
        expect(presentation.showLabels).toBe(true);
        expect(presentation.markerScale).toBe(0.92);
    });

    it("같은 줌 LOD 안에서는 핀 크기를 고정해 카메라 이동 중 재생성을 막는다", () => {
        expect(getRouteEndpointMarkerPresentation(origin, nearbyDestination, 12.01).markerScale).toBe(0.92);
        expect(getRouteEndpointMarkerPresentation(origin, nearbyDestination, 16.49).markerScale).toBe(0.92);
    });

    it("한쪽 좌표만 있으면 핀 의미를 유지한다", () => {
        expect(getRouteEndpointMarkerPresentation(origin, undefined, 17)).toEqual({
            showLabels: true,
            markerScale: 1,
        });
    });
});
