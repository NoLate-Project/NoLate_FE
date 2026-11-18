import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useReducedMotion } from "react-native-reanimated";

import TransitRouteProgressBar from "../src/modules/schedule/components/route/TransitRouteProgressBar";
import type { TransitRouteProgressSegment } from "../src/modules/schedule/transitRouteProgress";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: "Ionicons",
}));

const segments: TransitRouteProgressSegment[] = [
    { key: "walk-0", label: "3분", kind: "WALK", minutes: 3, color: "#4F5760", flex: 3, isRide: false },
    { key: "subway-1", label: "16분", lineLabel: "4호선", kind: "SUBWAY", minutes: 16, color: "#00A4E3", flex: 16, isRide: true },
    { key: "subway-2", label: "8분", lineLabel: "2호선", kind: "SUBWAY", minutes: 8, color: "#00B140", flex: 8, isRide: true },
    { key: "walk-3", label: "4분", kind: "WALK", minutes: 4, color: "#4F5760", flex: 4, isRide: false },
];

describe("TransitRouteProgressBar", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("shows terminal waiting with its own clock icon and caption in the collapsed summary", async () => {
        const wait: TransitRouteProgressSegment = {
            key: "wait", label: "20분", kind: "WAIT", minutes: 20, color: "#4F5760", flex: 20, isRide: false,
        };
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={[segments[0], wait, segments[1]]} compact labelledSummary alignedSummary />
            );
        });

        expect(renderer!.root.findAllByType("Ionicons" as never).map(icon => icon.props.name))
            .toEqual(["walk-outline", "time-outline", "train-outline"]);
        expect(renderer!.root.findAllByType(Text).map(node => node.props.children)).toContain("대기");
        expect(renderer!.root.findByProps({ accessibilityLabel: "도보 3분, 대기 20분, 4호선 16분" })).toBeTruthy();
    });

    it("renders the same compact mode nodes used by route detail screens", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={segments} isDark compact />
            );
        });

        const decorativeIcons = renderer!.root.findAllByType("Ionicons" as never);
        expect(decorativeIcons).toHaveLength(3);
        decorativeIcons.forEach((icon) => {
            expect(icon.props.accessible).toBe(false);
            expect(icon.props.importantForAccessibility).toBe("no");
            expect(icon.props.color).toBe("#FFFFFF");
        });
        expect(renderer!.root.findByProps({
            accessibilityLabel: "3분, 4호선 16분, 2호선 8분, 4분",
        })).toBeTruthy();
        expect(renderer!.root.findAllByType(Text).map((node) => node.props.children)).toEqual(
            expect.arrayContaining(["3분", "16분", "4호선", "8분", "2호선", "4분"])
        );
    });

    it("reserves registration-screen widths and pins short edge durations", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={segments} compact />
            );
        });

        const viewStyles = renderer!.root.findAllByType(View).map((node) => (
            StyleSheet.flatten(node.props.style)
        ));
        expect(viewStyles).toEqual(expect.arrayContaining([
            expect.objectContaining({
                height: 16,
                backgroundColor: "#EEF3F8",
                borderColor: "#DDE6F0",
                overflow: "visible",
            }),
            expect.objectContaining({ minWidth: 52 }),
            expect.objectContaining({ minWidth: 44 }),
            expect.objectContaining({ width: 30, left: -2, top: -8 }),
        ]));

        const leadingWalk = renderer!.root.findAllByType(Text).find((node) => node.props.children === "3분");
        expect(StyleSheet.flatten(leadingWalk!.props.style)).toEqual(expect.objectContaining({
            position: "absolute",
            left: 0,
            top: 2,
            marginLeft: 32,
        }));
    });

    it("keeps the original noncompact presentation", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={segments} isDark />
            );
        });

        expect(renderer!.root.findAllByType("Ionicons" as never)).toHaveLength(0);
        const track = renderer!.root.findAllByType(View).find((node) => {
            const style = StyleSheet.flatten(node.props.style);
            return style?.height === 18 && style?.overflow === "hidden";
        });
        expect(track).toBeTruthy();
    });

    it("keeps short rides readable outside the proportional track", async () => {
        const mixedSegments: TransitRouteProgressSegment[] = [...segments, {
            key: "bus-4", label: "3분", lineLabel: "361", kind: "BUS", minutes: 3,
            color: "#0074BA", flex: 3, isRide: true,
        }];
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={mixedSegments} compact trackOnly labelledSummary focusedSegmentIndex={4} />
            );
        });
        const { root } = renderer!;
        const selectedBus = root.findByProps({ testID: "route-summary-leg-bus-4" });
        const findSelection = (leg: typeof selectedBus) => leg.findAllByType(View).find(view =>
            StyleSheet.flatten(view.props.style)?.backgroundColor === "rgba(28,57,92,0.09)");
        expect(findSelection(selectedBus)).toBeDefined();
        expect(findSelection(root.findByProps({ testID: "route-summary-leg-subway-1" }))).toBeUndefined();
        const rideIcons = root.findAllByType("Ionicons" as never);
        expect(rideIcons.map(icon => icon.props.size)).toEqual([16, 16, 16]);
        expect(rideIcons.map(icon => [icon.props.name, icon.props.color])).toEqual([
            ["train-outline", "#FFFFFF"],
            ["train-outline", "#FFFFFF"],
            ["bus-outline", "#FFFFFF"],
        ]);
        const track = root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style))
            .find(style => style?.height === 6);
        expect(track).toEqual(expect.objectContaining({ borderRadius: 3, overflow: "hidden", gap: 2 }));
        expect(root.findByProps({ accessibilityLabel: "도보 3분, 4호선 16분, 2호선 8분, 환승 도보 4분, 361 3분" })).toBeTruthy();
    });

    it("keeps a circular marker at each leg start and wraps without dropping short legs", async () => {
        const dimensions = jest.spyOn(require("react-native"), "useWindowDimensions")
            .mockReturnValue({ ...Dimensions.get("window"), fontScale: 1 });
        const bus: TransitRouteProgressSegment = {
            key: "bus", label: "3분", lineLabel: "361", kind: "BUS", minutes: 3,
            color: "#0074BA", flex: 3, isRide: true,
        };
        try {
            await act(async () => {
                renderer = TestRenderer.create(<TransitRouteProgressBar
                    segments={[segments[0], segments[1], bus]} labelledSummary alignedSummary
                />);
            });
            const summary = renderer!.root.findByProps({ accessibilityLabel: "도보 3분, 4호선 16분, 361 3분" });
            act(() => summary.props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
            expect(summary.findAllByType(Text).map(node => node.props.children)).toEqual([
                "3분", "16분", "4호선", "3분", "361",
            ]);
            const legWidth = (key: string) => parseFloat(StyleSheet.flatten(summary.findByProps({
                testID: `route-summary-stop-${key}`,
            }).props.style).width);
            expect(legWidth("subway-1")).toBeGreaterThan(legWidth("walk-0"));
            expect(legWidth("walk-0")).toBeCloseTo(legWidth("bus"));
            expect(legWidth("walk-0") + legWidth("subway-1") + legWidth("bus")).toBeCloseTo(100);
            const subway = summary.findByProps({ testID: "route-summary-stop-subway-1" });
            const subwayStyles = subway.findAllByType(View).map(node => StyleSheet.flatten(node.props.style));
            expect(subwayStyles).toEqual(expect.arrayContaining([
                expect.objectContaining({ height: 6, left: 0, right: 0 }),
                expect.objectContaining({ width: 20, height: 20 }),
                expect.objectContaining({ width: 36, paddingHorizontal: 3 }),
            ]));
            act(() => summary.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
            const markedLegs = ["walk-0", "subway-1", "bus"].map(key =>
                summary.findByProps({ testID: `route-summary-stop-${key}` }));
            expect(markedLegs.map(leg => leg.findAllByType("Ionicons" as never)[0].props.name))
                .toEqual(["walk-outline", "train-outline", "bus-outline"]);
            expect(markedLegs[0].parent).not.toBe(markedLegs[2].parent);
            expect(markedLegs[1].findAllByType("Ionicons" as never).map(icon => icon.props.name))
                .toEqual(["train-outline", "return-down-back-outline"]);
            expect(markedLegs.map(leg => StyleSheet.flatten(leg.props.style).width))
                .toEqual(["50%", "50%", "50%"]);
        } finally {
            dimensions.mockRestore();
        }
    });

    it.each([false, true])("uses separate line colors for captions and white symbols (dark: %s)", async isDark => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={segments} isDark={isDark} labelledSummary alignedSummary />,
            );
        });
        const captionColor = (label: string) => StyleSheet.flatten(
            renderer!.root.findAllByType(Text).find(node => node.props.children === label)!.props.style,
        ).color;
        expect(captionColor("4호선")).not.toBe(captionColor("2호선"));
        expect(captionColor("4호선")).not.toBe(captionColor("16분"));
        expect(renderer!.root.findByProps({ testID: "route-summary-stop-subway-1" })
            .findAllByType("Ionicons" as never)[0].props.color).toBe("#FFFFFF");
    });

    it("keeps the train number together without widening every transfer segment", async () => {
        const dimensions = jest.spyOn(require("react-native"), "useWindowDimensions")
            .mockReturnValue({ ...Dimensions.get("window"), fontScale: 1 });
        const transitLegs: TransitRouteProgressSegment[] = [
            ...segments,
            { ...segments[1], key: "srt", lineLabel: "SRT 615", kind: "TRAIN", label: "47분", minutes: 47, flex: 47 },
            { ...segments[0], key: "transfer" },
            { ...segments[2], key: "bus", kind: "BUS", lineLabel: "31" },
        ];
        try {
            await act(async () => {
                renderer = TestRenderer.create(<TransitRouteProgressBar segments={transitLegs} labelledSummary alignedSummary />);
            });
            const root = renderer!.root;
            const summary = root.findByProps({ accessibilityLabel: "도보 3분, 4호선 16분, 2호선 8분, 환승 도보 4분, SRT 615 47분, 환승 도보 3분, 31 8분" });
            act(() => summary.props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
            const stop = (key: string) => root.findByProps({ testID: `route-summary-stop-${key}` });
            const caption = (key: string, text: string) => StyleSheet.flatten(
                stop(key).findAllByType(Text).find(node => node.props.children === text)!.parent!.props.style,
            );
            expect(caption("srt", "SRT 615").width).toBeGreaterThanOrEqual(55);
            expect(caption("bus", "31").width).toBe(36);
            expect(stop("walk-0").parent).toBe(stop("bus").parent);
            const widths = transitLegs.map(leg => parseFloat(StyleSheet.flatten(stop(leg.key).props.style).width));
            expect(widths.reduce((total, width) => total + width, 0)).toBeCloseTo(100);
        } finally {
            dimensions.mockRestore();
        }
    });

    it("wraps the marker row before a long rail name loses space at large text sizes", async () => {
        const dimensions = jest.spyOn(require("react-native"), "useWindowDimensions")
            .mockReturnValue({ ...Dimensions.get("window"), fontScale: 2 });
        const rail = { ...segments[1], lineLabel: "수인분당선" };
        try {
            await act(async () => {
                renderer = TestRenderer.create(
                    <TransitRouteProgressBar segments={[segments[0], rail, segments[3]]} labelledSummary alignedSummary />,
                );
            });
            const root = renderer!.root;
            const summary = root.findByProps({ accessibilityLabel: "도보 3분, 수인분당선 16분, 도보 4분" });
            act(() => summary.props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
            const marker = root.findByProps({ testID: "route-summary-stop-subway-1" });
            const arrival = root.findByProps({ testID: "route-summary-stop-walk-3" });
            expect(marker.parent).not.toBe(arrival.parent);
            expect(StyleSheet.flatten(marker.props.style).width).toBe("50%");
            expect(marker.findAllByType(Text).map(node => node.props.children)).toEqual(["16분", "수인분당선"]);
        } finally {
            dimensions.mockRestore();
        }
    });

    it("gives each ride a full row and renders its duration in the same text at accessibility sizes", async () => {
        const useDimensions = jest.spyOn(require("react-native"), "useWindowDimensions")
            .mockReturnValue({ ...Dimensions.get("window"), fontScale: 2 });
        try {
            await act(async () => {
                renderer = TestRenderer.create(<TransitRouteProgressBar segments={segments} labelledSummary />);
            });
            const labels = renderer!.root.findAllByType(Text);
            expect(labels.map(label => React.Children.toArray(label.props.children).join(""))).toEqual([
                "4호선 16분", "2호선 8분",
            ]);
            const rowStyles = renderer!.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style));
            expect(rowStyles.filter(style => style?.flexDirection === "row" && style?.width === "100%" && style?.maxWidth === "100%")).toHaveLength(2);
        } finally {
            useDimensions.mockRestore();
        }
    });

    it.each(["WALK", "TRANSFER"] as const)(
        "uses an unmarked walking link for %s and keeps transfer focus visible with reduced motion", async kind => {
        const transfer = { ...segments[0], key: "transfer", kind };
        const access = { ...segments[0], key: "access" };
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar
                    segments={[segments[0], access, segments[1], transfer, segments[2], segments[3]]}
                    labelledSummary alignedSummary focusedSegmentIndex={3} reduceFocusMotion
                />,
            );
        });
        const root = renderer!.root;
        const stop = (key: string) => root.findByProps({ testID: `route-summary-stop-${key}` });
        expect(stop("walk-0").findAllByType("Ionicons" as never)[0].props.name).toBe("walk-outline");
        expect(root.findAllByProps({ testID: "route-summary-stop-access" })).toHaveLength(0);
        expect(stop("transfer").findAllByType("Ionicons" as never)).toHaveLength(0);
        expect(stop("walk-3").findAllByType("Ionicons" as never)).toHaveLength(0);
        expect(stop("transfer").findAllByType(View).some(node => {
            const style = StyleSheet.flatten(node.props.style);
            return style?.height === 6 && style?.backgroundColor === "#ACB8C6";
        })).toBe(true);
        expect(root.findByProps({
            accessibilityLabel: "도보 6분, 4호선 16분, 환승 도보 3분, 2호선 8분, 도보 4분",
        })).toBeTruthy();
        const ring = stop("transfer").findAll(node =>
            StyleSheet.flatten(node.props.style)?.borderColor === "#18283B",
        )[0];
        expect(StyleSheet.flatten(ring.props.style)).toMatchObject({ opacity: 1, transform: [{ scale: 1 }] });
        const underlinedCaptions = (key: string) => stop(key).findAllByType(Text)
            .filter(node => StyleSheet.flatten(node.props.style as React.ComponentProps<typeof Text>["style"])?.textDecorationLine === "underline")
            .map(node => node.props.children);
        expect(underlinedCaptions("transfer")).toEqual(["3분"]);
        expect(underlinedCaptions("walk-3")).toEqual([]);
    });

    it("marks the selected segment in the large-text track without moving it in reduced motion", async () => {
        const reducedMotion = jest.mocked(useReducedMotion);
        reducedMotion.mockReturnValueOnce(true);
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={segments} compact trackOnly focusedSegmentIndex={2} />
            );
        });
        const selected = renderer!.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style))
            .find(style => style?.backgroundColor === "#00B140" && style.zIndex === 3);
        expect(selected).toEqual(expect.objectContaining({ borderColor: "#27364A" }));
        expect(selected?.transform).toEqual([{ translateY: 0 }, { scaleY: 1 }]);
    });

    it("moves the labelled track outline to the selected leg and removes it on clear", async () => {
        const render = (focusedSegmentIndex?: number) => (
            <TransitRouteProgressBar segments={segments} labelledSummary focusedSegmentIndex={focusedSegmentIndex} reduceFocusMotion />
        );
        await act(async () => {
            renderer = TestRenderer.create(render(1));
        });
        const findSegment = (color: string) => renderer!.root.findAllByType(View).find(node =>
            StyleSheet.flatten(node.props.style)?.backgroundColor === color
            && StyleSheet.flatten(node.props.style)?.height === "100%");
        const blueSegment = findSegment("#00A4E3")!;
        const greenSegment = findSegment("#00B140")!;
        const outline = (segment: typeof blueSegment) => segment.findAllByType(View).find(node =>
            StyleSheet.flatten(node.props.style)?.borderColor === "#18283B");
        expect(StyleSheet.flatten(outline(blueSegment)?.props.style)).toEqual(expect.objectContaining({ opacity: 1 }));
        expect(outline(greenSegment)).toBeUndefined();

        await act(async () => renderer!.update(render(2)));
        expect(outline(blueSegment)).toBeUndefined();
        expect(outline(greenSegment)).toBeDefined();

        await act(async () => renderer!.update(render()));
        expect(outline(greenSegment)).toBeUndefined();
    });
});
