import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { getBusArrivals, getSubwayArrivals } from "../src/api/transitArrivals";
import RouteStepTimeline from "../src/modules/schedule/components/route/RouteStepTimeline";
import { buildRideDescription, getArrivalClockText, getArrivalWaitText } from "../src/modules/schedule/components/route/RouteStepTimeline.helpers";
import type { RouteInfo, RouteStep } from "../src/modules/schedule/routeInfo";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: "Ionicons",
}));

jest.mock("../src/api/transitArrivals", () => ({
    getBusArrivals: jest.fn(),
    getSubwayArrivals: jest.fn(),
}));

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            textPrimary: "#111827",
            textSecondary: "#64748B",
        },
    }),
}));

type StepDuration = Pick<RouteStep, "durationMinutes" | "durationSeconds">;

it.each(["예매 미확인", "예매 상태 미검증"])("omits the old booking note from a saved coach leg without service metadata (%s)", note => {
    const detail = "공주까지 · 90분 · 시간표 06:45 → 08:15";
    expect(buildRideDescription({ id: "coach", type: "COACH", title: "서울경부", description: `${detail} · ${note}` })).toBe(detail);
});

function buildRouteInfo(durations: StepDuration[]): RouteInfo {
    return {
        id: "timeline-timing-route",
        originName: "출발지",
        destinationName: "도착지",
        totalDurationMinutes: 65,
        totalDurationSeconds: 3900,
        departureTime: new Date(2026, 9, 4, 11, 5).toISOString(),
        arrivalTime: new Date(2026, 9, 4, 12, 10).toISOString(),
        timeBasis: "estimated",
        steps: [
            { id: "origin", type: "ORIGIN", title: "출발지" },
            ...durations.map((duration, index): RouteStep => ({
                id: `leg-${index}`,
                type: "SUBWAY",
                title: `${index + 1}번째 역`,
                lineName: "4호선",
                ...duration,
            })),
            { id: "destination", type: "DESTINATION", title: "도착지" },
        ],
    };
}

