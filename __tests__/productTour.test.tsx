import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ProductTourScreen from "../app/onboarding/product-tour";
import {
    getProductTourButtonLabel,
    PRODUCT_TOUR_STEPS,
} from "../src/modules/onboarding/productTour";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

const mockReplace = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe("product tour", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(async () => {
        mockReplace.mockClear();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ProductTourScreen />
                </ThemeProvider>,
            );
        });
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllMocks();
    });

    test("빠른 일정과 출발 시각의 두 단계로 구성한다", () => {
        expect(PRODUCT_TOUR_STEPS.map(step => step.id)).toEqual([
            "quick",
            "departure",
        ]);
        expect(PRODUCT_TOUR_STEPS[0].images.light).toBeDefined();
        expect(PRODUCT_TOUR_STEPS[0].images.dark).toBeDefined();
        expect(PRODUCT_TOUR_STEPS[0].inputImages?.light).toBeDefined();
        expect(PRODUCT_TOUR_STEPS[0].inputImages?.dark).toBeDefined();
        expect(getProductTourButtonLabel(0)).toBe("다음");
        expect(getProductTourButtonLabel(1)).toBe("NoLate 시작하기");
    });

    test("건너뛰기는 일정 화면으로 바로 이동한다", async () => {
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사용법 건너뛰고 NoLate 시작하기" })
                .props.onPress();
        });

        expect(mockReplace).toHaveBeenCalledWith("/schedule");
    });

    test("계속 버튼으로 두 단계를 본 뒤 NoLate를 시작한다", async () => {
        for (const label of ["다음", "NoLate 시작하기"]) {
            await act(async () => {
                renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress();
                await new Promise<void>(resolve => setTimeout(() => resolve(), 420));
            });
        }

        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
    });
});
