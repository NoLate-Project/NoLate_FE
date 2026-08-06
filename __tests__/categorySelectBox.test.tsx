import React from "react";
import { Animated, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CategorySelectBox from "../src/modules/schedule/components/form/CategorySelectBox";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

const categories = [
    { id: "personal", title: "개인", color: "#4B9DFF" },
    { id: "work", title: "업무", color: "#FF5A52" },
];

describe("CategorySelectBox inline options", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    test("제목의 카테고리 칩 아래에 중복 선택 상자 없이 항목을 바로 보여준다", async () => {
        const interactionOrder: string[] = [];
        const onChange = jest.fn(() => interactionOrder.push("change"));
        const onExpandedChange = jest.fn(() => interactionOrder.push("close"));

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <CategorySelectBox
                        categories={categories}
                        value="personal"
                        expanded
                        hideTrigger
                        onChange={onChange}
                        onExpandedChange={onExpandedChange}
                    />
                </ThemeProvider>,
            );
        });

        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "카테고리 선택, 현재 개인",
        })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "개인 카테고리" }).props.accessibilityState)
            .toEqual({ checked: true });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ accessibilityLabel: "개인 카테고리" }).props.style,
        )).toMatchObject({ minHeight: 49 });
        expect(renderer!.root.findAllByProps({ name: "checkmark" })[0].props.color).toBe("#2979FF");
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "category-divider-work" }).props.style,
        )).toMatchObject({
            left: 34,
            right: 0,
            height: StyleSheet.hairlineWidth,
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리" }).props.onPress();
        });

        expect(onChange).toHaveBeenCalledWith("work");
        expect(onExpandedChange).toHaveBeenCalledWith(false);
        expect(interactionOrder).toEqual(["close", "change"]);
    });

    test("실제 목록 높이를 사용하고 닫힘 애니메이션 동안 터치를 차단한다", async () => {
        const renderTree = (expanded: boolean) => (
            <ThemeProvider>
                <CategorySelectBox
                    categories={categories}
                    value="personal"
                    expanded={expanded}
                    hideTrigger
                    onChange={jest.fn()}
                />
            </ThemeProvider>
        );
        await act(async () => {
            renderer = TestRenderer.create(renderTree(true));
        });

        await act(async () => {
            renderer!.root.findByProps({ testID: "category-dropdown-content" }).props.onLayout({
                nativeEvent: { layout: { height: 164 } },
            });
        });
        const expandedStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "category-dropdown-transition" }).props.style,
        );
        expect(expandedStyle.maxHeight._config.outputRange).toEqual([0, 164]);

        let finishClosing: ((result: { finished: boolean }) => void) | undefined;
        jest.spyOn(Animated, "timing").mockImplementation((() => ({
            start: (callback?: (result: { finished: boolean }) => void) => {
                finishClosing = callback;
            },
            stop: jest.fn(),
            reset: jest.fn(),
        })) as typeof Animated.timing);

        await act(async () => {
            renderer!.update(renderTree(false));
        });
        expect(renderer!.root.findByProps({ testID: "category-dropdown-transition" }).props.pointerEvents)
            .toBe("box-only");

        await act(async () => finishClosing?.({ finished: true }));
        expect(renderer!.root.findByProps({ testID: "category-dropdown-transition" }).props.pointerEvents)
            .toBe("none");
    });
});
