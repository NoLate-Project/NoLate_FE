import {
    buildRecoveredLoopTransitOption,
    createTransitLoopRecoveryPlan,
    selectTransitLoopSubroute,
} from "../src/modules/map/transitLoopRecovery";
import type { RoutePathCoord, TransitLegDetail, TransitRouteOption } from "../src/modules/map/tmapApi";

function linePath(points: Array<[number, number]>): RoutePathCoord[] {
    return points.map(([lat, lng]) => ({ lat, lng }));
}

function subwayLeg(
    from: string,
    to: string,
    stops: Array<[string, number, number]>,
    minutes: number,
    distanceMeters: number
): TransitLegDetail {
    return {
        kind: "SUBWAY",
        label: `지하철 수도권2호선 ${minutes}분`,
        lineName: "수도권2호선",
        lineColor: "#00A84D",
        startName: from,
        endName: to,
        startCoord: { lat: stops[0][1], lng: stops[0][2] },
        endCoord: { lat: stops[stops.length - 1][1], lng: stops[stops.length - 1][2] },
        passStops: stops.map(([name, lat, lng], index) => ({
            name,
            sequence: index + 1,
            coord: { lat, lng },
        })),
        stationCount: stops.length - 1,
        durationMinutes: minutes,
        distanceMeters,
        pathCoords: linePath(stops.map(([, lat, lng]) => [lat, lng])),
        pathCoordsIsExact: true,
        pathGeometrySource: "TRANSIT_PASS_SHAPE_LINESTRING",
        serviceAvailable: true,
    };
}

function walkLeg(from: RoutePathCoord, to: RoutePathCoord, minutes: number): TransitLegDetail {
    return {
        kind: "WALK",
        label: `도보 ${minutes}분`,
        durationMinutes: minutes,
        distanceMeters: minutes * 65,
        startCoord: from,
        endCoord: to,
        pathCoords: [from, to],
        pathCoordsIsExact: true,
        pathGeometrySource: "WALK_STEPS_LINESTRING",
    };
}

function option(id: string, legs: TransitLegDetail[], minutes: number, distanceMeters: number): TransitRouteOption {
    return {
        id,
        minutes,
        distanceMeters,
        transferCount: 0,
        walkMeters: legs.filter((leg) => leg.kind === "WALK").reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0),
        fareWon: 1_750,
        transitLegs: legs,
        pathCoords: legs.flatMap((leg) => leg.pathCoords ?? []),
        source: "api",
        provider: "tmap",
    };
}

const jamsil = { name: "잠실", lat: 37.51326, lng: 127.10015 };
const hongdae = { name: "홍대입구", lat: 37.55719, lng: 126.92450 };
const seongsu = { name: "성수", lat: 37.544581, lng: 127.055961 };

