import type { RouteAlternativeOption } from "../src/modules/map/tmapApi";
import { applyOdsayBusPreview, buildOdsayBusPreviewInput } from "../src/api/transitTimetablePreview";
import {
    buildRouteInfoFromAlternative,
    buildRouteSummaryMetrics,
    compactTransitLineLabel,
    getRouteStepDirectionHint,
    getRouteInfoFromRoute,
    isRouteInfo,
} from "../src/modules/schedule/routeInfo";

jest.mock("../src/api/api", () => ({ __esModule: true, default: {} }));

const origin = { name: "서울역", address: "서울 중구", lat: 37.5547, lng: 126.9706 };
const destination = { name: "홍대입구역", address: "서울 마포구", lat: 37.5572, lng: 126.9254 };

describe("routeInfo", () => {
    it("preserves the live bus destination time and keeps bus waiting inside the leg duration", () => {
        const option: RouteAlternativeOption = {
            id: "odsay-360", mode: "TRANSIT", provider: "odsay", source: "api",
            minutes: 15, providerTimeBasis: "route_estimate",
            transitLegs: [
                { kind: "WALK", label: "접근 도보", durationMinutes: 3 },
                { kind: "BUS", label: "8146", lineName: "8146", providerRouteId: "2822539", durationMinutes: 6,
                    alternateBusLines: [{ lineName: "360", providerRouteId: "1440", localRouteId: "100100057" }] },
                { kind: "WALK", label: "도착 도보", durationMinutes: 6 },
            ],
            odsayBusPreview: {
                departureAt: "2026-11-16T00:20:00Z", boardingAt: "2026-11-16T00:25:02Z",
                alightingAt: "2026-11-16T00:27:18Z", arrivalAt: "2026-11-16T00:33:18Z",
                sourceUpdatedAt: "2026-11-16T00:19:43Z", accessSeconds: 157, egressSeconds: 360, providerRouteId: "1440",
            },
        };
        const selected = applyOdsayBusPreview(option, option.odsayBusPreview!);
        const result = buildRouteInfoFromAlternative(selected, origin, destination);
        expect(result).toMatchObject({
            departureTime: "2026-11-16T00:20:00.000Z", arrivalTime: "2026-11-16T00:33:18.000Z",
            timeBasis: "estimated", providerTimeBasis: "route_estimate",
            totalDurationSeconds: 798, totalDurationMinutes: 14,
        });
        expect(result.steps.slice(1, -1).map(step => step.durationSeconds)).toEqual([157, 281, 360]);
        expect(result.steps[2]).toMatchObject({ lineName: "360", durationMinutes: 5, waitingMinutes: 3 });
        expect(selected.transitLegs?.[1]?.providerRouteId).toBe("1440");
        expect(result.steps[2].scheduledRide).toBeUndefined();
    });

    it("같은 정류장의 첫 버스 대체편을 선택해도 환승 노선은 유지한다", () => {
        const option: RouteAlternativeOption = { id: "odsay-transfer", mode: "TRANSIT",
            provider: "odsay", source: "api", minutes: 46, transitLegs: [
                { kind: "BUS", label: "140", lineName: "140", providerRouteId: "868", startID: "106741",
                    endID: "106410", alternateBusLines: [{ lineName: "421", providerRouteId: "1808", localRouteId: "100100409" }] },
                { kind: "WALK", label: "환승 도보", durationMinutes: 4 },
                { kind: "BUS", label: "3420", lineName: "3420", providerRouteId: "1709", startID: "156842", endID: "108687" },
            ] };
        const clock = jest.spyOn(Date, "now").mockReturnValueOnce(Date.parse("2026-11-18T01:50:00Z"));
        try {
            expect(buildOdsayBusPreviewInput(option, { targetArrivalAt: "2026-11-18T02:40:00Z" }, origin, destination))
                .toMatchObject({ alternateProviderRouteId: "1808" });
        } finally { clock.mockRestore(); }
        const selected = applyOdsayBusPreview(option, {
            departureAt: "2026-11-18T01:51:00Z", boardingAt: "2026-11-18T01:56:00Z",
            alightingAt: "2026-11-18T02:25:00Z", arrivalAt: "2026-11-18T02:30:00Z",
            sourceUpdatedAt: "2026-11-18T01:49:45Z", accessSeconds: 240, egressSeconds: 300, providerRouteId: "1808",
            transfer: { firstAlightingAt: "2026-11-18T02:01:00Z", secondBoardingAt: "2026-11-18T02:06:00Z",
                secondProviderRouteId: "1709", walkingSeconds: 240, requiredMarginSeconds: 60 },
        });
        expect(selected.transitModeSummary).toBe("421 → 3420");
        expect(selected.transitLegs?.filter(leg => leg.kind === "BUS").map(leg => leg.providerRouteId)).toEqual(["1808", "1709"]);
    });

    it("ODsay 시간표를 저장할 때 승차 소요와 단일 환승 도보가 재조회 결과와 일치한다", () => {
        const departureAt = "2026-11-16T09:30:00Z";
        const firstAlight = "2026-11-16T10:22:30Z";
        const transferBoard = "2026-11-16T10:26:30Z";
        const lastAlight = "2026-11-16T10:34:00Z";
        const arrivalAt = "2026-11-16T10:35:00Z";
        const option: RouteAlternativeOption = {
            id: "odsay-evening",
            mode: "TRANSIT",
            provider: "odsay",
            source: "api",
            minutes: 60,
            transitLegs: [
                { kind: "WALK", label: "접근 도보", durationSeconds: 60 },
                { kind: "SUBWAY", label: "4호선", durationMinutes: 47, durationSeconds: 2820 },
                { kind: "WALK", label: "환승 도보", durationMinutes: 3, durationSeconds: 180 },
                { kind: "SUBWAY", label: "2호선", durationMinutes: 7, durationSeconds: 420 },
                { kind: "WALK", label: "목적지 도보", durationSeconds: 120 },
            ],
            odsayTimetablePreview: {
                departureAt, arrivalAt,
                rides: [
                    { boardingAt: "2026-11-16T09:34:30Z", arrivalAt: firstAlight },
                    { boardingAt: transferBoard, arrivalAt: lastAlight },
                ],
                transferTimings: [{ previousArrivalAt: firstAlight, boardingAt: transferBoard, walkingSeconds: 157 }],
            },
        };
        const saved = buildRouteInfoFromAlternative(option, origin, destination);
        expect(saved.arrivalTime).toBe("2026-11-16T10:35:00.000Z");
        expect(saved.totalDurationSeconds).toBe(3900);
        expect(saved.steps.slice(1, -1).map(step => step.durationSeconds)).toEqual([60, 2880, 157, 450, 60]);
        expect(saved.steps[3]).toMatchObject({ durationMinutes: 3, description: "3분" });
        expect(saved.steps[4]).toMatchObject({ durationMinutes: 8, scheduledRide: { arrivalAt: lastAlight } });

        const withoutTimetable = buildRouteInfoFromAlternative({ ...option, odsayTimetablePreview: undefined }, origin, destination);
        expect(withoutTimetable.steps.slice(1, -1).map(step => step.durationSeconds)).toEqual([60, 2820, 180, 420, 120]);

        const legs = option.transitLegs!;
        const splitWalk = buildRouteInfoFromAlternative({
            ...option,
            transitLegs: [...legs.slice(0, 2), { ...legs[2], durationSeconds: 80 }, { ...legs[2], durationSeconds: 100 }, ...legs.slice(3)],
        }, origin, destination);
        expect(splitWalk.steps.slice(3, 5).map(step => step.durationSeconds)).toEqual([80, 100]);
    });

    it("ODsay 시간표가 확인한 역 접근 도보를 첫 승차 앞에 저장한다", () => {
        const option: RouteAlternativeOption = {
            id: "odsay-direct",
            mode: "TRANSIT",
            provider: "odsay",
            source: "api",
            minutes: 55,
            transitLegs: [
                { kind: "SUBWAY", label: "4호선", durationSeconds: 2820 },
                { kind: "WALK", label: "목적지 도보", durationSeconds: 180 },
            ],
            odsayTimetablePreview: {
                departureAt: "2026-11-22T09:30:00Z",
                arrivalAt: "2026-11-22T10:25:08Z",
                rides: [{ boardingAt: "2026-11-22T09:34:00Z", arrivalAt: "2026-11-22T10:22:00Z" }],
                transferTimings: [],
                entranceWalk: { seconds: 47, distanceMeters: 50 },
            },
        };

        const saved = buildRouteInfoFromAlternative(option, origin, destination);

        expect(saved.steps.slice(1, -1).map(step => [step.type, step.durationSeconds]))
            .toEqual([["WALK", 47], ["SUBWAY", 2880], ["WALK", 188]]);
        expect(saved.steps[1].distanceMeters).toBe(50);
    });

    it.each([
        { originalDistance: 2, verifiedDistance: 148, accessSeconds: 137, keepGeometry: false },
        { originalDistance: 203, verifiedDistance: 203, accessSeconds: 188, keepGeometry: true },
    ])("검증된 입구·출구 도보를 저장한다 ($originalDistance→$verifiedDistance m)",
        ({ originalDistance, verifiedDistance, accessSeconds, keepGeometry }) => {
        const accessPath = [{ lat: 37.5547, lng: 126.9706 }, { lat: 37.5548, lng: 126.9707 }];
        const saved = buildRouteInfoFromAlternative({
            id: "odsay-exits", mode: "TRANSIT", provider: "odsay", source: "api", minutes: 50,
            walkMeters: originalDistance + 14,
            transitLegs: [
                { kind: "WALK", label: "접근 도보", durationMinutes: Math.ceil(accessSeconds / 60),
                    distanceMeters: originalDistance, pathCoords: accessPath },
                { kind: "SUBWAY", label: "4호선", durationMinutes: 48 },
                { kind: "WALK", label: "목적지 도보", durationMinutes: 1, distanceMeters: 14 },
            ],
            odsayTimetablePreview: {
                departureAt: "2026-11-22T09:50:00Z", arrivalAt: "2026-11-22T10:43:13Z",
                rides: [{ boardingAt: "2026-11-22T09:54:00Z", arrivalAt: "2026-11-22T10:42:00Z" }],
                transferTimings: [], entranceWalk: { seconds: accessSeconds, distanceMeters: verifiedDistance },
                exitWalk: { seconds: 73, distanceMeters: 78 },
            },
        }, origin, destination);

        const walks = saved.steps.filter(step => step.type === "WALK");
        expect(walks.map(step => [step.durationSeconds, step.distanceMeters])).toEqual([[accessSeconds, verifiedDistance], [73, 78]]);
        expect(walks[0].coordinates).toEqual(keepGeometry
            ? accessPath.map(({ lat, lng }) => ({ latitude: lat, longitude: lng })) : undefined);
        expect(saved.walkingDistanceMeters).toBe(verifiedDistance + 78);
    });

    it("이름이 빠진 경유지를 생략해도 지도에서 사용하는 원래 인덱스를 유지한다", () => {
        const route: RouteAlternativeOption = {
            id: "unnamed-stop",
            mode: "TRANSIT",
            minutes: 18,
            source: "api",
            provider: "tmap",
            transitLegs: [{
                kind: "BUS",
                label: "402",
                passStops: [
                    { name: "서울역" },
                    { name: "" },
                    { name: "남대문시장" },
                    { name: "강남역" },
                ],
            }],
        };
        const stops = buildRouteInfoFromAlternative(route, origin, destination)
            .steps.find(step => step.type === "BUS")?.passStops;
        expect(stops?.map(stop => [stop.name, stop.sourceIndex])).toEqual([
            ["서울역", 0], ["남대문시장", 2], ["강남역", 3],
        ]);
    });

    it("시간이 없는 부분 경로에 현재 시각을 출발·도착 시각으로 만들어 넣지 않는다", () => {
        const preview = { id: 'public-preview', mode: 'TRANSIT', transitLegs: [
            { kind: 'BUS', lineName: '7016', startName: '서울역', endName: '경복궁역' },
        ] } as unknown as RouteAlternativeOption;
        const info = buildRouteInfoFromAlternative(preview, origin, destination);
        expect(info.departureTime).toBe(''); expect(info.arrivalTime).toBe('');
        expect(info.steps.some(step => step.type === 'BUS')).toBe(true);
        const scheduled = buildRouteInfoFromAlternative({ ...preview,
            providerDepartureAt: '2026-10-07T04:00:00Z', providerArrivalAt: '2026-10-07T04:10:00Z' });
        expect(scheduled.departureTime).toBe('2026-10-07T04:00:00.000Z');
        expect(scheduled.arrivalTime).toBe('2026-10-07T04:10:00.000Z');
    });
    it("지도 배지에서 TMAP 버스 분류 접두사를 제거한다", () => {
        expect(compactTransitLineLabel("직행좌석:9007")).toBe("9007");
        expect(compactTransitLineLabel("간선:402")).toBe("402");
        expect(compactTransitLineLabel("수도권4호선")).toBe("4호선");
    });

    it("자동차 공급자 안내를 공통 상세 단계와 비용 정보로 보존한다", () => {
        const option: RouteAlternativeOption = {
            id: "car-0",
            mode: "CAR",
            minutes: 19,
            distanceMeters: 6126,
            tollFareWon: 1200,
            taxiFareWon: 11200,
            source: "api",
            provider: "tmap",
            guideSteps: [
                {
                    instruction: "교차로에서 우회전",
                    roadName: "한강대로",
                    durationMinutes: 2.5,
                    distanceMeters: 420,
                    coordinate: { lat: 37.555, lng: 126.97 },
                    pathCoords: [
                        { lat: 37.555, lng: 126.97 },
                        { lat: 37.556, lng: 126.965 },
                    ],
                },
                {
                    instruction: "양화로 방면으로 직진",
                    durationMinutes: 8,
                    distanceMeters: 2400,
                    pathCoords: [
                        { lat: 37.556, lng: 126.965 },
                        { lat: 37.557, lng: 126.94 },
                    ],
                },
            ],
        };

        const result = buildRouteInfoFromAlternative(
            option,
            origin,
            destination,
            new Date("2026-07-11T01:00:00.000Z")
        );

        expect(result.provider).toBe("tmap");
        expect(result.timeBasis).toBe("estimated");
        expect(result.steps.map((step) => step.type)).toEqual([
            "ORIGIN",
            "DRIVE",
            "DRIVE",
            "DESTINATION",
        ]);
        expect(result.steps[1]).toMatchObject({
            title: "교차로에서 우회전",
            distanceMeters: 420,
        });
        expect(buildRouteSummaryMetrics(result).map((item) => item.label)).toEqual(expect.arrayContaining([
            "통행료 1,200원",
            "택시 예상 11,200원",
            "총 6.1km",
        ]));
    });

    it("자전거 경로는 자전거 단계 타입을 사용한다", () => {
        const option: RouteAlternativeOption = {
            id: "bike-0",
            mode: "BIKE",
            minutes: 24,
            distanceMeters: 7100,
            source: "api",
            provider: "openstreetmap",
            guideSteps: [{
                instruction: "자전거도로 따라 계속 이동",
                distanceMeters: 1800,
            }],
        };

        const result = buildRouteInfoFromAlternative(option, origin, destination);
        expect(result.steps[1]).toMatchObject({
            type: "BIKE",
            title: "자전거도로 따라 계속 이동",
        });
    });

    it("timeBasis가 없는 기존 저장 경로도 읽을 수 있다", () => {
        expect(isRouteInfo({
            id: "legacy",
            originName: "출발",
            destinationName: "도착",
            totalDurationMinutes: 10,
            departureTime: "2026-07-11T01:00:00.000Z",
            arrivalTime: "2026-07-11T01:10:00.000Z",
            steps: [],
        })).toBe(true);
    });

    it("ODsay 경로 예상시각은 보존하되 실제 시간표로 승격하지 않는다", () => {
        const option: RouteAlternativeOption = {
            id: "odsay-transit",
            mode: "TRANSIT",
            minutes: 31,
            source: "api",
            provider: "odsay",
            providerTimeBasis: "route_estimate",
            providerDepartureAt: "2026-07-15T13:06:00.000Z",
            providerArrivalAt: "2026-07-15T13:37:00.000Z",
            transitLegs: [],
        };

        const result = buildRouteInfoFromAlternative(option, origin, destination);

        expect(result).toMatchObject({
            provider: "odsay",
            departureTime: "2026-07-15T13:06:00.000Z",
            arrivalTime: "2026-07-15T13:37:00.000Z",
            timeBasis: "estimated",
        });
    });

    it("시간표 근거가 누락된 기존 공급자 시각도 추정값으로 유지한다", () => {
        const result = buildRouteInfoFromAlternative({
            id: "legacy-times", mode: "TRANSIT", minutes: 31, source: "api", provider: "odsay",
            providerDepartureAt: "2026-07-15T13:06:00.000Z",
            providerArrivalAt: "2026-07-15T13:37:00.000Z",
        }, origin, destination);
        expect(result.timeBasis).toBe("estimated");
    });

    it("명시적 시간표 근거와 유효한 시각이 함께 있을 때만 시간표로 보존한다", () => {
        const result = buildRouteInfoFromAlternative({
            id: "verified-times", mode: "TRANSIT", minutes: 31, source: "api", provider: "odsay",
            providerTimeBasis: "timetable",
            providerDepartureAt: "2026-07-15T13:06:00.000Z",
            providerArrivalAt: "2026-07-15T13:37:00.000Z",
        }, origin, destination);
        expect(result.timeBasis).toBe("provider_schedule");
        expect(result.arrivalTime).toBe("2026-07-15T13:37:00.000Z");
    });

    it("구버전 ODsay 저장 경로는 원본을 변경하지 않고 시간표 오표시만 낮춘다", () => {
        const stored = {
            id: "legacy-odsay", provider: "odsay" as const, timeBasis: "provider_schedule" as const,
            originName: "노원역", destinationName: "신림역", totalDurationMinutes: 65,
            departureTime: "2026-10-03T16:40:00Z", arrivalTime: "2026-10-03T17:45:00Z", steps: [],
        };
        expect(getRouteInfoFromRoute(stored)?.timeBasis).toBe("estimated");
        expect(getRouteInfoFromRoute({ routeInfo: stored })?.timeBasis).toBe("estimated");
        expect(stored.timeBasis).toBe("provider_schedule");
        const verified = { ...stored, providerTimeBasis: "timetable" as const };
        expect(getRouteInfoFromRoute(verified)).toBe(verified);
    });

    it("구간 도착역을 행선지로 오인하지 않고 다음 통과역을 방향으로 표시한다", () => {
        expect(getRouteStepDirectionHint({
            id: "subway-4",
            type: "SUBWAY",
            title: "서울역",
            description: "사당까지 · 8정거장 · 16분",
            passStops: [
                { name: "서울역" },
                { name: "숙대입구역" },
                { name: "삼각지역" },
            ],
        }, "사당까지 · 8정거장 · 16분")).toBe("숙대입구역 방향");

        expect(getRouteStepDirectionHint({
            id: "subway-2",
            type: "SUBWAY",
            title: "사당역",
            description: "강남역까지 · 5정거장",
        }, "강남역까지 · 5정거장")).toBe("강남역까지");
    });

    it("공급자가 제공한 승차 안내를 상세 단계까지 보존한다", () => {
        const option: RouteAlternativeOption = {
            id: "bus-platform",
            mode: "TRANSIT",
            minutes: 18,
            source: "api",
            provider: "tmap",
            transitLegs: [{
                kind: "BUS",
                label: "402",
                durationMinutes: 18,
                waitingMinutes: 4,
                lineName: "402",
                startName: "서울역버스환승센터(6번승강장)(중)",
                endName: "남산도서관",
                boardingPlatform: "6번 승강장",
                boardingExit: "4번 출구",
                recommendedBoardingPosition: "앞문 가까이",
            }],
        };

        const result = buildRouteInfoFromAlternative(option, origin, destination);
        expect(result.steps[1]).toMatchObject({
            type: "BUS",
            waitingMinutes: 4,
            boardingPlatform: "6번 승강장",
            boardingExit: "4번 출구",
            recommendedBoardingPosition: "앞문 가까이",
        });
    });
});
