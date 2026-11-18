import React from "react";
import { Animated, Keyboard, StyleSheet, Switch, Text, TextInput } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

let mockFontScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
    default: () => ({ ...require("react-native").Dimensions.get("window"), fontScale: mockFontScale }),
}));

jest.mock("../src/modules/map/TmapMapView", () => () => null);
jest.mock("../src/modules/journey/SavedJourneyRoutePreview", () => ({ SavedJourneyRoutePreview: () => null }));
jest.mock("../src/modules/schedule/components/detail/ScheduleArrivalObservationAction", () => () => null);
jest.mock("../src/api/scheduleSharing", () => ({ getShareInbox: jest.fn() }));

import { getShareInbox } from "../src/api/scheduleSharing";
import PlainScheduleDetailView from "../src/modules/schedule/components/detail/PlainScheduleDetailView";
import { buildPlainScheduleDetailPresentation } from "../src/modules/schedule/plainScheduleDetailPresentation";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleItem } from "../src/modules/schedule/types";
import { ScheduleDetailBackground } from "../src/routeSupport/schedule/ScheduleDetailBackground";
import { ScheduleDetailHeader } from "../src/routeSupport/schedule/ScheduleDetailHeader";
import {
    SCHEDULE_EDITOR_EXIT_MS,
    ScheduleDetailEditingContext,
    ScheduleDetailEditResultContext,
} from "../src/routeSupport/schedule/ScheduleDetailEditorTransition";
import type { ScheduleDetailPresentation } from "../src/routeSupport/schedule/scheduleDetailPresentationModel";

function makeSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
    return {
        id: "plain-schedule",
        title: "QA0713A 일반 일정",
        startAt: "2026-07-14T10:00:00",
        endAt: "2026-07-14T11:30:00",
        hasEndTime: true,
        allDay: false,
        locationName: "회의실 A",
        category: {
            id: "personal",
            title: "개인",
            color: "#2F80FF",
        },
        notes: "자료를 미리 준비하기",
        ...overrides,
    };
}

describe("plain schedule detail presentation", () => {
    test("시간 일정의 상세 요약값을 만든다", () => {
        expect(buildPlainScheduleDetailPresentation(makeSchedule())).toEqual({
            title: "QA0713A 일반 일정",
            categoryTitle: "개인",
            categoryColor: "#2F80FF",
            location: "회의실 A",
            notes: "자료를 미리 준비하기",
            dateLabel: "2026년 7월 14일 (화)",
            timeRangeLabel: "오전 10:00 – 11:30",
            durationLabel: "1시간 30분",
            notificationLabel: "없음",
        });
    });

    test("종일 일정의 end-exclusive 종료일을 마지막 날로 표시한다", () => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            startAt: "2026-07-14T00:00:00",
            endAt: "2026-07-16T00:00:00",
            allDay: true,
            hasEndTime: false,
        }));

        expect(presentation.dateLabel).toBe(
            "2026년 7월 14일 (화) – 2026년 7월 15일 (수)",
        );
        expect(presentation.timeRangeLabel).toBe("종일");
        expect(presentation.durationLabel).toBeUndefined();
    });

    test("종료 시각이 없는 일정은 시작 시각만 표시한다", () => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            hasEndTime: false,
            endAt: "2026-07-14T10:00:00",
        }));

        expect(presentation.dateLabel).toBe("2026년 7월 14일 (화)");
        expect(presentation.timeRangeLabel).toBe("오전 10:00");
        expect(presentation.durationLabel).toBeUndefined();
    });

    test("locationName이 없으면 저장된 도착지 이름을 장소로 사용한다", () => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            locationName: " ",
            destination: {
                name: "서울역",
                address: "서울특별시 용산구",
                lat: 37.5547,
                lng: 126.9706,
            },
        }));

        expect(presentation.location).toBe("서울역");
    });

    test.each([
        ["STANDARD", 60, "1시간 전 · 푸시 알림"],
        ["ALARM", 30, "30분 전 · 출발 알람"],
    ] as const)("켜진 %s 알림의 실제 방식을 표시한다", (alertMode, leadMinutes, expected) => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            notificationEnabled: true,
            notificationLeadMinutes: leadMinutes,
            alertMode,
        }));

        expect(presentation.notificationLabel).toBe(expected);
    });

    test("꺼진 알림은 저장된 ALARM 선호가 남아 있어도 없음으로 표시한다", () => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            notificationEnabled: false,
            notificationLeadMinutes: 60,
            alertMode: "ALARM",
        }));

        expect(presentation.notificationLabel).toBe("없음");
    });
});