describe("transit loop recovery", () => {
    test("긴 2호선 순환 방향에서 반환 경로에 없는 성수 앵커를 고른다", () => {
        const longRide = subwayLeg("잠실", "홍대입구", [
            ["잠실", 37.51326, 127.10015],
            ["강남", 37.49799, 127.02791],
            ["사당", 37.47654, 126.98154],
            ["신도림", 37.50873, 126.89130],
            ["홍대입구", 37.55719, 126.92450],
        ], 51, 28_797);
        const direct = option("direct", [longRide], 57, 28_916);

        const plan = createTransitLoopRecoveryPlan([direct], jamsil, hongdae);

        expect(plan?.lineToken).toBe("2호선");
        expect(plan?.anchor.name).toBe("성수");
    });

    test("일반적인 짧은 동일 노선 경로에는 추가 복구를 시작하지 않는다", () => {
        const normalRide = subwayLeg("잠실", "성수", [
            ["잠실", 37.51326, 127.10015],
            ["성수", 37.54458, 127.05596],
        ], 10, 6_607);
        const direct = option("normal", [normalRide], 16, 6_622);

        expect(createTransitLoopRecoveryPlan([direct], jamsil, seongsu)).toBeUndefined();
    });

    test("같은 노선으로 앵커에 도착·출발하는 무환승 후보만 선택한다", () => {
        const valid = option("valid", [subwayLeg("잠실", "성수", [
            ["잠실", 37.51326, 127.10015],
            ["성수", 37.54458, 127.05596],
        ], 10, 6_607)], 16, 6_622);
        const wrong = option("wrong", [subwayLeg("잠실", "강남", [
            ["잠실", 37.51326, 127.10015],
            ["강남", 37.49799, 127.02791],
        ], 12, 8_000)], 15, 8_200);

        expect(selectTransitLoopSubroute([wrong, valid], "2호선", seongsu, "TO_ANCHOR")?.id).toBe("valid");
    });

    test("중간역 도보를 제거하고 하나의 정확한 무환승 노선으로 합친다", () => {
        const startWalk = walkLeg(jamsil, { lat: 37.513336, lng: 127.100189 }, 3);
        const endWalk = walkLeg({ lat: 37.55719, lng: 126.92450 }, hongdae, 2);
        const longRide = subwayLeg("잠실", "홍대입구", [
            ["잠실", 37.513336, 127.100189],
            ["강남", 37.49799, 127.02791],
            ["홍대입구", 37.55719, 126.92450],
        ], 51, 28_797);
        const direct = option("direct", [startWalk, longRide, endWalk], 57, 28_916);
        const plan = createTransitLoopRecoveryPlan([direct], jamsil, hongdae)!;

        const leftRide = subwayLeg("잠실", "성수", [
            ["잠실", 37.513336, 127.100189],
            ["건대입구", 37.54037, 127.06919],
            ["성수", 37.54458, 127.05596],
        ], 10, 6_607);
        const rightRide = subwayLeg("성수", "홍대입구", [
            ["성수", 37.54458, 127.05596],
            ["왕십리", 37.56113, 127.03551],
            ["홍대입구", 37.55719, 126.92450],
        ], 28, 13_588);
        const anchorWalk = walkLeg(seongsu, seongsu, 3);
        const left = option("left", [startWalk, leftRide, anchorWalk], 16, 6_622);
        const right = option("right", [anchorWalk, rightRide, endWalk], 34, 13_702);

        const recovered = buildRecoveredLoopTransitOption(plan, left, right);
        const rides = recovered?.transitLegs?.filter((leg) => leg.kind === "SUBWAY");

        expect(recovered).toMatchObject({
            id: "loop-recovered-direct",
            minutes: 38,
            transferCount: 0,
            fareWon: 1_750,
        });
        expect(recovered?.transitLegs?.some((leg) => leg.kind === "WALK")).toBe(false);
        expect(rides).toHaveLength(1);
        expect(rides?.[0]).toMatchObject({
            startName: "잠실",
            endName: "홍대입구",
            pathCoordsIsExact: true,
        });
        expect(rides?.[0].passStops?.map((stop) => stop.name)).toEqual([
            "잠실", "건대입구", "성수", "왕십리", "홍대입구",
        ]);
    });

    test("역이 아닌 주변 장소에서 출발하면 실제 접근 도보를 보존한다", () => {
        const nearbyOrigin = { name: "롯데월드타워", lat: 37.51326, lng: 127.10015 };
        const startWalk = walkLeg(nearbyOrigin, { lat: 37.513336, lng: 127.100189 }, 3);
        const endWalk = walkLeg({ lat: 37.55719, lng: 126.92450 }, hongdae, 2);
        const directRide = subwayLeg("잠실", "홍대입구", [
            ["잠실", 37.513336, 127.100189],
            ["강남", 37.49799, 127.02791],
            ["홍대입구", 37.55719, 126.92450],
        ], 51, 28_797);
        const direct = option("direct-poi", [startWalk, directRide, endWalk], 57, 28_916);
        const plan = createTransitLoopRecoveryPlan([direct], nearbyOrigin, hongdae)!;
        const leftRide = subwayLeg("잠실", "성수", [
            ["잠실", 37.513336, 127.100189],
            ["성수", 37.54458, 127.05596],
        ], 10, 6_607);
        const rightRide = subwayLeg("성수", "홍대입구", [
            ["성수", 37.54458, 127.05596],
            ["홍대입구", 37.55719, 126.92450],
        ], 28, 13_588);

        const recovered = buildRecoveredLoopTransitOption(
            plan,
            option("left-poi", [startWalk, leftRide], 13, 6_746),
            option("right-poi", [rightRide, endWalk], 30, 13_715)
        );

        expect(recovered?.transitLegs?.[0].kind).toBe("WALK");
        expect(recovered?.minutes).toBe(41);
    });
});
