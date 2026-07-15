import React from "react";
import { Text } from "react-native";
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
});
