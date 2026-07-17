import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CategoryLoadErrorBanner from "../src/modules/schedule/components/form/CategoryLoadErrorBanner";
import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

describe("category load failure UI", () => {
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

    test("서버 조회 전에는 운영용 가짜 카테고리를 만들지 않는다", () => {
        expect(createScheduleInitialState(new Date(2026, 6, 17)).categories).toEqual([]);
    });

    test("오류를 알리고 접근 가능한 재시도 동작을 제공한다", async () => {
        const onRetry = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <CategoryLoadErrorBanner onRetry={onRetry} />
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findByProps({ accessibilityRole: "alert" })).toBeDefined();
        const retryButton = renderer!.root.findByProps({
            accessibilityLabel: "카테고리 다시 불러오기",
        });
        expect(retryButton.props.accessibilityState).toEqual({ disabled: false, busy: false });

        await act(async () => retryButton.props.onPress());
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test("재시도 중에는 버튼을 busy/disabled로 알린다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <CategoryLoadErrorBanner retrying onRetry={jest.fn()} />
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findByProps({
            accessibilityLabel: "카테고리 다시 불러오기",
        }).props.accessibilityState).toEqual({ disabled: true, busy: true });
    });
});
