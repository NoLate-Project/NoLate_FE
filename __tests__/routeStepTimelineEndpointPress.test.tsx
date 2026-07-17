import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import RouteStepTimeline from "../src/modules/schedule/components/route/RouteStepTimeline";
import type { RouteInfo } from "../src/modules/schedule/routeInfo";

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

const routeInfo: RouteInfo = {
    id: "endpoint-press-route",
    originName: "서울역",
    destinationName: "강남역",
    totalDurationMinutes: 30,
    departureTime: "2026-07-16T13:00:00.000Z",
    arrivalTime: "2026-07-16T13:30:00.000Z",
    timeBasis: "estimated",
    steps: [
        {
            id: "origin",
            type: "ORIGIN",
            title: "서울역",
            coordinates: [{ latitude: 37.5547, longitude: 126.9707 }],
        },
        {
            id: "leg-0",
            type: "WALK",
            title: "도보",
            coordinates: [
                { latitude: 37.5547, longitude: 126.9707 },
                { latitude: 37.553, longitude: 126.978 },
            ],
        },
        {
            id: "destination",
            type: "DESTINATION",
            title: "강남역",
            coordinates: [{ latitude: 37.4979, longitude: 127.0276 }],
        },
    ],
};

function findStepRows(renderer: ReactTestRenderer) {
    return renderer.root.findAll((node) => (
        typeof node.props.onPress === "function"
        && typeof node.props.disabled === "boolean"
    ));
}

describe("RouteStepTimeline endpoint presses", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("keeps endpoint rows disabled by default", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline routeInfo={routeInfo} onStepPress={jest.fn()} />
            );
        });

        const rows = findStepRows(renderer!);
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => row.props.disabled)).toEqual([true, false, true]);
        expect(rows.map((row) => row.props.accessibilityRole)).toEqual([
            undefined,
            "button",
            undefined,
        ]);
    });

    it("forwards origin and destination taps when endpoint presses are enabled", async () => {
        const onStepPress = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline
                    routeInfo={routeInfo}
                    onStepPress={onStepPress}
                    allowEndpointPress
                />
            );
        });

        const rows = findStepRows(renderer!);
        expect(rows.map((row) => row.props.disabled)).toEqual([false, false, false]);
        expect(rows.map((row) => row.props.accessibilityRole)).toEqual([
            "button",
            "button",
            "button",
        ]);
        expect(rows[0].props.accessibilityLabel).toBe("출발, 서울역");
        expect(rows[2].props.accessibilityLabel).toBe("도착, 강남역");
        expect(rows.map((row) => row.props.accessibilityHint)).toEqual([
            "지도에서 이 지점을 표시합니다",
            "지도에서 이 지점을 표시합니다",
            "지도에서 이 지점을 표시합니다",
        ]);

        await act(async () => {
            rows[0].props.onPress();
            rows[2].props.onPress();
        });

        expect(onStepPress.mock.calls.map(([step]) => step.type)).toEqual([
            "ORIGIN",
            "DESTINATION",
        ]);
    });

    it("keeps every row disabled when no press handler exists", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline routeInfo={routeInfo} allowEndpointPress />
            );
        });

        const rows = findStepRows(renderer!);
        expect(rows.map((row) => row.props.disabled)).toEqual([true, true, true]);
        expect(rows.map((row) => row.props.accessibilityRole)).toEqual([
            undefined,
            undefined,
            undefined,
        ]);
    });
});
