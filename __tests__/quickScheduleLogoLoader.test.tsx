import React from "react";
import { Image, StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickScheduleLogoLoader, {
    type LogoLoaderVariant,
    shouldAnimateLogoOrbit,
} from "../src/modules/schedule/components/form/QuickScheduleLogoLoader";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

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
    },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
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

    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useReducedMotion).mockReturnValue(false);
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
                <ThemeProvider>
                    <QuickScheduleLogoLoader accessibilityLabel={label} />
                </ThemeProvider>
            );
        });

        const progress = renderer!.root.findByProps({ accessibilityRole: "progressbar" });
        expect(progress.props.accessibilityLabel).toBe(label);
        expect(progress.props.accessibilityLabel).not.toContain("%");
        expect(StyleSheet.flatten(progress.props.style)).toMatchObject({
            width: 168,
            height: 164,
        });
        const images = renderer!.root.findAllByType(Image);
        expect(images).toHaveLength(1);

        const appLogo = renderer!.root.findByProps({ testID: "quick-schedule-app-logo" });
        expect(appLogo.props.source).toBe(require("../assets/icon.png"));
        expect(appLogo.props.resizeMode).toBe("cover");
        expect(appLogo.props.tintColor).toBeUndefined();
        expect(StyleSheet.flatten(appLogo.props.style)).toMatchObject({
            width: 74,
            height: 74,
            borderRadius: 22,
        });
        expect(StyleSheet.flatten(appLogo.props.style).opacity).toBeGreaterThanOrEqual(0.9);

        const staticLayer = appLogo.parent;
        expect(staticLayer?.props.testID).toBe("quick-schedule-logo-static-layer");
        expect(staticLayer?.props.collapsable).toBe(false);
        expect(StyleSheet.flatten(staticLayer?.props.style)).not.toMatchObject({
            overflow: "hidden",
        });
        expect(StyleSheet.flatten(staticLayer?.props.style).transform).toBeUndefined();

        const glassTreatment = renderer!.root.findByProps({
            testID: "quick-schedule-logo-glass-treatment",
        });
        expect(glassTreatment.props.pointerEvents).toBe("none");
        expect(glassTreatment.props.accessible).toBe(false);
        expect(StyleSheet.flatten(glassTreatment.props.style)).toMatchObject({
            position: "absolute",
            overflow: "hidden",
            borderRadius: 22,
        });
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-logo-color-wash" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-logo-sheen" })
        ).toBeDefined();

        expect(renderer!.root.findByProps({ testID: "quick-schedule-logo-orbit" })).toBeDefined();
        expect(renderer!.root.findByProps({ testID: "quick-schedule-logo-orbit-secondary" })).toBeDefined();

        for (let index = 0; index < 3; index += 1) {
            expect(renderer!.root.findByProps({ testID: `quick-schedule-orbit-track-${index}` })).toBeDefined();
            expect(renderer!.root.findByProps({ testID: `quick-schedule-satellite-${index}` })).toBeDefined();
        }
    });

    test("캘린더 문맥에 맞는 글라스 위성 아이콘을 표시한다", async () => {
        await renderLoader("calendar");

        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-satellite-icon-0" }).props.name
        ).toBe("calendar-clear");
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-satellite-icon-1" }).props.name
        ).toBe("phone-portrait");
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-satellite-icon-2" }).props.name
        ).toBe("cloud");
    });

    test("동작 줄이기 설정에서는 무한 궤도 애니메이션을 시작하지 않는다", async () => {
        jest.mocked(useReducedMotion).mockReturnValue(true);

        await renderLoader();

        expect(shouldAnimateLogoOrbit(true)).toBe(false);
        expect(shouldAnimateLogoOrbit(false)).toBe(true);
        expect(renderer!.root.findByProps({ testID: "quick-schedule-ambient-halo" })).toBeDefined();
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
