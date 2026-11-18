import React from "react";
import { AccessibilityInfo, Animated, Dimensions, ScrollView, StyleSheet, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ProductTourScreen from "../app/onboarding/product-tour";
import {
    getProductTourButtonLabel,
    PRODUCT_TOUR_STEPS,
} from "../src/modules/onboarding/productTour";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

const mockDismissTo = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useRouter: () => ({ dismissTo: mockDismissTo }),
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
        mockDismissTo.mockClear();
        jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
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
        expect(getProductTourButtonLabel(0)).toBe("출발 준비 보기");
        expect(getProductTourButtonLabel(1)).toBe("NoLate 시작하기");
    });

    test("건너뛰기는 일정 화면으로 바로 이동한다", async () => {
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사용법 건너뛰고 NoLate 시작하기" })
                .props.onPress();
        });

        expect(mockDismissTo).toHaveBeenCalledWith("/schedule");
    });

    test("계속 버튼으로 두 단계를 본 뒤 NoLate를 시작한다", async () => {
        for (const label of ["출발 준비 보기", "NoLate 시작하기"]) {
            if (label === "NoLate 시작하기") {
                expect(renderer!.root.findAllByProps({
                    accessibilityLabel: "사용법 건너뛰고 NoLate 시작하기",
                })).toHaveLength(0);
                const route = renderer!.root.findByProps({
                    accessibilityLabel: "도보 5분, 4호선 20분, 환승 3분, 2호선 6분, 도보 2분",
                });
                const widths = route.findAllByType(Animated.View)
                    .map(node => StyleSheet.flatten(node.props.style).flex);
                expect(widths).toEqual([5, 20, 3, 6, 2]);
            }
            await act(async () => {
                renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress();
                await new Promise<void>(resolve => setTimeout(() => resolve(), 420));
            });
        }

        expect(mockDismissTo).toHaveBeenCalledTimes(1);
        expect(mockDismissTo).toHaveBeenCalledWith("/schedule");
    });

    test("동작 줄이기에서는 이동 구간을 완성된 비율로 바로 보여준다", async () => {
        const reduceMotion = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
        try {
            await act(async () => {
                renderer?.unmount();
                renderer = TestRenderer.create(<ThemeProvider><ProductTourScreen /></ThemeProvider>);
            });
            await act(async () => {
                renderer!.root.findByProps({ accessibilityLabel: "출발 준비 보기" }).props.onPress();
            });
            const route = renderer!.root.findByProps({
                accessibilityLabel: "도보 5분, 4호선 20분, 환승 3분, 2호선 6분, 도보 2분",
            });
            const segments = route.findAllByType(Animated.View).map(node => StyleSheet.flatten(node.props.style));
            expect(segments.map(style => style.flex)).toEqual([5, 20, 3, 6, 2]);
            expect(segments.every(style => style.opacity === undefined && style.transform === undefined)).toBe(true);
            expect(renderer!.root.findAllByProps({ accessibilityLabel: "예시 다시 보기" })).toHaveLength(0);
        } finally {
            reduceMotion.mockRestore();
        }
    });

    test("가려진 미리보기의 다시 보기는 스크롤이 끝난 뒤 한 번 재생한다", async () => {
        const dimensions = jest.spyOn(require("react-native"), "useWindowDimensions")
            .mockReturnValue({ ...Dimensions.get("window"), fontScale: 1 });
        const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
        const timing = jest.spyOn(Animated, "timing").mockReturnValue({
            start: jest.fn(), stop: jest.fn(), reset: jest.fn(),
        });
        try {
            await act(async () => {
                renderer?.unmount();
                renderer = TestRenderer.create(<ThemeProvider><ProductTourScreen /></ThemeProvider>);
            });
            const page = renderer!.root.findByType(ScrollView);
            const preview = page.findAllByType(Animated.View).find(node => node.props.onLayout)!;
            act(() => {
                page.props.onLayout({ nativeEvent: { layout: { height: 390 } } });
                page.props.onContentSizeChange(300, 640);
                preview.props.onLayout({ nativeEvent: { layout: { y: 270, height: 170 } } });
            });

            act(() => renderer!.root.findByProps({ accessibilityLabel: "예시 다시 보기" }).props.onPress());
            expect(scrollTo).toHaveBeenCalledWith({ y: 60, animated: false });
            expect(timing).not.toHaveBeenCalled();
            act(() => page.props.onScroll({ nativeEvent: { contentOffset: { y: 60 } } }));
            act(() => page.props.onScroll({ nativeEvent: { contentOffset: { y: 62 } } }));
            expect(timing).toHaveBeenCalledTimes(1);
        } finally {
            timing.mockRestore();
            scrollTo.mockRestore();
            dimensions.mockRestore();
        }
    });

    test("스크롤한 예시로 돌아오면 맨 위 제목 대신 보이는 미리보기에 초점을 둔다", async () => {
        const measurement = (y: number, height: number) => ({
            measureInWindow: jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, y, 300, height)),
        });
        const hidden = measurement(-70, 24);
        const visible = measurement(190, 24);
        const reduceMotion = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
        const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
        const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
        const nativeScrollView = jest.spyOn(ScrollView.prototype, "getNativeScrollRef").mockReturnValue(
            measurement(100, 400) as unknown as ReturnType<ScrollView["getNativeScrollRef"]>,
        );
        const frames: Parameters<typeof requestAnimationFrame>[0][] = [];
        const requestFrame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => {
            frames.push(callback);
            return frames.length;
        });
        try {
            await act(async () => { renderer?.unmount(); });
            await act(async () => {
                renderer = TestRenderer.create(<ThemeProvider><ProductTourScreen /></ThemeProvider>);
            });
            const page = () => renderer!.root.findByType(ScrollView);
            const layOut = () => {
                page().props.onLayout({ nativeEvent: { layout: { height: 400 } } });
                page().props.onContentSizeChange(300, 800);
            };
            act(layOut);
            act(() => page().props.onScroll({ nativeEvent: { contentOffset: { y: 170 } } }));
            act(() => renderer!.root.findByProps({ accessibilityLabel: "출발 준비 보기" }).props.onPress());
            act(() => renderer!.root.findByProps({ accessibilityLabel: "이전 사용법 보기" }).props.onPress());

            expect(page().props.contentOffset.y).toBe(170);
            const texts = page().findAllByType(Text).filter(node => node.instance);
            const preview = texts.find(node => node.props.children === "일정 미리보기")!;
            for (const text of texts) {
                text.instance.measureInWindow = (text === preview ? visible : hidden).measureInWindow;
            }
            act(layOut);
            act(() => frames.splice(0).forEach(frame => frame(0)));
            expect(scrollTo).toHaveBeenCalledWith({ y: 170, animated: false });
            expect(nativeScrollView).toHaveBeenCalled();
            expect(visible.measureInWindow).toHaveBeenCalled();
            expect(focus).toHaveBeenLastCalledWith(preview.instance, "focus");
        } finally {
            requestFrame.mockRestore();
            nativeScrollView.mockRestore();
            scrollTo.mockRestore();
            focus.mockRestore();
            reduceMotion.mockRestore();
        }
    });
});
