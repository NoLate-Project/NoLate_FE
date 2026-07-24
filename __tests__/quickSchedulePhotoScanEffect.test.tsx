import React from "react";
import { StyleSheet, View } from "react-native";
import { cancelAnimation, useReducedMotion, withRepeat, withTiming } from "react-native-reanimated";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickSchedulePhotoScanEffect, {
    resolvePhotoScanTranslateY,
    shouldAnimatePhotoScan,
} from "../src/modules/schedule/components/form/QuickSchedulePhotoScanEffect";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("react-native-reanimated", () => {
    const ReactModule = require("react");
    const { View: NativeView } = require("react-native");

    return {
        __esModule: true,
        default: { View: NativeView },
        cancelAnimation: jest.fn(),
        Easing: {
            cubic: (value: number) => value,
            inOut: () => (value: number) => value,
        },
        interpolate: jest.fn((value: number, _input: number[], output: number[]) => (
            value <= 0 ? output[0] : output[output.length - 1]
        )),
        useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
        useReducedMotion: jest.fn(() => false),
        useSharedValue: (value: number) => ReactModule.useRef({ value }).current,
        withRepeat: jest.fn((value: number) => value),
        withTiming: jest.fn((value: number) => value),
    };
});

describe("QuickSchedulePhotoScanEffect", () => {
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

    test("비활성 상태에서는 사진만 표시하고 스캔 레이어를 만들지 않는다", async () => {
        await renderEffect(false);

        expect(renderer!.root.findByProps({ testID: "photo-content" })).toBeDefined();
        expect(renderer!.root.findAllByProps({
            testID: "quick-schedule-photo-scan-overlay",
        })).toHaveLength(0);
        expect(withRepeat).not.toHaveBeenCalled();
    });

    test("활성 상태에서는 사진 크기에 맞춘 무한 스캔을 시작하고 진행 상태를 노출한다", async () => {
        await renderEffect(true, "사진에서 일정 문장 인식 중");
        await layoutFrame(92);

        const overlay = renderer!.root.findByProps({
            testID: "quick-schedule-photo-scan-overlay",
        });
        expect(overlay.props.pointerEvents).toBe("none");
        expect(overlay.props.accessibilityRole).toBe("progressbar");
        expect(overlay.props.accessibilityLabel).toBe("사진에서 일정 문장 인식 중");
        expect(overlay.props.accessibilityState).toEqual({ busy: true });
        expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 1400 }));
        expect(withRepeat).toHaveBeenCalledWith(expect.anything(), -1, true);
        const reveal = renderer!.root.findByProps({
            testID: "quick-schedule-photo-scan-reveal",
        });
        const revealStyle = StyleSheet.flatten(reveal.props.style);
        expect(revealStyle.height).toBeUndefined();
        expect(revealStyle.transform).toEqual([
            { scaleY: expect.any(Number) },
        ]);
        expect(renderer!.root.findByProps({
            testID: "quick-schedule-photo-scan-corners",
        })).toBeDefined();
        expect(renderer!.root.findByProps({
            testID: "quick-schedule-photo-scan-band",
        })).toBeDefined();
    });

    test("동작 줄이기 설정에서는 정적인 포커스만 남기고 반복 애니메이션을 시작하지 않는다", async () => {
        jest.mocked(useReducedMotion).mockReturnValue(true);

        await renderEffect(true);
        await layoutFrame(92);

        expect(renderer!.root.findAllByProps({
            testID: "quick-schedule-photo-scan-band",
        })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({
            testID: "quick-schedule-photo-scan-reveal",
        })).toHaveLength(0);
        expect(renderer!.root.findByProps({
            testID: "quick-schedule-photo-scan-corners",
        })).toBeDefined();
        expect(withTiming).not.toHaveBeenCalled();
        expect(withRepeat).not.toHaveBeenCalled();
    });

    test("활성 상태가 끝나면 스캔 레이어와 애니메이션을 즉시 정리한다", async () => {
        await renderEffect(true);
        await layoutFrame(92);
        const cancellationCountBeforeStop = jest.mocked(cancelAnimation).mock.calls.length;

        await act(async () => {
            renderer!.update(
                <ThemeProvider>
                    <QuickSchedulePhotoScanEffect
                        active={false}
                        borderRadius={20}
                        style={{ width: 92, height: 92 }}
                    >
                        <View testID="photo-content" style={StyleSheet.absoluteFillObject} />
                    </QuickSchedulePhotoScanEffect>
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findAllByProps({
            testID: "quick-schedule-photo-scan-overlay",
        })).toHaveLength(0);
        expect(jest.mocked(cancelAnimation).mock.calls.length).toBeGreaterThan(
            cancellationCountBeforeStop
        );
    });

    test("언마운트할 때 진행 중인 무한 애니메이션을 취소한다", async () => {
        await renderEffect(true);
        await layoutFrame(92);
        const cancellationCountBeforeUnmount = jest.mocked(cancelAnimation).mock.calls.length;

        await act(async () => {
            renderer!.unmount();
        });
        renderer = undefined;

        expect(cancelAnimation).toHaveBeenCalledTimes(cancellationCountBeforeUnmount + 1);
    });

    test("애니메이션 여부와 스캔 이동 범위를 안전하게 제한한다", () => {
        expect(shouldAnimatePhotoScan(true, false, 92)).toBe(true);
        expect(shouldAnimatePhotoScan(false, false, 92)).toBe(false);
        expect(shouldAnimatePhotoScan(true, true, 92)).toBe(false);
        expect(shouldAnimatePhotoScan(true, false, 0)).toBe(false);

        expect(resolvePhotoScanTranslateY(-1, 92)).toBe(-48);
        expect(resolvePhotoScanTranslateY(0.5, 92)).toBe(22);
        expect(resolvePhotoScanTranslateY(2, 92)).toBe(92);
    });

    async function renderEffect(active: boolean, accessibilityLabel?: string) {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickSchedulePhotoScanEffect
                        active={active}
                        accessibilityLabel={accessibilityLabel}
                        borderRadius={20}
                        style={{ width: 92, height: 92 }}
                    >
                        <View testID="photo-content" style={StyleSheet.absoluteFillObject} />
                    </QuickSchedulePhotoScanEffect>
                </ThemeProvider>
            );
        });
    }

    async function layoutFrame(height: number) {
        const frame = renderer!.root.findByProps({
            testID: "quick-schedule-photo-scan-frame",
        });

        await act(async () => {
            frame.props.onLayout({ nativeEvent: { layout: { height } } });
        });
    }
});
