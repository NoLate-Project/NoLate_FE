import React from "react";
import { ScrollView, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import NextDepartureHero from "../src/modules/schedule/components/list/NextDepartureHero";
import {
    buildNextDepartureCandidate,
    buildNextDepartureHeroModel,
} from "../src/modules/schedule/nextDeparture";
import {
    MonthAgendaList,
    SelectedDayAgendaPanel,
} from "../src/modules/schedule/components/list/ScheduleAgendaViews";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: "Ionicons",
}));

const item: ScheduleItem = {
    id: "next-42",
    title: "프로젝트 발표",
    startAt: "2026-07-24T10:00:00+09:00",
    endAt: "2026-07-24T11:00:00+09:00",
    departAt: "2026-07-24T09:20:00+09:00",
    travelMinutes: 40,
    destination: { name: "코엑스" },
    category: {
        id: "work",
        title: "업무",
        color: "#32D74B",
    },
};

const now = new Date("2026-07-24T09:00:00+09:00");
const model = buildNextDepartureHeroModel(
    buildNextDepartureCandidate(item),
    now
);

function textContent(renderer: ReactTestRenderer): string {
    return renderer.root.findAllByType(Text)
        .flatMap((node) => node.props.children)
        .flat(Infinity)
        .filter((value): value is string | number => (
            typeof value === "string" || typeof value === "number"
        ))
        .join(" ");
}

describe("NextDepartureHero", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
    });

    test("shows departure, remaining time, travel, destination, and saved ETA at a glance", async () => {
        const onPressSchedule = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <NextDepartureHero
                        model={model}
                        loading={false}
                        connectionIssue={null}
                        onPressSchedule={onPressSchedule}
                        onPressRetry={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        const text = textContent(renderer!);
        expect(text).toContain("다음 출발");
        expect(text).toContain("추천 출발");
        expect(text).toContain("출발까지 20분");
        expect(text).toContain("프로젝트 발표");
        expect(text).toContain("코엑스");
        expect(text).toContain("이동 40분");
        expect(text).toContain("저장된 ETA");

        const hero = renderer!.root.findByProps({ testID: "next-departure-hero" });
        expect(hero.props.accessibilityRole).toBe("button");
        expect(hero.props.accessibilityLabel).toContain("추천 출발");
        expect(hero.props.accessibilityLabel).toContain("코엑스");
        expect(hero.props.accessibilityHint).toContain("기존 출발 액션");

        await act(async () => hero.props.onPress());
        expect(onPressSchedule).toHaveBeenCalledWith("next-42");
    });

    test.each([
        [true, null, "다음 출발을 확인하고 있어요", false],
        [false, null, "예정된 다음 출발이 없어요", false],
        [false, "offline", "오프라인이라 다음 출발을 확인할 수 없어요", true],
        [false, "error", "다음 출발을 불러오지 못했어요", true],
    ] as const)(
        "renders loading/empty/connectivity state %#",
        async (loading, connectionIssue, expectedText, retryable) => {
            const onPressRetry = jest.fn();

            await act(async () => {
                renderer = TestRenderer.create(
                    <ThemeProvider>
                        <NextDepartureHero
                            model={null}
                            loading={loading}
                            connectionIssue={connectionIssue}
                            onPressSchedule={jest.fn()}
                            onPressRetry={onPressRetry}
                        />
                    </ThemeProvider>
                );
            });

            expect(textContent(renderer!)).toContain(expectedText);
            const empty = renderer!.root.findByProps({ testID: "next-departure-empty" });
            expect(empty.props.accessibilityRole).toBe(retryable ? "button" : undefined);
            expect(empty.props.disabled).toBe(!retryable);

            if (retryable) {
                await act(async () => empty.props.onPress());
                expect(onPressRetry).toHaveBeenCalledTimes(1);
            }
        }
    );

    test("agenda detail and list keep the hero inside their existing scroll surfaces", async () => {
        const heroNode = <Text testID="hero-slot">hero slot</Text>;
        const commonProps = {
            items: [item],
            loading: false,
            error: null,
            bottomInset: 0,
            onPressRetry: jest.fn(),
            onOpenSchedule: jest.fn(),
            onRequestViewMode: jest.fn(),
            nextDepartureHero: heroNode,
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <>
                        <SelectedDayAgendaPanel
                            {...commonProps}
                            selectedDay="2026-07-24"
                        />
                        <MonthAgendaList
                            {...commonProps}
                            visibleMonth="2026-07-24"
                        />
                    </>
                </ThemeProvider>
            );
        });

        const scrolls = renderer!.root.findAllByType(ScrollView);
        expect(scrolls).toHaveLength(2);
        const heroSlots = renderer!.root.findAllByType(Text).filter(
            (node) => node.props.testID === "hero-slot"
        );
        expect(heroSlots).toHaveLength(2);
        expect(heroSlots.every((heroSlot) => {
            let ancestor = heroSlot.parent;
            while (ancestor && ancestor.type !== ScrollView) {
                ancestor = ancestor.parent;
            }
            return ancestor?.type === ScrollView;
        })).toBe(true);
        expect(textContent(renderer!)).toContain("프로젝트 발표");
    });
});
