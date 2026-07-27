import React from "react";
import { Platform, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import PlainScheduleDetailView, {
    PLAIN_SCHEDULE_DETAIL_COLORS,
} from "../src/modules/schedule/components/detail/PlainScheduleDetailView";
import { getMinimumTouchTarget } from "../src/ui/minimumTouchTarget";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            background: "#FFFFFF",
            border: "#E6E6EA",
            textPrimary: "#000000",
            textSecondary: "#6E6E73",
            inputBackground: "rgba(118,118,128,0.10)",
            inputBorder: "rgba(60,60,67,0.14)",
        },
    }),
}));

function relativeLuminance(hex: string): number {
    const [red, green, blue] = hex.slice(1).match(/../g)!.map(
        (value) => Number.parseInt(value, 16) / 255,
    ).map((value) => (
        value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05) /
        (Math.min(firstLuminance, secondLuminance) + 0.05);
}

test("plain detail 이동 경로 버튼은 실제 layout이 플랫폼 최소 터치 크기 이상이다", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
        renderer = TestRenderer.create(
            <PlainScheduleDetailView
                item={{
                    id: "42",
                    title: "약속",
                    startAt: "2026-07-24T10:00:00+09:00",
                    endAt: "2026-07-24T11:00:00+09:00",
                    category: { id: "1", title: "기본", color: "#1D4ED8" },
                }}
                contentTopInset={0}
                contentBottomInset={0}
                travelPlan={{
                    statusLabel: "경로가 설정되어 있어요",
                    actionLabel: "경로 보기",
                    pending: false,
                    onPress: jest.fn(),
                }}
            />,
        );
    });

    const button = renderer!.root.findByProps({
        accessibilityLabel: "내 이동 경로 경로 보기",
    });
    const resolvedStyle = typeof button.props.style === "function"
        ? button.props.style({ pressed: false })
        : button.props.style;
    const style = StyleSheet.flatten(resolvedStyle);
    expect(style.minHeight).toBeGreaterThanOrEqual(
        getMinimumTouchTarget(Platform.OS),
    );

    await act(async () => renderer?.unmount());
});

test("plain detail의 light 작은 텍스트/배경 조합은 4.5:1 이상이다", () => {
    const colors = PLAIN_SCHEDULE_DETAIL_COLORS.light;
    const combinations = [
        [PLAIN_SCHEDULE_DETAIL_COLORS.actionText, colors.accent],
        [colors.mutedBadgeText, colors.mutedBadgeBackground],
        // Theme inputBackground rgba(118,118,128,0.10) composited over white.
        [colors.secondaryTextOnTint, "#F1F1F2"],
    ] as const;

    combinations.forEach(([foreground, background]) => {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
});