describe("PlainScheduleDetailView", () => {
    let renderer: ReactTestRenderer | undefined;

    test("저장한 메모만 편집 화면을 닫은 뒤 강조한다", async () => {
        jest.useFakeTimers();
        const previous = makeSchedule();
        const updated = { ...previous, notes: "수정한 메모" };
        const result = { previous, updated };
        const render = (editing: boolean) => (
            <ThemeProvider>
                <ScheduleDetailEditingContext.Provider value={editing}>
                    <ScheduleDetailEditResultContext.Provider value={result}>
                        <PlainScheduleDetailView item={updated} contentTopInset={74} contentBottomInset={48} />
                    </ScheduleDetailEditResultContext.Provider>
                </ScheduleDetailEditingContext.Provider>
            </ThemeProvider>
        );
        try {
            await act(async () => { renderer = TestRenderer.create(render(true)); });
            expect(renderer!.root.findAllByProps({ testID: "schedule-edit-highlight-memo" })).toHaveLength(0);
            await act(async () => { renderer!.update(render(false)); });
            await act(async () => { jest.advanceTimersByTime(SCHEDULE_EDITOR_EXIT_MS); });
            expect(renderer!.root.findAllByProps({ testID: "schedule-edit-highlight-memo" }).length).toBeGreaterThan(0);
            expect(renderer!.root.findAllByProps({ testID: "schedule-edit-highlight-title" })).toHaveLength(0);
            expect(renderer!.root.findAllByProps({ testID: "schedule-edit-highlight-time" })).toHaveLength(0);
        } finally {
            await act(async () => { renderer?.unmount(); });
            renderer = undefined;
            jest.useRealTimers();
        }
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    test("받은 일정은 서버 권한, 공유 범위, 확인된 공유자를 표시한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule({
                            ownerMemberId: 32,
                            sharePermission: "EDITOR",
                            shareContentMode: "SCHEDULE_AND_TRAVEL",
                            departureParticipants: [
                                { memberId: 32, email: "owner@example.test", role: "OWNER", departed: false },
                            ],
                        })}
                        contentTopInset={0}
                        contentBottomInset={0}
                    />
                </ThemeProvider>
            );
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "받은 권한, 편집 가능 · 일정 + 각자 경로" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "공유자, owner@example.test" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "일시 2026년 7월 14일 (화) 오전 10:00 – 11:30" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ testID: "plain-schedule-detail-info-group" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "카테고리 개인" })).toHaveLength(0);
        const location = renderer!.root.findByProps({ testID: "plain-schedule-detail-location", accessibilityLabel: "장소, 회의실 A" });
        const memo = renderer!.root.findByProps({ testID: "plain-schedule-detail-memo", accessibilityLabel: "메모, 자료를 미리 준비하기" });
        expect(StyleSheet.flatten(location.props.style)).toMatchObject({ flexDirection: "row" });
        expect(StyleSheet.flatten(memo.props.style)).toMatchObject({ flexDirection: "row" });
    });

    test("다른 일정의 공유자를 사용하지 않고 같은 받은 캘린더의 공유자를 찾는다", async () => {
        jest.mocked(getShareInbox).mockResolvedValueOnce({
            pendingInvitations: [],
            receivedShares: [
                { shareId: "other", resourceType: "SCHEDULE", resourceId: "different", title: "다른 일정", ownerMemberId: 32, ownerEmail: "other@example.test", permission: "VIEWER" },
                { shareId: "calendar", resourceType: "CALENDAR", resourceId: "17", title: "받은 캘린더", ownerMemberId: 32, ownerEmail: "owner@example.test", permission: "VIEWER" },
            ],
        });
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule({ ownerMemberId: 32, calendarId: 17, sharePermission: "VIEWER" })}
                        contentTopInset={0}
                        contentBottomInset={0}
                    />
                </ThemeProvider>
            );
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "공유자, owner@example.test" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "공유자, other@example.test" })).toHaveLength(0);
    });

    test("저장 경로 지도에 공통 로더를 표시하고 재시도 중에도 상태를 읽을 수 있다", async () => {
        const retry = jest.fn();
        const render = (mapState: "loading" | "error" | "retrying" | "ready") => (
            <ThemeProvider>
                <ScheduleDetailHeader
                    presentation={{
                        item: makeSchedule(),
                        insets: { top: 0 },
                        setRouteHeaderHeight: jest.fn(),
                    } as unknown as ScheduleDetailPresentation}
                    mapState={mapState}
                    onRetryMap={retry}
                />
            </ThemeProvider>
        );
        const indicator = () => renderer!.root.findAllByProps({ testID: "loading-indicator" });
        const status = () => renderer!.root.findByProps({ accessibilityLiveRegion: "polite" });
        const retryButton = () => renderer!.root.findByProps({ accessibilityLabel: "지도 다시 불러오기" });

        await act(async () => { renderer = TestRenderer.create(render("loading")); });
        expect(indicator()[0].props.accessible).toBe(false);
        expect(status().props.children).toBe("지도를 불러오는 중");
        await act(async () => renderer!.update(render("error")));
        expect(indicator()).toHaveLength(0);
        await act(async () => retryButton().props.onPress());
        expect(retry).toHaveBeenCalledTimes(1);
        await act(async () => renderer!.update(render("retrying")));
        expect(indicator().length).toBeGreaterThan(0);
        expect(status().props.children).toBe("지도를 다시 불러오는 중");
        expect(retryButton().props.accessibilityState).toEqual({ busy: true, disabled: true });
        await act(async () => renderer!.update(render("ready")));
        expect(indicator()).toHaveLength(0);
    });

    test.each([
        ["title", true, false],
        ["route", false, true],
        ["time", false, false],
    ] as const)("지도형 일정의 %s 수정에서 바뀐 상단 행만 강조한다", async (field, highlightTitle, highlightRoute) => {
        jest.useFakeTimers();
        const route = {
            id: "saved-route", originName: "서울역", destinationName: "강남역",
            totalDurationMinutes: 35, departureTime: "2026-07-14T09:25:00+09:00",
            arrivalTime: "2026-07-14T10:00:00+09:00", steps: [],
        };
        const previous = makeSchedule({ route });
        const updated = makeSchedule(field === "title" ? { route, title: "새 제목" } :
            field === "route" ? { route: { ...route, destinationName: "양재역" } } :
            { startAt: "2026-07-14T11:00:00", route: { ...route, departureTime: "2026-07-14T10:25:00+09:00",
                arrivalTime: "2026-07-14T11:00:00+09:00" } });
        const result = { previous, updated };
        const presentation = {
            item: updated, insets: { top: 0 }, hasRouteSummary: true, showTopRouteBar: true,
            routeTitle: updated.route === route ? "서울역 → 강남역" : "저장 경로",
            setRouteHeaderHeight: jest.fn(),
        } as unknown as ScheduleDetailPresentation;
        const render = (editing: boolean) => (
            <ThemeProvider>
                <ScheduleDetailEditingContext.Provider value={editing}>
                    <ScheduleDetailEditResultContext.Provider value={result}>
                        <ScheduleDetailHeader presentation={presentation} mapState="ready" onRetryMap={jest.fn()} />
                    </ScheduleDetailEditResultContext.Provider>
                </ScheduleDetailEditingContext.Provider>
            </ThemeProvider>
        );
        const hasHighlight = (row: string) => renderer!.root.findAllByProps({
            testID: `schedule-detail-edit-highlight-${row}`,
        }).length > 0;
        try {
            await act(async () => { renderer = TestRenderer.create(render(true)); });
            expect(hasHighlight("title")).toBe(false);
            expect(hasHighlight("route")).toBe(false);
            await act(async () => { renderer!.update(render(false)); });
            await act(async () => { jest.advanceTimersByTime(SCHEDULE_EDITOR_EXIT_MS); });
            expect(hasHighlight("title")).toBe(highlightTitle);
            expect(hasHighlight("route")).toBe(highlightRoute);
        } finally {
            await act(async () => { renderer?.unmount(); });
            renderer = undefined;
            jest.useRealTimers();
        }
    });

    test("경로 설정 전에도 가져온 승차권과 예매 미검증 상태를 보여 준다", async () => {
        const importedTicket = { version: 1, id: "ticket:12345678-1234-1234-1234-123456789012", kind: "TRAIN", source: "IOS_SHARE_IMAGE", verification: "USER_CONFIRMED", bookingStatus: "UNVERIFIED", departureName: "수서", arrivalName: "공주", departureAt: "2026-10-13T12:20:00+09:00", arrivalAt: "2026-10-13T13:12:00+09:00", trainNumber: "615", grade: "SRT", confirmedAt: "2026-10-12T00:00:00Z" };
        await act(async () => {
            renderer = TestRenderer.create(<ThemeProvider><PlainScheduleDetailView
                item={makeSchedule({ route: { schemaVersion: 3, importedTicket }, routeSetupRequired: true })}
                contentTopInset={120} contentBottomInset={40}
            /></ThemeProvider>);
        });
        const text = renderer!.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(" ");
        const compactText = text.replace(/\s+/g, " ");
        expect(compactText).toMatch(/가져온\s+기차\s+승차권/);
        expect(text).toContain("수서");
        expect(text).toContain("공주");
        expect(text).toContain("12:20");
        expect(text).toContain("13:12");
        expect(text).toContain("사용자 확인 · 예매 상태 미검증");
        expect(renderer!.root.findByProps({ testID: "imported-ticket-summary" })).toBeTruthy();
    });

    test.each([undefined, "OWNER"] as const)("기본 상세(%s)는 제목 아래 일시 카드와 장소·메모를 표시한다", async sharePermission => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule({ sharePermission })}
                        contentTopInset={120}
                        contentBottomInset={40}
                    />
                </ThemeProvider>
            );
        });

        const text = renderer!.root
            .findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .filter((value) => typeof value === "string")
            .join(" ");

        expect(text).not.toContain("일정 정보");
        expect(text).toContain("QA0713A 일반 일정");
        expect(text).toContain("개인");
        expect(text).toContain("2026년 7월 14일 (화)");
        expect(text).toContain("오전 10:00 – 11:30");
        expect(text).toContain("1시간 30분");
        expect(text).toContain("장소");
        expect(text).toContain("회의실 A");
        expect(text).toContain("메모");
        expect(text).toContain("자료를 미리 준비하기");
        expect(renderer!.root.findByProps({ testID: "plain-schedule-detail-info-group" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({
            testID: "plain-schedule-detail-notification",
        })).toHaveLength(0);
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "plain-schedule-detail-info-group" }).props.style,
        )).toMatchObject({
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 14,
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({
                accessibilityLabel: "일시 2026년 7월 14일 (화) 오전 10:00 – 11:30 1시간 30분",
            }).props.style,
        )).toMatchObject({
            minHeight: 70,
            paddingVertical: 13,
            gap: 10,
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "plain-schedule-detail-time-icon" }).props.style,
        )).toMatchObject({
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: "rgba(41,121,255,0.08)",
        });
        expect(renderer!.root.findAllByProps({
            testID: "plain-schedule-detail-time-divider",
        })).toHaveLength(0);
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 개인" }).props.style,
        )).toMatchObject({
            alignSelf: "flex-start",
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ children: "QA0713A 일반 일정" }).props.style,
        )).toMatchObject({
            fontSize: 24,
            lineHeight: 30,
            fontWeight: "700",
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ children: "2026년 7월 14일 (화)" }).props.style,
        )).toMatchObject({
            fontSize: 14,
            fontWeight: "600",
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ children: "오전 10:00 – 11:30" }).props.style,
        )).toMatchObject({
            fontSize: 19,
            lineHeight: 25,
            fontWeight: "700",
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ children: "자료를 미리 준비하기" }).props.style,
        )).toMatchObject({
            fontSize: 14,
            lineHeight: 21,
            fontWeight: "500",
        });
        expect(renderer!.root.findAllByType(TextInput)).toHaveLength(0);
        expect(renderer!.root.findAllByType(Switch)).toHaveLength(0);
    });

    test("큰 글씨에서 일정 카드의 글자가 시스템 설정을 따르고 긴 카테고리가 줄바꿈된다", async () => {
        mockFontScale = 2.5;
        try {
            const item = makeSchedule({ category: { id: "long", title: "함께 진행하는 프로젝트 일정", color: "#2F80FF" } });
            await act(async () => {
                renderer = TestRenderer.create(<ThemeProvider><PlainScheduleDetailView
                    item={item} contentTopInset={120} contentBottomInset={40}
                /></ThemeProvider>);
            });
            const text = (children: string) => renderer!.root.findAllByType(Text).find(node => node.props.children === children)!;
            const time = text("오전 10:00 – 11:30");
            expect(time.props.allowFontScaling).not.toBe(false);
            expect(time.props.maxFontSizeMultiplier).toBe(1.8);
            expect(text(item.category.title).props.numberOfLines).toBeUndefined();
        } finally {
            mockFontScale = 1;
        }
    });

    test("장소와 알림, 메모가 비어 있으면 일시만 표시한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule({ locationName: undefined, notes: undefined })}
                        contentTopInset={120}
                        contentBottomInset={40}
                    />
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "일시 2026년 7월 14일 (화) 오전 10:00 – 11:30 1시간 30분" })).toBeTruthy();
        for (const row of ["location", "notification", "memo"]) {
            expect(renderer!.root.findAllByProps({ testID: `plain-schedule-detail-${row}` })).toHaveLength(0);
        }
    });

    test("켜진 알림은 실제 시점과 방식을 함께 표시한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule({
                            notificationEnabled: true,
                            notificationLeadMinutes: 60,
                            alertMode: "STANDARD",
                        })}
                        contentTopInset={120}
                        contentBottomInset={40}
                    />
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findByProps({
            accessibilityLabel: "알림 1시간 전 · 푸시 알림",
        })).toBeTruthy();
    });

    test("공유 일정의 개인 이동 경로 상태와 설정 액션을 표시한다", async () => {
        const onPress = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule()}
                        contentTopInset={120}
                        contentBottomInset={40}
                        travelPlan={{
                            statusLabel: "경로 미설정",
                            actionLabel: "설정",
                            pending: false,
                            onPress,
                            participantContent: <Text>참여자 이동 계획 3명</Text>,
                        }}
                    />
                </ThemeProvider>
            );
        });

        const button = renderer!.root.findByProps({ accessibilityLabel: "내 이동 경로 설정" });
        await act(async () => button.props.onPress());

        const text = renderer!.root
            .findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .filter((value) => typeof value === "string")
            .join(" ");
        expect(text).toContain("내 이동 경로");
        expect(text).toContain("경로 미설정");
        expect(text).toContain("참여자 이동 계획 3명");
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onPress).toHaveBeenCalledWith(expect.any(Function));
    });

    test.each([false, true])("경로 일정의 메모 저장 강조는 동작 줄이기를 따른다 (%s)", async (reduceMotion) => {
        const timing = jest.spyOn(Animated, "timing").mockReturnValue({
            start: jest.fn(),
            stop: jest.fn(),
            reset: jest.fn(),
        });
        const keyboardVisible = jest.spyOn(Keyboard, "isVisible").mockReturnValue(true);
        const addListener = Keyboard.addListener.bind(Keyboard);
        let notifyKeyboardHidden: (() => void) | undefined;
        const keyboardListener = jest.spyOn(Keyboard, "addListener").mockImplementation((event, handler) => {
            notifyKeyboardHidden = () => handler({
                duration: 0,
                easing: "keyboard",
                endCoordinates: { screenX: 0, screenY: 874, width: 402, height: 0 },
            });
            return addListener(event, handler);
        });
        const previous = makeSchedule();
        const updated = { ...previous, notes: "수정한 지도 메모" };
        const result = { previous, updated };
        const render = (editing: boolean) => (
            <ScheduleDetailEditingContext.Provider value={editing}>
                <ScheduleDetailEditResultContext.Provider value={result}>
                    <ScheduleDetailBackground
                        presentation={{
                            isPlainSchedule: false, item: updated, notesText: updated.notes,
                            colors: {}, insets: { top: 0, bottom: 0 }, reduceMotion,
                            sheetMinHeight: 180, travelPlanParticipants: [],
                        } as unknown as ScheduleDetailPresentation}
                        renderTravelPlanRows={() => null}
                        mapReady={false}
                        mapRevision={0}
                        onMapLoadStateChange={jest.fn()}
                    />
                </ScheduleDetailEditResultContext.Provider>
            </ScheduleDetailEditingContext.Provider>
        );
        const memoPulses = () => timing.mock.calls.filter(([, config]) => config.duration === 180);
        const waitForEditorExit = () => act(async () =>
            new Promise<void>(resolve => setTimeout(resolve, SCHEDULE_EDITOR_EXIT_MS)),
        );
        try {
            await act(async () => { renderer = TestRenderer.create(render(true)); });
            await waitForEditorExit();
            expect(memoPulses()).toHaveLength(0);
            await act(async () => { renderer!.update(render(false)); });
            // Let the editor finish while the keyboard is still visible, then deliver its hide event.
            await waitForEditorExit();
            expect(memoPulses()).toHaveLength(0);
            keyboardVisible.mockReturnValue(false);
            await act(async () => { notifyKeyboardHidden?.(); });
            expect(memoPulses()).toHaveLength(reduceMotion ? 0 : 1);
            expect(renderer!.root.findByProps({ testID: "schedule-detail-edit-highlight-memo" }).props.pointerEvents).toBe("none");
        } finally {
            await act(async () => renderer?.unmount());
            renderer = undefined;
            timing.mockRestore();
            keyboardListener.mockRestore();
            keyboardVisible.mockRestore();
        }
    });

    test("지도 없는 일정도 개인 경로가 적용됐다는 상태를 표시한다", async () => {
        const render = (routeSavePending: boolean, routeSaveConfirmed: boolean) => (
            <ThemeProvider>
                <ScheduleDetailBackground
                    presentation={{
                        isPlainSchedule: true,
                        item: makeSchedule({ travelPlanStatus: "READY", routeSetupRequired: false }),
                        colors: {},
                        insets: { bottom: 0 },
                        travelPlanParticipants: [],
                        plainHeaderHeight: 96,
                        routeSavePending,
                        routeSaveConfirmed,
                    } as unknown as ScheduleDetailPresentation}
                    renderTravelPlanRows={() => null}
                    mapReady={false}
                    mapRevision={0}
                    onMapLoadStateChange={jest.fn()}
                />
            </ThemeProvider>
        );
        await act(async () => { renderer = TestRenderer.create(render(true, false)); });
        const message = () => renderer!.root.findAllByType(Text).find(node => node.props.accessibilityLiveRegion === "polite");
        const confirmation = () => renderer!.root.findAllByProps({ testID: "plain-schedule-route-confirmed" });
        expect(message()?.props.children).toBe("경로를 적용하고 있어요");
        expect(confirmation()).toHaveLength(0);
        await act(async () => renderer!.update(render(false, true)));
        expect(message()?.props.children).toBe("경로를 적용했어요");
        expect(confirmation().length).toBeGreaterThan(0);
        await act(async () => renderer!.update(render(false, false)));
        expect(message()).toBeUndefined();
        expect(confirmation()).toHaveLength(0);
    });
});
