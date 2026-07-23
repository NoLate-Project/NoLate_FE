import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet } from "react-native";

import RouteEndpointReselectCard from "../src/modules/schedule/components/route/RouteEndpointReselectCard";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

const colors = {
    surface: "#171A20",
    surface2: "#23262D",
    border: "#2A2F3A",
    textPrimary: "#F5F7FA",
    textSecondary: "#9CA3AF",
    accentGreen: "#22C55E",
    accentRed: "#EF4444",
};

describe("RouteEndpointReselectCard", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("출발지와 도착지를 서로 독립된 재선택 버튼으로 제공한다", async () => {
        const onEditOrigin = jest.fn();
        const onEditDestination = jest.fn();
        const onSwap = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteEndpointReselectCard
                    originText="집"
                    destinationText="서울역"
                    onEditOrigin={onEditOrigin}
                    onEditDestination={onEditDestination}
                    onSwap={onSwap}
                    colors={colors}
                />
            );
        });

        const originButton = renderer!.root.findByProps({
            accessibilityLabel: "출발지 재선택, 현재 집",
        });
        const destinationButton = renderer!.root.findByProps({
            accessibilityLabel: "도착지 재선택, 현재 서울역",
        });
        const swapButton = renderer!.root.findByProps({
            accessibilityLabel: "출발지와 도착지 바꾸기",
        });
        const originHitStyle = StyleSheet.flatten(originButton.props.style({ pressed: false }));
        const destinationHitStyle = StyleSheet.flatten(destinationButton.props.style({ pressed: false }));

        for (const button of [destinationButton, swapButton]) {
            let ancestor: ReactTestInstance | null = button.parent;
            while (ancestor) {
                expect(ancestor).not.toBe(originButton);
                ancestor = ancestor.parent;
            }
        }

        await act(async () => {
            originButton.props.onPress();
            destinationButton.props.onPress();
            swapButton.props.onPress();
        });

        expect(onEditOrigin).toHaveBeenCalledTimes(1);
        expect(onEditDestination).toHaveBeenCalledTimes(1);
        expect(onSwap).toHaveBeenCalledTimes(1);
        expect(originHitStyle.minHeight).toBeGreaterThanOrEqual(44);
        expect(destinationHitStyle.minHeight).toBeGreaterThanOrEqual(44);
    });

    it("미지정 지점도 어떤 대상을 다시 고르는 버튼인지 명확히 알린다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <RouteEndpointReselectCard
                    originText=""
                    destinationText=""
                    onEditOrigin={jest.fn()}
                    onEditDestination={jest.fn()}
                    onSwap={jest.fn()}
                    colors={colors}
                />
            );
        });

        expect(renderer!.root.findByProps({
            accessibilityLabel: "출발지 재선택, 현재 출발지 미지정",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "도착지 재선택, 현재 도착지 미지정",
        })).toBeTruthy();
    });
});
