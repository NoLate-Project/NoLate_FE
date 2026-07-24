import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import type { ScheduleDepartureStatus } from "../src/api/schedule";
import DepartureStatusCard from "../src/modules/schedule/components/detail/DepartureStatusCard";
import {
    formatDepartureStatusClock,
    getDepartureLifecyclePresentation,
    getDepartureStatusMetadataPresentation,
    getUnavailableDepartureStatusMetadata,
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
    return getDepartureLifecyclePresentation({
        recommendedDepartureAt,
        scheduleStartAt: "2026-07-24T10:00:00+09:00",
        scheduleEndAt,
        scheduleHasEndTime: true,
        nowMs: Date.parse(now),
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

    test("종료 시각 없는 point event는 시작 후 유예 시간 뒤 종료한다", () => {
        const beforeEnd = getDepartureLifecyclePresentation({
            recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
            scheduleStartAt: "2026-07-24T10:00:00+09:00",
            scheduleEndAt: "2026-07-24T10:00:00+09:00",
            scheduleHasEndTime: false,
            nowMs: Date.parse("2026-07-24T10:30:00+09:00"),
        });
        const afterEnd = getDepartureLifecyclePresentation({
            recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
            scheduleStartAt: "2026-07-24T10:00:00+09:00",
            scheduleEndAt: "2026-07-24T10:00:00+09:00",
            scheduleHasEndTime: false,
            nowMs: Date.parse("2026-07-24T11:00:00+09:00"),
        });

        expect(beforeEnd.phase).toBe("past");
        expect(afterEnd.phase).toBe("ended");
    });

    test("zero-duration legacy all-day는 시작 자정이 아니라 다음 자정에 종료한다", () => {
        const options = {
            recommendedDepartureAt: null,
            scheduleStartAt: "2026-07-24T00:00:00+09:00",
            scheduleEndAt: "2026-07-24T00:00:00+09:00",
            scheduleHasEndTime: true,
            scheduleAllDay: true,
        };

        expect(getDepartureLifecyclePresentation({
            ...options,
            nowMs: Date.parse("2026-07-24T12:00:00+09:00"),
        }).phase).toBe("missing");
        expect(getDepartureLifecyclePresentation({
            ...options,
            nowMs: Date.parse("2026-07-25T00:00:00+09:00"),
        }).phase).toBe("ended");
    });

    test("point/all-day 종료 판정을 상세 카드에 실제 렌더링한다", async () => {
        const endedPoint = getDepartureLifecyclePresentation({
            recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
            scheduleStartAt: "2026-07-24T10:00:00+09:00",
            scheduleEndAt: "2026-07-24T10:00:00+09:00",
            scheduleHasEndTime: false,
            nowMs: Date.parse("2026-07-24T11:00:00+09:00"),
        });
        let renderer: ReactTestRenderer | undefined;

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <DepartureStatusCard
                        lifecycle={endedPoint}
                        metadata={getUnavailableDepartureStatusMetadata()}
                        loadState="unavailable"
                        onRetry={jest.fn()}
                    />
                </ThemeProvider>,
            );
        });

        const text = renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .join(" ");
        expect(text).toContain("종료");
        expect(text).toContain("종료된 일정이에요");
        await act(async () => renderer?.unmount());
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

    test("stale 누락과 liveFetchedAt 없는 LIVE를 최신 실시간으로 표현하지 않는다", () => {
        expect(getDepartureStatusMetadataPresentation(status({
            stale: null,
            source: "LIVE_PROVIDER",
            liveFetchedAt: null,
        }))).toMatchObject({
            sourceLabel: "실시간 교통 출처",
            freshnessLabel: "최신 여부 알 수 없음",
            freshnessTone: "unknown",
            etaLabel: "확인된 ETA 35분",
            liveFetchedLabel: undefined,
        });
    });

    test("evaluatedAt 누락은 stale=false여도 최신으로 단정하지 않는다", () => {
        expect(getDepartureStatusMetadataPresentation(status({
            source: "SELECTED_ROUTE",
            stale: false,
            evaluatedAt: null,
        }), {
            nowMs: Date.parse("2026-07-24T09:01:00+09:00"),
        })).toMatchObject({
            freshnessTone: "unknown",
            freshnessLabel: "최신 여부 알 수 없음",
        });
    });

    test("metadata 시각은 status timeZone을 사용하고 잘못된 zone은 안전하게 fallback한다", () => {
        expect(formatDepartureStatusClock(
            "2026-07-24T00:00:00Z",
            "Asia/Seoul",
        )).toBe("09:00");
        expect(formatDepartureStatusClock(
            "2026-07-24T00:00:00Z",
            "Invalid/NoLate",
        )).toMatch(/^\d{2}:\d{2}$/);
    });

    test("추천 출발/출발 완료 clock도 status timeZone을 일관되게 사용한다", () => {
        const upcoming = getDepartureLifecyclePresentation({
            recommendedDepartureAt: "2026-07-24T00:30:00Z",
            scheduleStartAt: "2026-07-24T02:00:00Z",
            scheduleEndAt: "2026-07-24T03:00:00Z",
            scheduleHasEndTime: true,
            timeZone: "Asia/Seoul",
            nowMs: Date.parse("2026-07-24T00:00:00Z"),
        });
        const departed = getDepartureLifecyclePresentation({
            recommendedDepartureAt: "2026-07-24T00:30:00Z",
            scheduleStartAt: "2026-07-24T02:00:00Z",
            scheduleEndAt: "2026-07-24T03:00:00Z",
            scheduleHasEndTime: true,
            departedAt: "2026-07-24T00:10:00Z",
            timeZone: "Asia/Seoul",
            nowMs: Date.parse("2026-07-24T00:20:00Z"),
        });
        expect(upcoming.detail).toContain("09:30");
        expect(departed.detail).toContain("09:10");
    });

    test("server stale=false도 age/nextCheck 경과 또는 cached 재검증 중이면 최신으로 두지 않는다", () => {
        const aged = getDepartureStatusMetadataPresentation(status({
            stale: false,
            evaluatedAt: "2026-07-24T08:00:00+09:00",
            liveFetchedAt: "2026-07-24T08:00:00+09:00",
            nextCheckAt: "2026-07-24T08:10:00+09:00",
        }), {
            nowMs: Date.parse("2026-07-24T09:00:00+09:00"),
        });
        const refreshing = getDepartureStatusMetadataPresentation(status({
            stale: false,
        }), {
            nowMs: Date.parse("2026-07-24T09:01:00+09:00"),
            refreshing: true,
        });
        expect(aged.freshnessLabel).toBe("오래된 정보");
        expect(aged.freshnessTone).toBe("stale");
        expect(refreshing.freshnessLabel).toBe("최신 상태 확인 중");
        expect(refreshing.freshnessTone).toBe("stale");
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
            scheduleStartAt: "2026-07-24T10:00:00+09:00",
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
            scheduleStartAt: "2026-07-24T10:00:00+09:00",
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
        expect(retry.props.accessibilityLiveRegion).toBeUndefined();
        const retryStyle = retry.props.style({ pressed: false });
        expect(retryStyle[1].minHeight).toBeGreaterThanOrEqual(44);
        expect(renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .join(" ")).toContain("네트워크를 확인해 주세요");

        await act(async () => renderer?.unmount());
    });

    test("이동 정보 공유가 꺼진 일정은 unavailable 설명만 표시하고 재시도를 노출하지 않는다", async () => {
        let renderer: ReactTestRenderer | undefined;
        const lifecycle = lifecycleAt("2026-07-24T09:00:00+09:00");

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <DepartureStatusCard
                        lifecycle={lifecycle}
                        metadata={getUnavailableDepartureStatusMetadata(35)}
                        loadState="unavailable"
                        onRetry={jest.fn()}
                    />
                </ThemeProvider>,
            );
        });

        const text = renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .join(" ");
        expect(text).toContain("개인 이동 정보 비공개");
        expect(text).toContain("이동 정보 공유가 꺼져");
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "최신 출발 상태 다시 불러오기",
        })).toHaveLength(0);

        await act(async () => renderer?.unmount());
    });
});
