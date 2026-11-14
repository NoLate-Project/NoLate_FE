import React from "react";
import { StyleSheet, Switch, Text, TextInput } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
    default: () => ({ ...require("react-native").Dimensions.get("window"), fontScale: 1 }),
}));

jest.mock("../src/modules/map/TmapMapView", () => () => null);
jest.mock("../src/modules/journey/SavedJourneyRoutePreview", () => ({ SavedJourneyRoutePreview: () => null }));
jest.mock("../src/modules/schedule/components/detail/ScheduleArrivalObservationAction", () => () => null);

import PlainScheduleDetailView from "../src/modules/schedule/components/detail/PlainScheduleDetailView";
import { buildPlainScheduleDetailPresentation } from "../src/modules/schedule/plainScheduleDetailPresentation";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleItem } from "../src/modules/schedule/types";
import { ScheduleDetailBackground } from "../src/routeSupport/schedule/ScheduleDetailBackground";
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

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
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

    test("제목 아래에 일시를 강조하고 입력된 장소와 메모를 표시한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <PlainScheduleDetailView
                        item={makeSchedule()}
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
        expect(message()?.props.children).toBe("경로를 적용하고 있어요");
        await act(async () => renderer!.update(render(false, true)));
        expect(message()?.props.children).toBe("경로를 적용했어요");
        await act(async () => renderer!.update(render(false, false)));
        expect(message()).toBeUndefined();
    });
});
