import React from "react";
import { Switch, Text, TextInput } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

import PlainScheduleDetailView from "../src/modules/schedule/components/detail/PlainScheduleDetailView";
import { buildPlainScheduleDetailPresentation } from "../src/modules/schedule/plainScheduleDetailPresentation";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleItem } from "../src/modules/schedule/types";

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
    test("시간 일정의 수정 폼용 표시값을 만든다", () => {
        expect(buildPlainScheduleDetailPresentation(makeSchedule())).toEqual({
            title: "QA0713A 일반 일정",
            categoryTitle: "개인",
            categoryColor: "#2F80FF",
            location: "회의실 A",
            notes: "자료를 미리 준비하기",
            allDay: false,
            hasEndTime: true,
            startDate: "2026. 7. 14.",
            startTime: "오전 10:00",
            endDate: "2026. 7. 14.",
            endTime: "오전 11:30",
        });
    });

    test("종일 일정의 end-exclusive 종료일을 마지막 날로 표시한다", () => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            startAt: "2026-07-14T00:00:00",
            endAt: "2026-07-16T00:00:00",
            allDay: true,
            hasEndTime: false,
        }));

        expect(presentation.startDate).toBe("2026. 7. 14.");
        expect(presentation.endDate).toBe("2026. 7. 15.");
        expect(presentation.startTime).toBeUndefined();
        expect(presentation.endTime).toBeUndefined();
    });

    test("종료 시각이 없는 일정은 종료 필드 값을 만들지 않는다", () => {
        const presentation = buildPlainScheduleDetailPresentation(makeSchedule({
            hasEndTime: false,
            endAt: "2026-07-14T10:00:00",
        }));

        expect(presentation.hasEndTime).toBe(false);
        expect(presentation.endDate).toBeUndefined();
        expect(presentation.endTime).toBeUndefined();
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
});

describe("PlainScheduleDetailView", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    test("일정 수정 화면 순서의 읽기 전용 필드를 보여 준다", async () => {
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

        expect(text).toContain("일정 정보");
        expect(text).toContain("제목");
        expect(text).toContain("QA0713A 일반 일정");
        expect(text).toContain("개인");
        expect(text).toContain("장소");
        expect(text).toContain("회의실 A");
        expect(text).toContain("시작 날짜");
        expect(text).toContain("시작 시간");
        expect(text).toContain("종료 날짜");
        expect(text).toContain("종료 시간");
        expect(text).toContain("메모");
        expect(text).toContain("자료를 미리 준비하기");
        expect(renderer!.root.findAllByType(TextInput)).toHaveLength(0);
        expect(renderer!.root.findAllByType(Switch)).toHaveLength(0);
    });

    test("장소와 메모가 없어도 빈 입력창 대신 명확한 읽기 전용 값을 표시한다", async () => {
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

        expect(renderer!.root.findByProps({ accessibilityLabel: "장소 등록된 장소 없음" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "메모 등록된 메모 없음" })).toBeTruthy();
    });
});
