import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import RoutePointTargetSelector from "../src/modules/schedule/components/route/RoutePointTargetSelector";

const colors = {
    surface: "#FFFFFF",
    surface2: "#F2F4F8",
    border: "#E4E7EC",
    textPrimary: "#15171A",
    textSecondary: "#667085",
    accentBlue: "#2979FF",
    accentGreen: "#22C55E",
    accentRed: "#EF4444",
};

describe("RoutePointTargetSelector", () => {
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

    it("경로 완성 전에도 출발지와 도착지를 언제든 직접 전환한다", async () => {
        const onSelectTarget = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <RoutePointTargetSelector
                    activeTarget="destination"
                    originText=""
                    destinationText="서울역"
                    onSelectTarget={onSelectTarget}
                    colors={colors}
                />
            );
        });

        const originButton = renderer!.root.findByProps({
            accessibilityLabel: "출발지 선택 화면으로 전환, 현재 미지정",
        });
        const destinationButton = renderer!.root.findByProps({
            accessibilityLabel: "도착지 선택 화면으로 전환, 현재 서울역",
        });

        expect(originButton.props.accessibilityState).toEqual({ selected: false });
        expect(destinationButton.props.accessibilityState).toEqual({ selected: true });

        await act(async () => {
            originButton.props.onPress();
            destinationButton.props.onPress();
        });

        expect(onSelectTarget.mock.calls).toEqual([["origin"], ["destination"]]);
    });
});
