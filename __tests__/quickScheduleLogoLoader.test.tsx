import React from "react";
import { AccessibilityInfo, Animated, Image, Platform, StyleSheet } from "react-native";
import { cancelAnimation, useReducedMotion, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickScheduleLogoLoader, {
    type LogoLoaderVariant,
    shouldAnimateLogoOrbit,
} from "../src/modules/schedule/components/form/QuickScheduleLogoLoader";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import BrandedLoader, { BrandedLoadingState } from "../src/ui/BrandedLoader";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: "Ionicons",
}));

jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    default: { View: "ReanimatedView" },
    cancelAnimation: jest.fn(),
    Easing: {
        linear: (value: number) => value,
        bezier: () => (value: number) => value,
        out: (easing: (value: number) => number) => easing,
        cubic: (value: number) => value ** 3,
    },
    ReduceMotion: { System: "system" },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: (value: number) => ({ value }),
    withDelay: jest.fn((_delay: number, value: number) => value),
    withRepeat: jest.fn((value: number) => value),
    withTiming: jest.fn((value: number) => value),
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

    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useReducedMotion).mockReturnValue(false);
        jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => useReducedMotion());
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.restoreAllMocks();
    });

    test("실제 퍼센트 대신 접근 가능한 불확정형 브랜드 로더를 표시한다", async () => {
        const label = "일정 초안을 만들고 있어요. 말한 내용에서 일정 정보를 찾고 있어요";

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleLogoLoader accessibilityLabel={label} />
                </ThemeProvider>
            );
        });

        const progress = renderer!.root.findByProps({ accessibilityRole: "progressbar" });
        expect(progress.props.accessibilityLabel).toBe(label);
        expect(progress.props.accessibilityLabel).not.toContain("%");
        expect(StyleSheet.flatten(progress.props.style)).toMatchObject({
            width: 194,
            height: 176,
        });
        const images = renderer!.root.findAllByType(Image);
        expect(images).toHaveLength(1);

        const appLogo = renderer!.root.findByProps({ testID: "quick-schedule-app-logo" });
        expect([
            require("../assets/curation/calendar-sync-3d-device-dark.png"),
            require("../assets/curation/calendar-sync-3d-device-light.png"),
        ]).toContain(appLogo.props.source);
        expect(appLogo.props.resizeMode).toBe("cover");
        expect(appLogo.props.tintColor).toBeUndefined();
        expect(StyleSheet.flatten(appLogo.props.style)).toMatchObject({
            left: -52,
            top: -49,
            width: 184,
            height: 184,
        });
        expect(StyleSheet.flatten(appLogo.props.style).opacity).toBeGreaterThanOrEqual(0.9);

        const logoMask = appLogo.parent;
        expect(StyleSheet.flatten(logoMask?.props.style)).toMatchObject({
            position: "absolute",
            overflow: "hidden",
            borderRadius: 25,
        });

        const staticLayer = renderer!.root.findByProps({
            testID: "quick-schedule-logo-static-layer",
        });
        expect(staticLayer?.props.collapsable).toBe(false);
        const staticLayerStyle = StyleSheet.flatten(staticLayer?.props.style);
        expect(staticLayerStyle).not.toMatchObject({
            overflow: "hidden",
        });
        expect(staticLayerStyle.transform).toBeUndefined();
        expect(staticLayerStyle.opacity).toBeUndefined();
        expect(staticLayerStyle.zIndex).toBeGreaterThan(0);

        const halo = renderer!.root.findByProps({ testID: "quick-schedule-ambient-halo" });
        expect(StyleSheet.flatten(halo.props.style)).toMatchObject({
            width: 68,
            height: 68,
            borderRadius: 34,
        });
        expect(StyleSheet.flatten(halo.props.style).width).toBeLessThan(
            StyleSheet.flatten(appLogo.props.style).width
        );

        const glassTreatment = renderer!.root.findByProps({
            testID: "quick-schedule-logo-glass-treatment",
        });
        expect(glassTreatment.props.pointerEvents).toBe("none");
        expect(glassTreatment.props.accessible).toBe(false);
        expect(StyleSheet.flatten(glassTreatment.props.style)).toMatchObject({
            position: "absolute",
            overflow: "hidden",
            borderRadius: 25,
        });
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-logo-color-wash" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-logo-sheen" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-logo-depth-far" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-logo-depth-near" })
        ).toBeDefined();

        expect(renderer!.root.findByProps({ testID: "quick-schedule-logo-orbit" })).toBeDefined();
        expect(renderer!.root.findByProps({ testID: "quick-schedule-logo-orbit-secondary" })).toBeDefined();

        for (let index = 0; index < 3; index += 1) {
            expect(renderer!.root.findByProps({ testID: `quick-schedule-orbit-track-${index}` })).toBeDefined();
            expect(renderer!.root.findByProps({ testID: `quick-schedule-satellite-${index}` })).toBeDefined();
        }
    });

    test("큐레이션에서는 기존 궤도 애니메이션과 유리 질감 로고를 표시한다", async () => {
        await renderLoader("calendar");

        const progress = renderer!.root.findByProps({ accessibilityRole: "progressbar" });
        expect(StyleSheet.flatten(progress.props.style)).toMatchObject({
            width: 194,
            height: 176,
        });

        const logo = renderer!.root.findByProps({ testID: "quick-schedule-app-logo" });
        expect(logo.props.resizeMode).toBe("cover");
        expect([
            require("../assets/curation/calendar-sync-3d-device-dark.png"),
            require("../assets/curation/calendar-sync-3d-device-light.png"),
        ]).toContain(logo.props.source);
        expect(StyleSheet.flatten(logo.props.style)).toMatchObject({
            left: -52,
            top: -49,
            width: 184,
            height: 184,
        });

        expect(renderer!.root.findAllByProps({ testID: "quick-schedule-satellite-0" })).toHaveLength(1);
        expect(renderer!.root.findByProps({ testID: "quick-schedule-satellite-icon-0" }).props.name)
            .toBe("phone-portrait-outline");
        expect(renderer!.root.findByProps({ testID: "quick-schedule-satellite-icon-1" }).props.name)
            .toBe("calendar-clear-outline");
        expect(renderer!.root.findByProps({ testID: "quick-schedule-satellite-icon-2" }).props.name)
            .toBe("cloud-done-outline");

        for (let index = 0; index < 3; index += 1) {
            const orbitTrack = renderer!.root.findByProps({
                testID: `quick-schedule-orbit-track-${index}`,
            });
            const orbitStyle = StyleSheet.flatten(orbitTrack.props.style);
            const width = Number(orbitStyle.width);
            const height = Number(orbitStyle.height);

            expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(2.2);
        }
    });

    test("동작 줄이기 설정에서는 무한 궤도 애니메이션을 시작하지 않는다", async () => {
        jest.mocked(useReducedMotion).mockReturnValue(true);

        await renderLoader();

        expect(shouldAnimateLogoOrbit(true)).toBe(false);
        expect(shouldAnimateLogoOrbit(false)).toBe(true);
        expect(withRepeat).not.toHaveBeenCalled();
        expect(withTiming).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ testID: "quick-schedule-ambient-halo" })).toBeDefined();
    });

    test("섹션 로더는 작은 로고와 대기 막대를 표시한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <BrandedLoader
                        size="section"
                        variant="route"
                        accessibilityLabel="경로를 계산하고 있어요"
                    />
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findByProps({ accessibilityRole: "progressbar" }).props.accessibilityLabel)
            .toBe("경로를 계산하고 있어요");
        const logo = renderer!.root.findByType(Image);
        expect(StyleSheet.flatten(logo.props.style)).toMatchObject({ width: 34, height: 34 });
        expect(renderer!.root.findByProps({ testID: "loading-indicator" }).props.accessibilityElementsHidden).toBe(true);
        expect(renderer!.root.findAllByProps({ testID: "quick-schedule-satellite-icon-0" })).toHaveLength(0);
    });

    test("버튼 로더는 고정 크기의 대기 표시를 사용한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <BrandedLoader
                        size="button"
                        variant="auth"
                        accessibilityLabel="로그인 중"
                    />
                </ThemeProvider>
            );
        });

        const mark = renderer!.root.findByProps({ testID: "branded-loader-button" });
        expect(StyleSheet.flatten(mark.props.style)).toMatchObject({
            width: 29,
            height: 28,
        });
        expect(mark.props.accessibilityRole).toBe("progressbar");
        expect(mark.props.accessibilityLabel).toBe("로그인 중");
        expect(renderer!.root.findByProps({ testID: "loading-indicator" })).toBeDefined();
        expect(renderer!.root.findAllByType(Image)).toHaveLength(0);
        expect(withRepeat).toHaveBeenCalled();
    });

    test.each([false, true])("지도 로딩 로고는 한 번만 정착하며 동작 줄이기를 따른다 (%s)", async (reduceMotion) => {
        jest.mocked(useReducedMotion).mockReturnValue(reduceMotion);

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <BrandedLoader size="button" settleMark accessibilityLabel="지도 준비 중" />
                </ThemeProvider>
            );
        });

        const mark = renderer!.root.findByProps({ testID: "branded-loader-button" });
        expect(StyleSheet.flatten(mark.props.style)).toMatchObject({ width: 28, height: 28 });
        expect(mark.props.accessibilityLabel).toBe("지도 준비 중");
        expect(renderer!.root.findByProps({ testID: "branded-loader-settle-logo" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ testID: "loading-indicator" })).toHaveLength(0);
        expect(withRepeat).not.toHaveBeenCalled();
        if (reduceMotion) {
            expect(withTiming).not.toHaveBeenCalled();
        } else {
            expect(withTiming).toHaveBeenCalledTimes(1);
            expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 280 }));
        }
    });

    test("문구가 있는 로딩 상태는 스크린리더에 하나의 진행 상태로만 노출한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <BrandedLoadingState
                        accessibilityLabel="일정을 불러오고 있어요"
                        title="일정을 불러오고 있어요"
                        caption="잠시만 기다려 주세요"
                    />
                </ThemeProvider>
            );
        });

        const state = renderer!.root.findByProps({ testID: "branded-loading-state" });
        expect(state.props.accessible).toBe(true);
        expect(state.props.accessibilityRole).toBe("progressbar");
        expect(state.props.accessibilityLabel).toBe("일정을 불러오고 있어요");
        expect(state.props.accessibilityLiveRegion).toBe("polite");

        const content = renderer!.root.findByProps({ testID: "branded-loading-state-content" });
        expect(content.props.accessibilityElementsHidden).toBe(true);
        expect(content.props.importantForAccessibility).toBe("no-hide-descendants");
    });

    test.each([false, true])("앱 시작 로고는 시스템 동작 줄이기를 따른다 (%s)", async (reduceMotion) => {
        jest.replaceProperty(Platform, "OS", "ios");
        jest.mocked(useReducedMotion).mockReturnValue(reduceMotion);
        const start = jest.fn();
        const stop = jest.fn();
        const timing = jest.spyOn(Animated, "timing").mockReturnValue({ start, stop, reset: jest.fn() });
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <BrandedLoadingState
                        accessibilityLabel="NoLate를 준비하고 있어요"
                        size="full"
                        startup
                    />
                </ThemeProvider>,
            );
        });

        const logo = renderer!.root.findByProps({ testID: "startup-native-logo" });
        expect(logo.props.source).toEqual({ uri: "SplashScreenLogo" });
        expect(StyleSheet.flatten(logo.props.style)).toMatchObject({ width: 82, height: 82 });
        expect(withRepeat).not.toHaveBeenCalled();
        if (reduceMotion) {
            expect(timing).not.toHaveBeenCalled();
        } else {
            expect(timing).toHaveBeenCalledTimes(1);
            const config = timing.mock.calls[0][1];
            expect(config).toMatchObject({ duration: 470, useNativeDriver: true });
            expect(config.easing?.(150 / 470)).toBe(0);
            expect(config.easing?.(1)).toBe(1);
            expect(start).toHaveBeenCalledTimes(1);
            act(() => renderer!.unmount());
            renderer = undefined;
            expect(stop).toHaveBeenCalledTimes(1);
        }
    });

    test("대기 중 동작 줄이기를 켜면 예약된 로고 동작을 취소하고 다시 재생하지 않는다", async () => {
        let changeMotion!: (enabled: boolean) => void;
        const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", () => undefined);
        const remove = jest.spyOn(subscription, "remove");
        jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((eventName, callback) => {
            expect(eventName).toBe("reduceMotionChanged");
            changeMotion = callback as unknown as typeof changeMotion;
            return subscription;
        });
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleLogoLoader accessibilityLabel="일정을 확인하고 있어요"
                        settleOnly settleDelayMs={90} settleDurationMs={320} hideBeforeSettle />
                </ThemeProvider>,
            );
        });

        expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 320 }));
        expect(withDelay).toHaveBeenCalledTimes(1);
        jest.mocked(cancelAnimation).mockClear();
        await act(async () => changeMotion(true));
        expect(cancelAnimation).toHaveBeenCalled();
        await act(async () => changeMotion(false));
        expect(withDelay).toHaveBeenCalledTimes(1);
        await act(async () => renderer!.unmount());
        renderer = undefined;
        expect(remove).toHaveBeenCalledTimes(1);
    });

    async function renderLoader(variant: LogoLoaderVariant = "schedule") {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleLogoLoader
                        variant={variant}
                        accessibilityLabel="브랜드 로더"
                    />
                </ThemeProvider>
            );
        });
    }

});
