import React from "react";
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
    });

    test("제목의 카테고리 칩 아래에 중복 선택 상자 없이 항목을 바로 보여준다", async () => {
        const onChange = jest.fn();
        const onExpandedChange = jest.fn();

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

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리" }).props.onPress();
        });

        expect(onChange).toHaveBeenCalledWith("work");
        expect(onExpandedChange).toHaveBeenCalledWith(false);
    });
});
