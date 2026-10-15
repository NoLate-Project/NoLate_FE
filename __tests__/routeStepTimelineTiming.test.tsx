import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import RouteStepTimeline from "../src/modules/schedule/components/route/RouteStepTimeline";
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
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
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

    it("preserves the ticket label and both fixed train clocks in the rendered row", async () => {
        const route = buildRouteInfo([{ durationSeconds: 3120, durationMinutes: 52 }]);
        route.steps[1] = { ...route.steps[1], type: "TRAIN", title: "수서", description: "공주까지 · 52분 · 승차권 입력 12:20 → 13:12 · 예매 상태 미검증" };
        await renderTimeline(route, () => undefined);
        const label = renderer!.root.findByProps({ testID: "route-step-row-leg-0" }).props.accessibilityLabel;
        expect(label).toContain("승차권 입력 12:20");
        expect(label).toContain("13:12");
        expect(label).toContain("예매 상태 미검증");
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
