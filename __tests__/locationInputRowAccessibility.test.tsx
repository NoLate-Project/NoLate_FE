import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import LocationInputRow from "../src/modules/schedule/components/form/LocationInputRow";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

describe("LocationInputRow accessibility", () => {
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

    test("경로 수정과 지우기를 중첩되지 않은 독립 버튼으로 제공한다", async () => {
        const onPress = jest.fn();
        const onClear = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <LocationInputRow
                        originValue="집"
                        destinationValue="서울역"
                        travelMode="TRANSIT"
                        travelMinutes={30}
                        onPress={onPress}
                        onClear={onClear}
                    />
                </ThemeProvider>
            );
        });

        const editButton = renderer!.root.findByProps({
            accessibilityLabel: "이동 경로 수정, 집 → 서울역",
        });
        const clearButton = renderer!.root.findByProps({
            accessibilityLabel: "설정한 이동 경로 지우기",
        });
        expect(renderer!.root.findByProps({ children: "대중교통 · 약 30분" })).toBeTruthy();
        let ancestor: ReactTestInstance | null = clearButton.parent;
        while (ancestor) {
            expect(ancestor).not.toBe(editButton);
            ancestor = ancestor.parent;
        }

        await act(async () => {
            editButton.props.onPress();
            clearButton.props.onPress();
        });
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    test("빈 경로는 짧은 문구로 다음 행동과 결과를 안내한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <LocationInputRow
                        originValue=""
                        destinationValue=""
                        onPress={jest.fn()}
                    />
                </ThemeProvider>,
            );
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "출발지와 도착지 추가" })).toBeTruthy();
        expect(renderer!.root.findByProps({ children: "출발지·도착지 추가" })).toBeTruthy();
        expect(renderer!.root.findByProps({ children: "경로·출발 알림 설정" })).toBeTruthy();
    });
});
