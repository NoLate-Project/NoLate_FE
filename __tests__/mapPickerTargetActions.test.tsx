import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import MapPickerTargetActions from "../src/modules/schedule/components/route/MapPickerTargetActions";

const colors = {
    surface2: "#F2F4F8",
    border: "#E2E8F0",
    textPrimary: "#111827",
    textDisabled: "#98A2B3",
    accentGreen: "#16A34A",
    accentRed: "#EF4444",
};

describe("MapPickerTargetActions", () => {
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

    it("지도 좌표가 없을 때는 출발지와 도착지 확정을 모두 막는다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <MapPickerTargetActions
                    disabled
                    onConfirm={jest.fn()}
                    colors={colors}
                />
            );
        });

        expect(renderer!.root.findByProps({
            accessibilityLabel: "선택한 위치를 출발지로 설정",
        }).props.accessibilityState).toEqual({ disabled: true });
        expect(renderer!.root.findByProps({
            accessibilityLabel: "선택한 위치를 도착지로 설정",
        }).props.accessibilityState).toEqual({ disabled: true });
    });

    it("선택한 한 좌표를 출발지와 도착지 중 원하는 대상으로 확정한다", async () => {
        const onConfirm = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <MapPickerTargetActions
                    disabled={false}
                    onConfirm={onConfirm}
                    colors={colors}
                />
            );
        });

        await act(async () => {
            renderer!.root.findByProps({
                accessibilityLabel: "선택한 위치를 출발지로 설정",
            }).props.onPress();
            renderer!.root.findByProps({
                accessibilityLabel: "선택한 위치를 도착지로 설정",
            }).props.onPress();
        });

        expect(onConfirm.mock.calls).toEqual([["origin"], ["destination"]]);
    });
});
