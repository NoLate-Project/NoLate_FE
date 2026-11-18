import React from "react";
import { AccessibilityInfo, LayoutAnimation, StyleSheet, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import RouteStepTimeline from "../src/modules/schedule/components/route/RouteStepTimeline";
import { getRouteStepColor, type RouteInfo } from "../src/modules/schedule/routeInfo";

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

it("suppresses a repeated 수도권 line label in the standard expanded timeline", () => {
    const dimensions = jest.spyOn(require("react-native"), "useWindowDimensions")
        .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    let renderer: ReactTestRenderer | undefined;
    try {
        act(() => { renderer = TestRenderer.create(<RouteStepTimeline routeInfo={routeInfo} compact
            stepDisplayNames={{ "subway-leg": "수도권 4호선", "bus-leg": "643번 강남행" }} />); });
        expect(renderer!.root.findAllByProps({ testID: "route-step-full-name-subway-leg" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ testID: "route-step-full-name-bus-leg" }).props.children).toBe("643번 강남행");
    } finally {
        if (renderer) act(() => renderer?.unmount());
        dimensions.mockRestore();
    }
});

describe("RouteStepTimeline transit disclosure", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    it("shows the station count as a separate control and retains stop selection on the map", async () => {
        const onStepPress = jest.fn();
        const onPassStopPress = jest.fn();
        const layoutAnimation = jest.spyOn(LayoutAnimation, "configureNext").mockImplementation(() => undefined);
        const step = { ...routeInfo.steps[0], stationCount: 1, durationMinutes: 20 };
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline
                routeInfo={{ ...routeInfo, steps: [step, routeInfo.steps[1]] }}
                compact inlineStationRail realtimeArrivalsEnabled={false}
                canShowPassStopOnMap={() => true} onStepPress={onStepPress} onPassStopPress={onPassStopPress}
            />);
        });
        const disclosure = () => renderer!.root.findByProps({ testID: "route-step-disclosure-subway-leg" });
        expect(disclosure().props.accessibilityLabel).toContain("1정거장 · 20분");
        await act(async () => disclosure().props.onPress());
        expect(disclosure().props.accessibilityState.expanded).toBe(true);
        expect(layoutAnimation).toHaveBeenLastCalledWith(expect.objectContaining({
            duration: 200,
            create: undefined,
            update: { type: LayoutAnimation.Types.easeOut },
        }));
        expect(renderer!.root.findAll(node => node.props.entering?.frames?.[0]?.opacity === 0.55).length)
            .toBeGreaterThan(0);
        expect(onStepPress).not.toHaveBeenCalled();
        act(() => renderer!.root.findByProps({ testID: "route-step-map-stop-subway-leg-1" }).props.onPress());
        expect(onPassStopPress).toHaveBeenCalledWith("subway-leg", 1);
    });

    it("reveals the first stop without animation after Reduce Motion changes while mounted", async () => {
        let updateMotionPreference!: (enabled: boolean) => void;
        jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((
            (_event: "reduceMotionChanged", listener: (enabled: boolean) => void) => {
                updateMotionPreference = listener;
                return { remove: jest.fn() };
            }
        ) as unknown as typeof AccessibilityInfo.addEventListener);
        const layoutAnimation = jest.spyOn(LayoutAnimation, "configureNext").mockImplementation(() => undefined);
        const onRevealFirstStop = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline routeInfo={routeInfo} compact realtimeArrivalsEnabled={false}
                    onRevealFirstStop={onRevealFirstStop} />,
                { createNodeMock: () => ({}) },
            );
        });
        await act(async () => { updateMotionPreference(true); });
        await act(async () => {
            renderer!.root.findByProps({ testID: "route-step-disclosure-subway-leg" }).props.onPress();
        });
        act(() => renderer!.root.findByProps({ testID: "route-step-first-stop-subway-leg" }).props.onLayout());
        expect(onRevealFirstStop.mock.calls[0][1]).toBe(false);
        expect(layoutAnimation).not.toHaveBeenCalled();
    });

    it("keeps a saved alighting stop and clock visible with the intermediate stations folded", async () => {
        const step = {
            ...routeInfo.steps[0],
            title: "서울역",
            alightingName: "사당역 (4호선)",
            durationMinutes: 20,
            stationCount: 2,
            passStops: [{ name: "서울역 (4호선)" }, { name: "동작역" }, { name: "사당역" }],
        };
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline
                routeInfo={{ ...routeInfo, steps: [step] }}
                compact inlineStationRail realtimeArrivalsEnabled={false}
            />);
        });
        const root = renderer!.root;
        expect(root.findAllByProps({ children: "사당역 하차" }).length).toBeGreaterThan(0);
        const alightingClock = root.findByProps({ testID: "route-step-alighting-clock-subway-leg" });
        expect(root.findAllByProps({ testID: "route-step-alighting-connector-subway-leg" })).toHaveLength(0);
        const localArrival = new Date(Date.parse(routeInfo.departureTime) + 20 * 60_000);
        expect(alightingClock.props.children).toBe(
            [localArrival.getHours(), localArrival.getMinutes()].map(value => String(value).padStart(2, "0")).join(":"),
        );
        expect(root.findAllByProps({ children: "동작역" })).toHaveLength(0);
        await act(async () => root.findByProps({ testID: "route-step-disclosure-subway-leg" }).props.onPress());
        expect(root.findAllByProps({ children: "동작역" }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ children: "서울역 (4호선)" })).toHaveLength(0);
        expect(root.findAllByProps({ children: "사당역" })).toHaveLength(0);
    });

    it("describes the available intermediate stations when the total is missing and marks alighting separately", async () => {
        const onPassStopPress = jest.fn();
        const step = {
            ...routeInfo.steps[0],
            title: "서울역",
            alightingName: "사당역 (4호선)",
            durationMinutes: 16,
            passStops: [{ name: "서울역 (4호선)" }, { name: "동작역" }, { name: "사당역" }],
        };
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline
                routeInfo={{ ...routeInfo, steps: [step, routeInfo.steps[1]] }}
                compact inlineStationRail realtimeArrivalsEnabled={false}
                canShowPassStopOnMap={(_step, index) => index === 1}
                onPassStopPress={onPassStopPress}
            />);
        });
        const root = renderer!.root;
        const disclosure = root.findByProps({ testID: "route-step-disclosure-subway-leg" });
        expect(disclosure.props.accessibilityLabel).toContain("경유역 1곳 · 16분");
        await act(async () => disclosure.props.onPress());
        expect(root.findAllByProps({ testID: "route-step-map-stop-subway-leg-0" })).toHaveLength(0);
        expect(root.findAllByProps({ testID: "route-step-map-stop-subway-leg-2" })).toHaveLength(0);
        const intermediate = root.findByProps({ testID: "route-step-map-stop-subway-leg-1" });
        expect(intermediate.props.accessibilityLabel).toBe("동작역");
        act(() => intermediate.props.onPress());
        expect(onPassStopPress).toHaveBeenCalledWith("subway-leg", 1);
        expect(root.findByProps({ testID: "route-step-alighting-marker-subway-leg" })
            .findByProps({ name: "checkmark-outline" }).props.accessible).toBe(false);
        expect(StyleSheet.flatten(
            root.findByProps({ testID: "route-step-alighting-connector-subway-leg" }).props.style,
        )).toMatchObject({ width: 5, backgroundColor: "#D1D5DB" });
    });

    it("keeps a named boarding stop and shows the alighting stop once for legacy labels", async () => {
        const step = {
            ...routeInfo.steps[1],
            title: "합성 승차",
            lineName: "합성",
            alightingName: "합성 하차",
            description: "합성 하차까지 · 2정거장 · 5분",
            passStops: undefined,
        };
        await act(async () => {
            renderer = TestRenderer.create(<RouteStepTimeline
                routeInfo={{ ...routeInfo, steps: [step] }}
                compact inlineStationRail realtimeArrivalsEnabled={false}
            />);
        });
        const countText = (value: string) => renderer!.root.findAllByType(Text).filter(
            node => node.props.children === value,
        ).length;
        expect(countText("합성 하차")).toBe(1);
        expect(countText("합성 하차 하차")).toBe(0);
        expect(countText("합성 하차까지")).toBe(0);
        expect(countText("2정거장 · 5분")).toBe(1);
        expect(countText(" 승차")).toBe(1);
    });

    it("keeps a focused leg closed until the user opens it or selects a stop", async () => {
        const timeline = (
            <RouteStepTimeline
                routeInfo={routeInfo}
                selectedStepId="bus-leg"
                preserveStopDisclosureOnLegFocus
                compact
                realtimeArrivalsEnabled={false}
            />
        );
        await act(async () => { renderer = TestRenderer.create(timeline); });

        const disclosure = () => renderer!.root.findByProps({ testID: "route-step-disclosure-bus-leg" });
        expect(disclosure().props.accessibilityState).toEqual({ expanded: false });

        await act(async () => {
            renderer!.update(React.cloneElement(timeline, {
                selectedPassStop: { stepId: "bus-leg", stopIndex: 1 },
            }));
        });
        expect(disclosure().props.accessibilityState).toEqual({ expanded: true });
        expect(renderer!.root.findByProps({ testID: "route-step-selected-stop-bus-leg" }).props)
            .toMatchObject({ accessibilityLabel: "강남역", accessibilityState: { selected: true } });
    });

    it("moves the pin feedback to the latest stop and keeps its selection when motion is reduced", async () => {
        let setReduceMotion!: (enabled: boolean) => void;
        jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((
            (_event: "reduceMotionChanged", listener: (enabled: boolean) => void) => {
                setReduceMotion = listener;
                return { remove: jest.fn() };
            }
        ) as unknown as typeof AccessibilityInfo.addEventListener);
        const render = (stopIndex: number) => (
            <RouteStepTimeline routeInfo={routeInfo} compact realtimeArrivalsEnabled={false}
                initialExpandedStepId="bus-leg" selectedPassStop={{ stepId: "bus-leg", stopIndex }}
                canShowPassStopOnMap={() => true} onPassStopPress={jest.fn()} />
        );
        const selected = () => renderer!.root.findByProps({ testID: "route-step-selected-stop-bus-leg" });
        const pinMotion = () => selected().findAll(node => node.props.entering?.frames?.[0]?.transform);
        await act(async () => { renderer = TestRenderer.create(render(0)); });
        expect(pinMotion().length).toBeGreaterThan(0);
        const pinBadge = pinMotion()[0]!;
        expect(StyleSheet.flatten(pinBadge.props.style)).toMatchObject({ width: 24, height: 24, borderRadius: 12 });
        expect(pinBadge.props.entering).toMatchObject({ duration: 160, frames: {
            0: { transform: expect.arrayContaining([{ rotateX: "22deg" }]) },
        }});

        await act(async () => { renderer!.update(render(1)); });
        expect(selected().props.accessibilityLabel).toBe("강남역");
        expect(pinMotion().length).toBeGreaterThan(0);
        expect(renderer!.root.findByProps({ testID: "route-step-map-stop-bus-leg-0" })
            .findAll(node => node.props.entering?.frames?.[0]?.transform)).toHaveLength(0);

        await act(async () => { setReduceMotion(true); });
        expect(selected().props.accessibilityState).toEqual({ selected: true });
        expect(pinMotion()).toHaveLength(0);
    });

    it("matches the selected stop background to its line in subway and bus steps", async () => {
        for (const step of routeInfo.steps) {
            await act(async () => {
                const content = <RouteStepTimeline routeInfo={routeInfo}
                    compact realtimeArrivalsEnabled={false}
                    preserveStopDisclosureOnLegFocus
                    selectedPassStop={{ stepId: step.id, stopIndex: 1 }}
                    canShowPassStopOnMap={() => true} onPassStopPress={jest.fn()} />;
                if (renderer) renderer.update(content);
                else renderer = TestRenderer.create(content);
            });
            const selected = renderer!.root.findByProps({ testID: `route-step-selected-stop-${step.id}` });
            expect(selected.findAll(node => {
                const style = StyleSheet.flatten(node.props.style);
                return style?.backgroundColor === getRouteStepColor(step) && style?.opacity === 0.12;
            }).length).toBeGreaterThan(0);
            expect(selected.findAll(node => node.props.name === "location-outline" && node.props.color === "#FFFFFF").length)
                .toBeGreaterThan(0);
        }
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
        const onRevealFirstStop = jest.fn();
        const firstStopView = {};
        const layoutAnimationSpy = jest
            .spyOn(LayoutAnimation, "configureNext")
            .mockImplementation(() => undefined);
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteStepTimeline
                    routeInfo={routeInfo}
                    onStepPress={onStepPress}
                    onRevealFirstStop={onRevealFirstStop}
                    compact
                    realtimeArrivalsEnabled={false}
                />,
                { createNodeMock: () => firstStopView },
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
        const firstStop = renderer!.root.findByProps({ testID: `route-step-first-stop-${stepId}` });
        expect(onRevealFirstStop).not.toHaveBeenCalled();
        act(() => firstStop.props.onLayout());
        expect(onRevealFirstStop).toHaveBeenCalledTimes(1);
        expect(onRevealFirstStop.mock.calls[0][1]).toBe(true);
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
        expect(onRevealFirstStop).toHaveBeenCalledTimes(1);
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
