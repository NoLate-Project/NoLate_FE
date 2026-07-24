import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import type { ScheduleDepartureStatus } from "../src/api/schedule";
import DepartureStatusCard from "../src/modules/schedule/components/detail/DepartureStatusCard";
import {
    getDepartureLifecyclePresentation,
    getDepartureStatusMetadataPresentation,
} from "../src/modules/schedule/departureStatusPresentation";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

function status(
    overrides: Partial<ScheduleDepartureStatus> = {},
): ScheduleDepartureStatus {
    return {
        scheduleId: "42",
        travelMinutes: 35,
        recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
        evaluatedAt: "2026-07-24T09:00:00+09:00",
        liveFetchedAt: "2026-07-24T08:59:00+09:00",
        source: "LIVE_PROVIDER",
        stale: false,
        confidence: "HIGH",
        failureReason: null,
        lastTrafficChangeMinutes: 4,
        lastChangedAt: "2026-07-24T08:58:00+09:00",
        nextCheckAt: "2026-07-24T09:05:00+09:00",
        preparationMinutes: 15,
        preparationStartAt: "2026-07-24T09:10:00+09:00",
        safetyBufferMinutes: 5,
        timeZone: "Asia/Seoul",
        ...overrides,
    };
}

function lifecycleAt(
    now: string,
    recommendedDepartureAt: string | null = "2026-07-24T09:30:00+09:00",
    scheduleEndAt = "2026-07-24T11:00:00+09:00",
) {
    jest.setSystemTime(new Date(now));
    return getDepartureLifecyclePresentation({
        recommendedDepartureAt,
        scheduleEndAt,
        scheduleHasEndTime: true,
        nowMs: Date.now(),
    });
}

describe("departure countdown lifecycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("출발 전에는 추천 출발 시각까지 실제 초 단위 카운트다운을 만든다", () => {
        expect(lifecycleAt("2026-07-24T09:00:00+09:00")).toMatchObject({
            phase: "upcoming",
            label: "추천 출발까지",
            value: "00:30:00",
        });
    });

    test("출발 직전 10분은 별도 주의 상태로 표시한다", () => {
        expect(lifecycleAt("2026-07-24T09:25:00+09:00")).toMatchObject({
            phase: "imminent",
            value: "00:05:00",
            detail: "곧 출발할 시간이에요",
        });
    });

    test("추천 출발 시각이 지나면 음수 카운트다운 대신 지남 상태를 표시한다", () => {
        expect(lifecycleAt("2026-07-24T09:31:00+09:00")).toMatchObject({
            phase: "past",
            value: "출발 시각 지남",
        });
    });

    test("일정 종료 뒤에는 출발 상태보다 종료를 우선한다", () => {
        expect(lifecycleAt(
            "2026-07-24T11:00:00+09:00",
            "2026-07-24T09:30:00+09:00",
        )).toMatchObject({
            phase: "ended",
            value: "종료",
        });
    });

    test("ETA가 없으면 저장 시각을 꾸며내지 않고 없음 상태를 표시한다", () => {
        expect(lifecycleAt("2026-07-24T09:00:00+09:00", null)).toMatchObject({
            phase: "missing",
            value: "ETA 없음",
        });
    });
});

describe("departure source and stale presentation", () => {
    test.each([
        ["LIVE_PROVIDER", "실시간 교통 조회"],
        ["SELECTED_ROUTE", "선택한 경로 기준"],
        ["SAVED_FALLBACK", "저장된 예상값"],
    ] as const)("%s 출처를 정직한 문구로 표시한다", (source, label) => {
        const presentation = getDepartureStatusMetadataPresentation(status({ source }));
        expect(presentation.sourceLabel).toBe(label);
        expect(presentation.liveFetchedLabel).toBe(
            source === "LIVE_PROVIDER" ? "실시간 확인 08:59" : undefined,
        );
    });

    test("stale과 provider 실패 이유 및 교통 변화량을 숨기지 않는다", () => {
        expect(getDepartureStatusMetadataPresentation(status({
            source: "SAVED_FALLBACK",
            stale: true,
            confidence: "LOW",
            failureReason: "provider timeout",
            lastTrafficChangeMinutes: 7,
        }))).toMatchObject({
            sourceLabel: "저장된 예상값",
            freshnessLabel: "오래된 정보",
            confidenceLabel: "신뢰도 낮음",
            failureLabel: "최신 교통 확인 실패: provider timeout",
            trafficChangeLabel: "교통 변화로 ETA가 7분 늘었어요 · 08:58 변경",
            liveFetchedLabel: undefined,
        });
    });

    test("fallback UI를 LIVE로 표현하지 않고 stale/failure를 실제 렌더링한다", async () => {
        let renderer: ReactTestRenderer | undefined;
        const fallbackStatus = status({
            source: "SAVED_FALLBACK",
            stale: true,
            confidence: "LOW",
            failureReason: "실시간 제공자 응답 없음",
        });
        const lifecycle = getDepartureLifecyclePresentation({
            recommendedDepartureAt: fallbackStatus.recommendedDepartureAt,
            scheduleEndAt: "2026-07-24T11:00:00+09:00",
            scheduleHasEndTime: true,
            nowMs: Date.parse("2026-07-24T09:00:00+09:00"),
        });

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <DepartureStatusCard
                        lifecycle={lifecycle}
                        metadata={getDepartureStatusMetadataPresentation(fallbackStatus)}
                        loadState="ready"
                        onRetry={jest.fn()}
                    />
                </ThemeProvider>,
            );
        });

        const text = renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .filter((value) => typeof value === "string")
            .join(" ");
        expect(text).toContain("저장된 예상값");
        expect(text).toContain("오래된 정보");
        expect(text).toContain("최신 교통 확인 실패");
        expect(text).not.toContain("실시간 확인 08:59");

        await act(async () => renderer?.unmount());
    });

    test("loading과 error 상태를 렌더링하고 사용자가 status 조회를 다시 시도할 수 있다", async () => {
        let renderer: ReactTestRenderer | undefined;
        const onRetry = jest.fn();
        const currentStatus = status({ stale: true });
        const lifecycle = getDepartureLifecyclePresentation({
            recommendedDepartureAt: currentStatus.recommendedDepartureAt,
            scheduleEndAt: "2026-07-24T11:00:00+09:00",
            scheduleHasEndTime: true,
            nowMs: Date.parse("2026-07-24T09:00:00+09:00"),
        });
        const metadata = getDepartureStatusMetadataPresentation(currentStatus);

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <DepartureStatusCard
                        lifecycle={lifecycle}
                        metadata={metadata}
                        loadState="loading"
                        onRetry={onRetry}
                    />
                </ThemeProvider>,
            );
        });

        expect(renderer!.root.findByProps({
            accessibilityLabel: "최신 출발 상태를 불러오고 있어요",
        })).toBeTruthy();

        await act(async () => {
            renderer!.update(
                <ThemeProvider>
                    <DepartureStatusCard
                        lifecycle={lifecycle}
                        metadata={metadata}
                        loadState="error"
                        loadError="네트워크를 확인해 주세요"
                        onRetry={onRetry}
                    />
                </ThemeProvider>,
            );
        });

        const retry = renderer!.root.findByProps({
            accessibilityLabel: "최신 출발 상태 다시 불러오기",
        });
        await act(async () => retry.props.onPress());

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .join(" ")).toContain("네트워크를 확인해 주세요");

        await act(async () => renderer?.unmount());
    });
});
