import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import TransitRouteSummaryRow, {
    getTransitRouteSummaryAccessibilityLabel,
} from "../src/modules/schedule/components/route/TransitRouteSummaryRow";
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

describe("TransitRouteSummaryRow", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("renders a single unboxed route row with semantic endpoints", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteSummaryRow segments={segments} />
            );
        });

        expect(renderer!.root.findAllByType(Text).map((node) => node.props.children)).toEqual(["이동 경로"]);
        expect(renderer!.root.findAllByProps({ name: "walk-outline" })).toHaveLength(1);
        expect(renderer!.root.findAllByProps({ name: "location" })).toHaveLength(1);
        expect(renderer!.root.findByProps({
            accessibilityLabel: "이동 경로, 도보 3분, 4호선 16분, 2호선 8분, 도보 4분",
        })).toBeTruthy();

        const segmentStyles = renderer!.root.findAllByType(View)
            .map((node) => StyleSheet.flatten(node.props.style))
            .filter((style) => (
                style?.height === 5
                && typeof style?.flex === "number"
                && typeof style?.backgroundColor === "string"
            ));
        expect(segmentStyles).toEqual([
            expect.objectContaining({ flex: 3, backgroundColor: "#AEB8C5" }),
            expect.objectContaining({ flex: 16, backgroundColor: "#00A4E3" }),
            expect.objectContaining({ flex: 8, backgroundColor: "#00B140" }),
            expect.objectContaining({ flex: 4, backgroundColor: "#AEB8C5" }),
        ]);
    });

    it("describes an internal walk as a transfer and falls back for unnamed rides", () => {
        expect(getTransitRouteSummaryAccessibilityLabel([
            segments[1],
            { ...segments[0], key: "walk-transfer" },
            { ...segments[2], key: "bus", kind: "BUS", lineLabel: undefined },
        ])).toBe("이동 경로, 4호선 16분, 환승 도보 3분, 버스 8분");
    });
});
