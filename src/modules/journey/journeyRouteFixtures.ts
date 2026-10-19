import { parseTransitLegDetails } from "../map/tmapTransitGeometry";
import { buildJourneyRouteInput, type JourneyRouteInput } from "./journeyRouteInput";

export type JourneyRouteFixture = { id: string; title: string; description: string; input: JourneyRouteInput };

/** Synthetic provider-shaped data, not a recorded provider response or verified operating route. */
function syntheticProviderLegs(): Record<string, unknown>[] {
    const point = (lon: number, name: string) => ({ lon, lat: 37.5665, name });
    return [
        {
            mode: "WALK", sectionTime: 120,
            start: point(126.978, "합성 출발"), end: point(126.9795, "합성 승차"),
            steps: [{ linestring: "126.978,37.5665 126.97875,37.5665 126.9795,37.5665" }],
        },
        {
            mode: "BUS", sectionTime: 300, route: "합성 노선", service: 1,
            start: point(126.9795, "합성 승차"), end: point(126.9895, "합성 하차"),
            direction: "합성 동쪽 방면", directionCode: "DOWN", stationCount: 2,
            passShape: { linestring: "126.9795,37.5665 126.9845,37.5665 126.9895,37.5665" },
            passStopList: { stationList: [126.9795, 126.9845, 126.9895].map((lon, index) => ({
                index, lon, lat: 37.5665, stationName: `합성 정류장 ${index + 1}`, stationID: `synthetic-${index}`,
            })) },
        },
        {
            mode: "WALK", sectionTime: 120,
            start: point(126.9895, "합성 하차"), end: point(126.991, "합성 도착"),
            steps: [{ linestring: "126.9895,37.5665 126.99025,37.5665 126.991,37.5665" }],
        },
    ];
}

function fixture(id: string, title: string, description: string): JourneyRouteFixture {
    const raw = syntheticProviderLegs();
    if (id === "stop-line-fallback") delete raw[1].passShape;
    if (id === "missing-stop-order") {
        const list = raw[1].passStopList as { stationList: Record<string, unknown>[] };
        delete list.stationList[1].index;
    }
    if (id === "wrong-direction-shape") {
        raw[0].steps = [{ linestring: "126.9795,37.5665 126.97875,37.5665 126.978,37.5665" }];
    }
    // These are the production parser and adapter, with no network or credential access.
    const transitLegs = parseTransitLegDetails(raw);
    if (id === "saved-legacy") transitLegs.forEach(leg => { delete leg.navigationEvidence; });
    if (id === "invalid-middle-coordinate") {
        // Corruption after parsing must also be rejected, not filtered into a plausible straight line.
        transitLegs[0].pathCoords![1] = { lat: 95, lng: 126.97875 };
    }
    const built = buildJourneyRouteInput({
        mode: "TRANSIT", provider: "tmap", source: "api", transitLegs,
        routeReliability: "live_provider", routePlausibility: "normal", transitServiceState: "operating",
    }, {
        routeRevision: 1, context: id === "saved-legacy" ? "SAVED_ROUTE" : "SYNTHETIC_FIXTURE",
        origin: { lat: 37.5665, lng: 126.978 }, destination: { lat: 37.5665, lng: 126.991 },
    });
    if (!built.ok) throw new Error("INVALID_SYNTHETIC_ROUTE_FIXTURE");
    return { id, title, description, input: built.input };
}

// No fabricated provider route ID: current TMAP parsing does not establish one. Even the first
// fixture may pass shape/stop checks while remaining ineligible for riding or automatic guidance.
export const journeyRouteFixtures: JourneyRouteFixture[] = __DEV__ ? [
    fixture("direct-provider-shape", "직접 형상 · 합성", "합성 TMAP 형식 → 실제 파서 → 계약 검사. 노선 ID·현장 정확도는 확인하지 않았습니다."),
    fixture("stop-line-fallback", "정류장 직선 대체", "원본 형상이 없는 합성 예시. 정류장을 이은 표시용 선은 길안내 형상으로 인정하지 않습니다."),
    fixture("missing-stop-order", "정류장 순서 누락", "원본 순서가 빠진 합성 예시. 화면용 번호가 있어도 실제 통과 순서로 승격하지 않습니다."),
    fixture("wrong-direction-shape", "역방향 형상", "출발·도착 좌표와 반대로 놓인 합성 형상. 임의로 뒤집거나 보정하지 않고 차단합니다."),
    fixture("saved-legacy", "이전 저장 경로", "새 출처 계약이 없는 과거 저장 데이터 형식의 합성 예시. 최신 경로로 간주하지 않습니다."),
    fixture("invalid-middle-coordinate", "중간 좌표 오류", "범위를 벗어난 중간 좌표를 보존한 합성 예시. 오류 점을 지우고 이웃 점을 연결하지 않습니다."),
] : [];
