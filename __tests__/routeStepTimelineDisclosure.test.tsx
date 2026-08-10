import React from "react";
import { LayoutAnimation } from "react-native";
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
    id: "transit-disclosure-route",
    originName: "서울역",
    destinationName: "강남역",
    totalDurationMinutes: 36,
    departureTime: "2026-08-10T11:24:00+09:00",
    arrivalTime: "2026-08-10T12:00:00+09:00",
    timeBasis: "estimated",
    steps: [
        {
            id: "subway-leg",
            type: "SUBWAY",
            title: "서울역 → 사당역",
            lineName: "4호선",
            passStops: [
                { name: "서울역" },
                { name: "사당역" },
            ],
        },
        {
            id: "bus-leg",
            type: "BUS",
            title: "사당역 → 강남역",
            lineName: "643번",
            passStops: [
                { name: "사당역" },
                { name: "강남역" },
            ],
        },
    ],
};

describe("RouteStepTimeline transit disclosure", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    it.each([
        ["subway-leg", "4호선", "사당역"],
        ["bus-leg", "643번", "강남역"],
    ])("keeps the sheet owner callback isolated when %s stops are toggled", async (
        stepId,
        lineLabel,
        stopName,
    ) => {
        const onStepPress = jest.fn();
        const layoutAnimationSpy = jest
            .spyOn(LayoutAnimation, "configureNext")
            .mockImplementation(() => undefined);
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline
                    routeInfo={routeInfo}
                    onStepPress={onStepPress}
                    compact
                    realtimeArrivalsEnabled={false}
                />
            );
        });

        const disclosureTestId = `route-step-disclosure-${stepId}`;
        expect(renderer!.root.findByProps({ testID: disclosureTestId }).props).toMatchObject({
            accessibilityLabel: `${lineLabel} 경유지 보기`,
            accessibilityState: { expanded: false },
        });

        await act(async () => {
            renderer!.root.findByProps({ testID: disclosureTestId }).props.onPress();
        });

        expect(onStepPress).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ testID: disclosureTestId }).props).toMatchObject({
            accessibilityLabel: `${lineLabel} 경유지 접기`,
            accessibilityState: { expanded: true },
        });
        expect(renderer!.root.findAll((node) => node.props.children === stopName).length)
            .toBeGreaterThan(0);
        expect(layoutAnimationSpy).toHaveBeenCalledTimes(1);
        expect(layoutAnimationSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            duration: 200,
            create: expect.objectContaining({
                property: LayoutAnimation.Properties.opacity,
            }),
            update: expect.objectContaining({
                type: LayoutAnimation.Types.easeInEaseOut,
            }),
        }));

        await act(async () => {
            renderer!.root.findByProps({ testID: disclosureTestId }).props.onPress();
        });

        expect(onStepPress).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ testID: disclosureTestId }).props.accessibilityState)
            .toEqual({ expanded: false });
        expect(layoutAnimationSpy).toHaveBeenCalledTimes(2);
        expect(layoutAnimationSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            duration: 170,
        }));

        await act(async () => {
            renderer!.root.findByProps({ testID: `route-step-row-${stepId}` }).props.onPress();
        });

        expect(onStepPress).toHaveBeenCalledTimes(1);
        expect(onStepPress).toHaveBeenCalledWith(expect.objectContaining({ id: stepId }));
        expect(layoutAnimationSpy).toHaveBeenCalledTimes(2);
    });
});
