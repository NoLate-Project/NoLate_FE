import React from "react";
import { Animated, Image, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import BrandedLoader, { BrandedLoadingState, type BrandedLoaderSize } from "../src/ui/BrandedLoader";
import LoadingIndicator from "../src/ui/LoadingIndicator";
import { useSystemReduceMotion } from "../src/modules/performance/useSystemReduceMotion";
import { QuickScheduleLoadingStep } from "../src/modules/schedule/components/form/QuickScheduleStatusSteps";

jest.mock("../src/modules/performance/useSystemReduceMotion", () => ({ useSystemReduceMotion: jest.fn(() => false) }));
jest.mock("../src/modules/theme/ThemeContext", () => ({ useTheme: () => ({ colors: {}, mode: "light" }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

const artwork = require("../assets/nolate-loading-mark.png");
let renderer: ReactTestRenderer;
let stop: jest.Mock;

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.mocked(useSystemReduceMotion).mockReturnValue(false);
    stop = jest.fn();
    jest.spyOn(Animated, "timing").mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
});
afterEach(() => {
    if (renderer) act(() => renderer.unmount());
    jest.restoreAllMocks();
});

test.each<[BrandedLoaderSize, number]>([["full", 82], ["section", 34], ["button", 20]])(
    "%s uses the same uncropped NoLate mark", (size, width) => {
        act(() => { renderer = TestRenderer.create(<BrandedLoader accessibilityLabel="경로를 찾는 중" size={size} />); });
        const image = renderer.root.findByType(Image);
        expect(image.props.source).toBe(artwork);
        expect(image.props.resizeMode).toBe("contain");
        expect(StyleSheet.flatten(image.props.style)).toEqual({ width, height: width });
        expect(renderer.root.findByProps({ testID: 'branded-loader-' + size }).props.accessibilityLabel).toBe("경로를 찾는 중");
    },
);

test.each([true, false])("analysis and saving use the same mark (%s)", (isAnalyzing) => {
    act(() => { renderer = TestRenderer.create(<QuickScheduleLoadingStep colors={{ textPrimary: "#111", textSecondary: "#555" }}
        label="처리 중" isAnalyzing={isAnalyzing} />); });
    expect(renderer.root.findByType(Image).props.source).toBe(artwork);
});

test.each<["inline" | "compact" | "regular", number]>([["inline", 20], ["compact", 20], ["regular", 28]])(
    "%s status uses the blue mark even on an inverse surface", (size, width) => {
        act(() => { renderer = TestRenderer.create(<LoadingIndicator size={size} tone="inverse" delayMs={150} />); });
        const image = renderer.root.findByType(Image);
        expect(image.props.source).toBe(artwork);
        expect(StyleSheet.flatten(image.props.style)).toEqual({ width, height: width });
    },
);

test("startup and the native launch screen use identical artwork", () => {
    act(() => { renderer = TestRenderer.create(<BrandedLoadingState startup size="full" accessibilityLabel="준비 중" />); });
    expect(renderer.root.findByType(Image).props.source).toBe(artwork);
    const asset = (name: string) => readFileSync(resolve(__dirname, "..", name));
    expect(asset("assets/nolate-loading-mark.png").equals(asset("ios/NoLateFE/Images.xcassets/SplashScreenLogo.imageset/nolate-logo@3x.png"))).toBe(true);
    expect(Animated.timing).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: "branded-loading-state-content" }).props.accessibilityElementsHidden).toBe(true);
});

test("enabling reduced motion stops the fade and keeps the mark visible", () => {
    const view = () => <BrandedLoader accessibilityLabel="지도 준비 중" size="button" settleMark />;
    act(() => { renderer = TestRenderer.create(view()); });
    expect(Animated.timing).toHaveBeenCalledTimes(1);
    jest.mocked(useSystemReduceMotion).mockReturnValue(true);
    act(() => renderer.update(view()));
    expect(stop).toHaveBeenCalled();
    jest.mocked(useSystemReduceMotion).mockReturnValue(false);
    act(() => renderer.update(view()));
    expect(Animated.timing).toHaveBeenCalledTimes(1);
});
