import React from "react";
import { Image } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickScheduleLogoLoader from "../src/modules/schedule/components/form/QuickScheduleLogoLoader";

jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    default: { View: "ReanimatedView" },
    cancelAnimation: jest.fn(),
    Easing: {
        linear: (value: number) => value,
        bezier: () => (value: number) => value,
    },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
    withSequence: (...values: number[]) => values[values.length - 1],
    withTiming: (value: number) => value,
}));

describe("quick schedule logo loader", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    test("실제 퍼센트 대신 접근 가능한 불확정형 브랜드 로더를 표시한다", async () => {
        const label = "일정 초안을 만들고 있어요. 말한 내용에서 일정 정보를 찾고 있어요";

        await act(async () => {
            renderer = TestRenderer.create(
                <QuickScheduleLogoLoader accessibilityLabel={label} />
            );
        });

        const progress = renderer!.root.findByProps({ accessibilityRole: "progressbar" });
        expect(progress.props.accessibilityLabel).toBe(label);
        expect(progress.props.accessibilityLabel).not.toContain("%");
        expect(renderer!.root.findAllByType(Image)).toHaveLength(1);
    });
});
