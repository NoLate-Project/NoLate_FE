import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

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

    it("renders the same compact mode nodes used by route detail screens", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TransitRouteProgressBar segments={segments} isDark compact />
            );
        });

        expect(renderer!.root.findAllByType("Ionicons" as never)).toHaveLength(3);
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
});
