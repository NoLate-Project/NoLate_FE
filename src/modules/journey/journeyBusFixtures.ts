import { journeyRouteFixtures, type JourneyRouteFixture } from "./journeyRouteFixtures";
import type { JourneyRouteInput } from "./journeyRouteInput";

/** Reuses the existing synthetic contract unchanged; never invents a provider/vehicle ID. */
function createBusFixture(id: string, title: string, description: string): JourneyRouteFixture {
    const original = journeyRouteFixtures.find(fixture => fixture.id === "direct-provider-shape");
    if (!original) throw new Error("BUS_BASE_FIXTURE_UNAVAILABLE");
    const input = JSON.parse(JSON.stringify(original.input)) as JourneyRouteInput;
    const bus = input.legs.find(leg => leg.kind === "BUS");
    if (!bus || bus.coordinates.length !== 3) throw new Error("BUS_BASE_FIXTURE_INVALID");
    if (id === "invalid-bus-middle-coordinate") {
        // Keep the point and leg boundaries intact. Invalid geometry must not be repaired by filtering.
        bus.coordinates[1] = { latitude: 95, longitude: 126.9845 };
    }
    if (id === "bus-backtracking-shape") {
        // Keep the original endpoints and stop occurrences; introduce a backwards interior segment.
        bus.coordinates.splice(2, 0, { latitude: 37.5665, longitude: 126.982 });
    }
    return { id, title, description, input };
}

export const journeyBusFixtures: JourneyRouteFixture[] = __DEV__ ? [
    createBusFixture("first-bus-valid", "첫 버스 · 합성", "기존 합성 입력 그대로: 첫 도보 약 132m + 버스 약 881m. 실제 노선·차량 ID가 없어 탑승은 확정하지 않습니다."),
    createBusFixture("invalid-bus-middle-coordinate", "버스 중간 좌표 오류", "첫 도보는 유지하고 버스 형상의 중간 좌표만 잘못된 값으로 둡니다. 출발 감지와 버스 관측 차단을 분리해 확인합니다."),
    createBusFixture("bus-backtracking-shape", "버스 형상 역방향", "버스 형상 중간에 되돌아가는 구간이 있는 합성 예시입니다. 형상을 고치거나 실제 탑승으로 승격하지 않습니다."),
] : [];