describe("RouteStepTimeline timing", () => {
    it("describes matched bus clocks as forecasts at the boarding and alighting stops", async () => {
        const route = buildRouteInfo([{ durationMinutes: 12 }]);
        route.matchedTimeline = true;
        route.steps[1] = { ...route.steps[1], type: "BUS", lineName: "402", alightingName: "도착 정류장", matchedTimeline: {
            startAt: route.departureTime, endAt: route.arrivalTime, movementSeconds: 720,
            startsWithStationArrivalPrediction: true,
        } };
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact inlineStationRail />);
        });
        const row = renderer!.root.findByProps({ testID: "route-step-row-leg-0" });
        expect(row.props.accessibilityLabel).toContain("버스 도착 예측");
        expect(renderer!.root.findByProps({ testID: "route-step-alighting-clock-leg-0" }).props.accessibilityLabel)
            .toContain("하차 정류장 도착 예측");
    });

    it("shows exact transfer walking seconds and keeps a pending bus distinct from an unsupported stop", async () => {
        const route = buildRouteInfo([{ durationMinutes: 12 }, { durationMinutes: 1 }, {}]);
        route.matchedTimeline = true;
        route.matchedTimelineBasis = "PENDING_TRANSFER";
        route.arrivalTime = "";
        route.steps[1] = { ...route.steps[1], alightingName: "사당", matchedTimeline: {
            startAt: route.departureTime, endAt: new Date(Date.parse(route.departureTime) + 720_000).toISOString(),
            movementSeconds: 720, provisionalPlan: true, endsWithReportedStationArrival: true,
        } };
        route.steps[2] = { ...route.steps[2], type: "WALK", title: "도보",
            matchedTimeline: { startAt: route.departureTime, endAt: new Date(Date.parse(route.departureTime) + 30_000).toISOString(), movementSeconds: 30 } };
        route.steps[3] = { ...route.steps[3], type: "BUS", lineName: "402", boardingBusArrival: {
            arsId: "01001", cityCode: "1000", cityCodeNamespace: "ODSAY_CID", providerCode: "4", stationName: "승차 정류장",
        } };
        const previousLookups = jest.mocked(getBusArrivals).mock.calls.length;

        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact inlineStationRail />);
        });

        const transfer = renderer!.root.findByProps({ testID: "route-step-row-leg-1" });
        expect(transfer.props.accessibilityLabel).toContain("환승 도보 30초");
        const alighting = renderer!.root.findByProps({ testID: "route-step-alighting-clock-leg-0" });
        expect(alighting.props.accessibilityLabel).toContain("하차역 도착 보고");
        const bus = renderer!.root.findByProps({ testID: "route-step-row-leg-2" });
        expect(bus.findAllByType(Text).map(node => node.props.children)).not.toContain("미지원");
        expect(bus.props.accessibilityLabel).not.toContain("도착 정보를 확인할 수 없어요");
        expect(getBusArrivals).toHaveBeenCalledTimes(previousLookups);
    });

    it("shows each bus status once and retains a separately reported direction", async () => {
        const route = buildRouteInfo([{ durationMinutes: 12 }]);
        route.steps[1] = { ...route.steps[1], type: "BUS", lineName: "N37", boardingBusArrival: {
            arsId: "01001", cityCode: "1000", cityCodeNamespace: "ODSAY_CID", providerCode: "4", stationName: "승차 정류장",
        } };
        jest.mocked(getBusArrivals).mockResolvedValueOnce([
            { provider: "seoul-bus", kind: "BUS", arrivalStatus: "UNKNOWN", arrivalMessage: "출발대기" },
            { provider: "seoul-bus", kind: "BUS", arrivalStatus: "APPROACHING", arrivalMessage: "곧 도착", direction: "진관동 방면" },
        ]);

        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact />);
        });
        const row = renderer!.root.findByProps({ testID: "route-step-row-leg-0" });
        const texts = row.findAllByType(Text).map(node => node.props.children);
        expect(texts.filter(text => text === "출발대기")).toHaveLength(1);
        expect(texts.filter(text => text === "곧 도착")).toHaveLength(1);
        expect(texts).toContain("진관동 방면");
        expect(getBusArrivals).toHaveBeenCalledWith(expect.objectContaining({ cityCode: "1000", cityCodeNamespace: "ODSAY_CID" }));
    });

    it.each([
        { vehicle: "SUBWAY" as const, provider: "seoul-openapi", age: 100, ttl: 120, untilArrival: 510 },
        { vehicle: "BUS" as const, provider: "seoul-bus", age: 30, ttl: 45, untilArrival: 83 },
    ])("expires a cached $vehicle forecast before its expected arrival without another request", async ({ vehicle, provider, age, ttl, untilArrival }) => {
        const source = Date.parse("2026-11-20T02:39:35Z");
        const at = (offset: number) => new Date(source + offset * 1000).toISOString();
        jest.useFakeTimers().setSystemTime(new Date(at(age)));
        try {
            const route = buildRouteInfo([{ durationMinutes: 12 }]);
            if (vehicle === "BUS") {
                route.steps[1] = { ...route.steps[1], type: "BUS", lineName: "N37", boardingBusArrival: {
                    arsId: "01001", cityCode: "1000", cityCodeNamespace: "ODSAY_CID", providerCode: "4",
                } };
            }
            const lookup = jest.mocked(vehicle === "BUS" ? getBusArrivals : getSubwayArrivals);
            lookup.mockReset().mockResolvedValueOnce([{ provider, kind: vehicle, arrivalStatus: "IN_TRANSIT",
                destinationName: "검증 대상", sourceUpdatedAt: at(0), observedAt: at(age), expectedAt: at(untilArrival) }]);
            await act(async () => { renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact />); });
            const rendered = () => renderer!.root.findAllByType(Text).map(node => node.props.children).flat().join(" ");
            expect(rendered()).toContain("검증 대상행");
            await act(async () => { jest.advanceTimersByTime((ttl - age) * 1000 + 1); });
            expect(rendered()).not.toContain("검증 대상행");
            expect(rendered()).toContain("새 도착 정보를 기다리고 있어요.");
            expect(lookup).toHaveBeenCalledTimes(1);
        } finally {
            await act(async () => { renderer?.unmount(); });
            renderer = undefined;
            jest.useRealTimers();
        }
    });

    it("keeps the intercity mode badge and service grade readable on separate lines", async () => {
        const route = buildRouteInfo([]);
        route.steps.splice(1, 0, {
            id: "service", type: "INTERCITY_BUS", title: "인천공항1터미널",
            badgeText: "시외버스 · 우등", lineName: "우등", description: "85분 · 시간표 17:20 → 18:45",
        });
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact realtimeArrivalsActive={false} />);
        });

        const row = renderer!.root.findByProps({ testID: "route-step-row-service" });
        const text = row.findAllByType(Text).map(node => node.props.children);
        expect(text).toContain("시외버스");
        const description = row.findAllByType(Text).find(node =>
            node.props.children === "우등 · 85분 · 시간표 17:20 → 18:45"
        );
        expect(description).toBeDefined();
        expect(description?.props.numberOfLines).toBeUndefined();
    });

    it("shows intercity boarding and alighting clocks once instead of repeating the range", async () => {
        const route = buildRouteInfo([]);
        route.steps.splice(1, 0, { id: "train", type: "TRAIN", title: "서울", lineName: "KTX 1",
            alightingName: "부산", durationMinutes: 85, description: "부산까지 · 85분 · 시간표 11:05 → 12:30" });
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact inlineStationRail realtimeArrivalsActive={false} />);
        });
        const text = renderer!.root.findByProps({ testID: "route-step-row-train" }).findAllByType(Text).map(node => node.props.children);
        expect(text).toContain("KTX 1 · 85분");
        expect(text).toContain("11:05");
        expect(text).toContain("12:30");
        expect(text).not.toContain("KTX 1 · 85분 · 시간표 11:05 → 12:30");
    });

    it("hides legacy planning margins without shifting the boarding clock", async () => {
        const route = buildRouteInfo([]);
        route.steps.splice(1, 0,
            { id: "transfer", type: "TRANSFER", title: "환승", durationMinutes: 3 },
            { id: "buffer", type: "TRANSFER", title: "탑승 준비·대기 (준비 20분 포함)",
                description: "20분", durationMinutes: 20, journeyPhase: "BUFFER" },
            { id: "bus", type: "INTERCITY_BUS", title: "인천공항1터미널", lineName: "우등" });
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact realtimeArrivalsActive={false} />);
        });

        const transfer = renderer!.root.findByProps({ testID: "route-step-row-transfer" });
        expect(transfer.findAllByType("Ionicons" as never).map(icon => icon.props.name))
            .not.toContain("swap-horizontal-outline");
        expect(renderer!.root.findAllByProps({ testID: "route-step-row-buffer" })).toHaveLength(0);
        const bus = renderer!.root.findByProps({ testID: "route-step-row-bus" });
        expect(bus.findAllByType(Text).map(node => node.props.children)).toContain("11:28");
    });

    it("uses the predicted clock to age a delayed station response", () => {
        const expected = new Date(2026, 9, 4, 11, 5);
        const arrival = { provider: "seoul-openapi", kind: "SUBWAY", expectedAt: expected.toISOString(), waitMinutes: 5 };
        expect(getArrivalClockText(arrival)).toBe("11:05");
        expect(getArrivalWaitText(arrival, expected.getTime() - 110_000)).toBe("2분");
        expect(getArrivalWaitText(arrival, expected.getTime() + 10_000)).toBe("예정 시각 지남");
    });

    it("shows the ODsay timetable's boarding clocks even when the rough durations give different clocks", async () => {
        const route = buildRouteInfo([{ durationMinutes: 20 }, { durationMinutes: 10 }]);
        route.provider = "odsay";
        route.timeBasis = "provider_schedule";
        route.providerTimeBasis = "timetable";
        route.steps[1].scheduledRide = {
            boardingAt: new Date(2026, 9, 4, 11, 9).toISOString(),
            arrivalAt: new Date(2026, 9, 4, 11, 31).toISOString(),
        };
        route.steps[2].scheduledRide = {
            boardingAt: new Date(2026, 9, 4, 11, 38).toISOString(),
            arrivalAt: new Date(2026, 9, 4, 11, 49).toISOString(),
        };
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline routeInfo={route} compact inlineStationRail realtimeArrivalsActive={false} />
            );
        });
        const texts = renderer!.root.findAllByType(Text).map(node => node.props.children);
        expect(texts).toEqual(expect.arrayContaining(["11:09", "11:38", "12:10"]));
        expect(texts).not.toContain("11:25");
    });

    it("anchors a legacy relative wait to its source timestamp rather than the current clock", () => {
        const source = new Date(2026, 9, 4, 11, 0);
        const arrival = {
            provider: "seoul-openapi", kind: "SUBWAY", sourceUpdatedAt: source.toISOString(),
            observedAt: new Date(source.getTime() + 120_000).toISOString(), waitSeconds: 240, waitMinutes: 4,
        };
        expect(getArrivalClockText(arrival)).toBe("11:04");
        expect(getArrivalWaitText(arrival, source.getTime() + 180_000)).toBe("1분");
    });

    it("shows the matched wait separately on the next ride only", async () => {
        const route = buildRouteInfo([{ durationMinutes: 48 }, { durationMinutes: 8 }]);
        route.matchedTimeline = true;
        route.steps[1].matchedTimeline = {
            startAt: "2026-11-22T09:34:00Z", endAt: "2026-11-22T10:22:00Z", movementSeconds: 2880,
            startsWithStationArrivalPrediction: true, firstBoardingIntervalSeconds: 283,
        };
        route.steps[2].matchedTimeline = {
            startAt: "2026-11-22T10:26:30Z", endAt: "2026-11-22T10:34:00Z",
            movementSeconds: 450, transferWaitSeconds: 113,
        };
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline routeInfo={route} compact inlineStationRail realtimeArrivalsActive={false} />
            );
        });
        const first = renderer!.root.findByProps({ testID: "route-step-row-leg-0" });
        const second = renderer!.root.findByProps({ testID: "route-step-row-leg-1" });
        const label = "환승 대기 예상 1분 53초";
        const firstWait = "첫 승차 대기 약 4분 43초 (열차 도착 기준)";
        expect(first.findAllByType(Text).some(node => node.props.children === firstWait)).toBe(true);
        expect(second.findAllByType(Text).some(node => node.props.children === firstWait)).toBe(false);
        expect(first.findAllByType(Text).some(node => node.props.children === "열차 도착 예측")).toBe(true);
        expect(second.findAllByType(Text).some(node => node.props.children === "열차 도착 예측")).toBe(false);
        expect(first.findAllByType(Text).some(node => node.props.children === label)).toBe(false);
        expect(second.findAllByType(Text).some(node => node.props.children === label)).toBe(true);
    });

    it("shows the same station-to-station seconds once in the inline rail", async () => {
        const route = buildRouteInfo([{ durationMinutes: 8 }]);
        route.matchedTimeline = true;
        route.steps[1] = { ...route.steps[1], alightingName: "신림", passStops: [{ name: "신림" }],
            description: "신림까지 · 7분 30초", matchedTimeline: {
                startAt: "2026-11-19T15:10:30Z", endAt: "2026-11-19T15:18:00Z",
                movementSeconds: 450, transferWaitSeconds: 113,
            } };
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline routeInfo={route} compact inlineStationRail realtimeArrivalsActive={false} />
            );
        });
        const texts = renderer!.root.findAllByType(Text).map(node => node.props.children);
        expect(texts.filter(value => value === "7분 30초")).toHaveLength(1);
        expect(texts).not.toContain("8분");
    });

    it("renders delayed data using its source time even when the response just arrived", async () => {
        const source = new Date(2026, 9, 4, 11, 0);
        const expected = new Date(2026, 9, 4, 11, 5);
        const receipt = new Date(2026, 9, 4, 11, 1, 45);
        const now = jest.spyOn(Date, "now").mockReturnValue(receipt.getTime());
        jest.mocked(getSubwayArrivals).mockResolvedValueOnce([{
            provider: "seoul-openapi", kind: "SUBWAY", waitMinutes: 5,
            expectedAt: expected.toISOString(), sourceUpdatedAt: source.toISOString(), observedAt: receipt.toISOString(),
        }]);
        try {
            await act(async () => {
                renderer = TestRenderer.create(
                    <RouteStepTimeline routeInfo={buildRouteInfo([{ durationMinutes: 5 }])} compact inlineStationRail />
                );
            });
            const row = renderer!.root.findByProps({ testID: "route-step-row-leg-0" });
            for (const text of ["11:05", "4분", "갱신 지연", "1분 전 갱신"]) {
                expect(row.findAll(node => node.props.children === text).length).toBeGreaterThan(0);
            }
        } finally {
            now.mockRestore();
        }
    });

    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it.each([false, true])("distinguishes expired estimates from usable arrivals (upcoming: %s)", async (hasUpcoming) => {
        const now = Date.now();
        const passed = {
            provider: "test", kind: "SUBWAY", destinationName: "사당",
            expectedAt: new Date(now - 60_000).toISOString(),
        };
        const upcoming = {
            provider: "test", kind: "SUBWAY", destinationName: "오이도",
            expectedAt: new Date(now + 240_000).toISOString(),
        };
        const departed = { ...passed, arrivalStatus: "DEPARTED" as const };
        jest.mocked(getSubwayArrivals).mockResolvedValueOnce(hasUpcoming ? [passed, departed, upcoming] : [passed, departed]);
        const routeInfo = { ...buildRouteInfo([{ durationMinutes: 5 }]), departureTime: "" };
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={routeInfo} compact inlineStationRail />);
        });
        const hasText = (text: string) =>
            renderer!.root.findAll(node => node.props.children === text).length > 0;
        expect(hasText("실시간")).toBe(hasUpcoming);
        expect(hasText("오이도행")).toBe(hasUpcoming);
        expect(hasText("사당행")).toBe(false);
        expect(hasText("예정 시각 지남")).toBe(false);
        expect(hasText("갱신 지연")).toBe(false);
        expect(hasText("새 도착 정보를 기다리고 있어요.")).toBe(!hasUpcoming);
        expect(hasText("방금 갱신")).toBe(hasUpcoming);
        expect(hasText("--:--")).toBe(false);
    });

    it("does not show old station arrivals as live beside fresh forecasts in the recorded Sadang response", async () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-20T02:40:03.449480Z"));
        const old = { provider: "seoul-openapi", kind: "SUBWAY", arrivalStatus: "ARRIVED",
            destinationName: "사당", sourceUpdatedAt: "2026-11-20T02:34:03Z", expectedAt: "2026-11-20T02:34:03Z" };
        const fresh = { ...old, arrivalStatus: "PREVIOUS_STOP", destinationName: "오이도",
            sourceUpdatedAt: "2026-11-20T02:39:35Z", expectedAt: "2026-11-20T02:41:35Z" };
        jest.mocked(getSubwayArrivals).mockResolvedValueOnce([
            old, fresh, old, { ...fresh, arrivalStatus: "IN_TRANSIT", destinationName: "사당",
                expectedAt: "2026-11-20T02:48:05Z" },
        ]);
        const route = buildRouteInfo([{ durationMinutes: 5 }]);
        route.steps[1].title = "사당";
        try {
            await act(async () => {
                renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact inlineStationRail />);
            });
            const row = renderer!.root.findByProps({ testID: "route-step-row-leg-0" });
            const texts = row.findAllByType(Text).flatMap(node => typeof node.props.children === "string" ? [node.props.children] : []);
            expect(texts).not.toContain("도착");
            expect(texts).toEqual(expect.arrayContaining(["실시간", "오이도행", "사당행"]));
        } finally {
            now.mockRestore();
        }
    });

    it("lets a cached Seoul bus arrival expire before the next network refresh", async () => {
        jest.useFakeTimers();
        const now = Date.parse("2026-11-26T15:24:31Z");
        jest.setSystemTime(now);
        const route = buildRouteInfo([{ durationMinutes: 12 }]);
        route.steps[1] = { ...route.steps[1], type: "BUS", lineName: "N37", boardingBusArrival: {
            arsId: "01001", cityCode: "1000", cityCodeNamespace: "ODSAY_CID", stationName: "승차 정류장",
        } };
        const arrivals = jest.mocked(getBusArrivals);
        arrivals.mockClear().mockResolvedValueOnce([{
            provider: "seoul-bus", kind: "BUS", arrivalStatus: "ARRIVED",
            sourceUpdatedAt: new Date(now - 44_000).toISOString(), observedAt: new Date(now).toISOString(),
        }]);
        try {
            await act(async () => {
                renderer = TestRenderer.create(<RouteStepTimeline routeInfo={route} compact inlineStationRail />);
            });
            const hasArrivedText = () => renderer!.root.findByProps({ testID: "route-step-row-leg-0" })
                .findAllByType(Text).some(node => node.props.children === "도착");
            expect(hasArrivedText()).toBe(true);

            await act(async () => {
                jest.advanceTimersByTime(1001);
            });
            expect(hasArrivedText()).toBe(false);
            expect(arrivals).toHaveBeenCalledTimes(1);
        } finally {
            await act(async () => renderer?.unmount());
            renderer = undefined;
            jest.useRealTimers();
        }
    });

    it("pauses closed-sheet polling and retains the last arrival and open stops across a failed refresh", async () => {
        const route = buildRouteInfo([{ durationMinutes: 5 }]);
        route.steps[1].passStops = [{ name: "출발역" }, { name: "다음역" }];
        const arrivals = jest.mocked(getSubwayArrivals);
        arrivals.mockClear();
        let resolveArrivals!: (result: Awaited<ReturnType<typeof getSubwayArrivals>>) => void;
        arrivals.mockImplementationOnce(() => new Promise(resolve => { resolveArrivals = resolve; }));
        const update = async (active: boolean, routeInfo = route) => {
            await act(async () => {
                const content = <RouteStepTimeline
                    routeInfo={routeInfo} compact inlineStationRail realtimeArrivalsActive={active}
                    initialExpandedStepId="leg-0"
                />;
                if (renderer) renderer.update(content);
                else renderer = TestRenderer.create(content);
            });
        };
        const expectText = (text: string) => {
            expect(renderer!.root.findAll(node => node.props.children === text).length).toBeGreaterThan(0);
        };
        jest.useFakeTimers();
        try {
            await update(false);
            expect(arrivals).not.toHaveBeenCalled();
            await update(true);
            await update(true, { ...route, steps: route.steps.map(step => ({ ...step })) });
            await update(false);
            await act(async () => { jest.advanceTimersByTime(90_000); });
            await update(true);
            expect(arrivals).toHaveBeenCalledTimes(1);
            await act(async () => {
                resolveArrivals([{ provider: "test", kind: "SUBWAY", destinationName: "사당", waitMinutes: 6 }]);
            });
            expectText("사당행");
            expectText("실시간");

            await update(false);
            await act(async () => { jest.advanceTimersByTime(90_000); });
            expect(arrivals).toHaveBeenCalledTimes(1);
            arrivals.mockRejectedValueOnce(new Error("Provider unavailable"));
            await update(true);
            expect(arrivals).toHaveBeenCalledTimes(2);
            expectText("사당행");
            expectText("갱신 지연");
            expect(renderer!.root.findByProps({ testID: "route-step-disclosure-leg-0" })
                .props.accessibilityState.expanded).toBe(true);

            const changedRoute = { ...route, steps: route.steps.map(step => step.id === "leg-0"
                ? { ...step, title: "신림역" }
                : step) };
            await update(false, changedRoute);
            expect(arrivals).toHaveBeenCalledTimes(2);
            arrivals.mockResolvedValueOnce([]);
            await update(true, changedRoute);
            expect(arrivals).toHaveBeenLastCalledWith(expect.objectContaining({ stationName: "신림역" }));
            expect(renderer!.root.findAll(node => node.props.children === "사당행")).toHaveLength(0);
        } finally {
            await act(async () => renderer?.unmount());
            renderer = undefined;
            jest.useRealTimers();
        }
    });

    async function renderTimeline(routeInfo: RouteInfo, onStepPress?: () => void) {
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline
                    routeInfo={routeInfo}
                    compact
                    realtimeArrivalsEnabled={false}
                    onStepPress={onStepPress}
                />
            );
        });
    }

    function expectStepClock(stepId: string, expectedClock: string) {
        const row = renderer!.root.findByProps({ testID: `route-step-row-${stepId}` });
        expect(row.findAll(node => node.props.children === expectedClock).length).toBeGreaterThan(0);
    }

    it("accumulates raw seconds before formatting clocks when displayed legs add up to 68 minutes", async () => {
        const rawSeconds = [60, 2701, 181, 901, 57];
        const displayedMinutes = [1, 46, 4, 16, 1];
        const routeInfo = buildRouteInfo(rawSeconds.map((durationSeconds, index) => ({
            durationSeconds,
            durationMinutes: displayedMinutes[index],
        })));
        expect(displayedMinutes.reduce((sum, minutes) => sum + minutes, 0)).toBe(68);

        await renderTimeline(routeInfo);

        ["11:05", "11:06", "11:51", "11:54", "12:09"].forEach((clock, index) => {
            expectStepClock(`leg-${index}`, clock);
        });
        expectStepClock("destination", "12:10");
    });

    it("preserves zero-second steps even when their displayed duration is one minute", async () => {
        await renderTimeline(buildRouteInfo([
            { durationSeconds: 0, durationMinutes: 1 },
            { durationSeconds: 60, durationMinutes: 1 },
            { durationSeconds: 0, durationMinutes: 1 },
        ]));

        expectStepClock("leg-1", "11:05");
        expectStepClock("leg-2", "11:06");
        expectStepClock("destination", "11:06");
    });

    it.each([
        { states: ["error", "error"], status: "실시간 도착 조회 실패", mixed: false },
        { states: ["empty", "empty"], status: "실시간 도착 정보 없음", mixed: false },
        { states: ["error", "empty"], status: undefined, mixed: true },
        { states: [], status: undefined, mixed: false },
    ])("keeps one estimated-clock heading with distinct arrival states ($states)", async ({ states, status, mixed }) => {
        const arrivals = jest.mocked(getSubwayArrivals).mockReset();
        for (const state of states) {
            if (state === "error") arrivals.mockRejectedValueOnce(new Error("Arrival provider unavailable"));
            else arrivals.mockResolvedValueOnce([]);
        }
        const routeInfo = buildRouteInfo([{ durationMinutes: 16 }, { durationMinutes: 9 }]);
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline routeInfo={routeInfo} compact inlineStationRail
                showEstimatedClockHeading realtimeArrivalsEnabled={states.length > 0} />);
        });
        const text = renderer!.root.findAllByType(Text).map(node => node.props.children);
        expect(text.filter(value => typeof value === "string" && value.startsWith("구간별 예상 시각")))
            .toEqual([status ? `구간별 예상 시각 · ${status}` : "구간별 예상 시각"]);
        expect(text).not.toContain("경로 예상 시간 기준");
        expect(text.includes("실시간 도착 정보를 불러오지 못했어요.")).toBe(mixed);
        expect(text.includes("지금 확인할 수 있는 도착 예정이 없어요.")).toBe(mixed);
        expectStepClock("leg-0", "11:05");
        expectStepClock("leg-1", "11:21");
    });

    it("shows the input train clocks without ticket or booking text in the route row", async () => {
        const route = buildRouteInfo([{ durationSeconds: 3120, durationMinutes: 52 }]);
        route.steps[1] = { ...route.steps[1], type: "TRAIN", title: "수서", description: "공주까지 · 52분 · 승차권 입력 12:20 → 13:12 · 예매 상태 미검증" };
        await renderTimeline(route, () => undefined);
        const label = renderer!.root.findByProps({ testID: "route-step-row-leg-0" }).props.accessibilityLabel;
        expect(label).toContain("입력 시각 12:20");
        expect(label).not.toContain("승차권");
        expect(label).toContain("13:12");
        expect(label).not.toContain("예매 상태 미검증");
    });

    it("keeps minute-based timing for legacy steps without raw seconds", async () => {
        await renderTimeline(buildRouteInfo([1, 46, 4, 16, 1].map(durationMinutes => ({
            durationMinutes,
        }))));

        expectStepClock("leg-2", "11:52");
        expectStepClock("destination", "12:13");
    });

    it("preserves a genuine section-total difference instead of forcing the final clock to the route total", async () => {
        await renderTimeline(buildRouteInfo([
            { durationSeconds: 3900, durationMinutes: 65 },
            { durationSeconds: 180, durationMinutes: 3 },
        ]));

        expectStepClock("leg-1", "12:10");
        expectStepClock("destination", "12:13");
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
        "falls back to minutes when raw seconds are invalid: %p",
        async durationSeconds => {
            await renderTimeline(buildRouteInfo([
                { durationSeconds, durationMinutes: 3 },
                { durationSeconds: 60, durationMinutes: 1 },
            ]));

            expectStepClock("leg-1", "11:08");
            expectStepClock("destination", "11:09");
        },
    );
});
