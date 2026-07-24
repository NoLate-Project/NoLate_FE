import type { ScheduleDepartureStatus } from "../src/api/schedule";
import {
    buildNextDepartureCandidate,
    buildNextDepartureHeroModel,
    rankNextDepartures,
    selectNextDeparture,
} from "../src/modules/schedule/nextDeparture";
import type { ScheduleItem } from "../src/modules/schedule/types";

const category: ScheduleItem["category"] = {
    id: "personal",
    title: "개인",
    color: "#32D74B",
};

function schedule(
    id: string,
    {
        startAt = "2026-07-24T10:00:00+09:00",
        endAt = "2026-07-24T11:00:00+09:00",
        departAt,
        travelMinutes,
        destination = "서울역",
        departedAt,
        myDepartedAt,
        ownerMemberId,
        allDay,
        routeSetupRequired,
        route,
        travelCollaborationEnabled,
    }: {
        startAt?: string;
        endAt?: string;
        departAt?: string;
        travelMinutes?: number;
        destination?: string;
        departedAt?: string;
        myDepartedAt?: string;
        ownerMemberId?: number;
        allDay?: boolean;
        routeSetupRequired?: boolean;
        route?: unknown;
        travelCollaborationEnabled?: boolean;
    } = {}
): ScheduleItem {
    return {
        id,
        title: `${id} 일정`,
        startAt,
        endAt,
        departAt,
        travelMinutes,
        departedAt,
        myDepartedAt,
        ownerMemberId,
        allDay,
        routeSetupRequired,
        route,
        travelCollaborationEnabled,
        destination: destination ? { name: destination } : undefined,
        category,
    };
}

function status(
    scheduleId: string,
    overrides: Partial<ScheduleDepartureStatus> = {}
): ScheduleDepartureStatus {
    return {
        scheduleId,
        travelMinutes: 30,
        recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
        evaluatedAt: "2026-07-24T09:00:00+09:00",
        liveFetchedAt: "2026-07-24T09:00:00+09:00",
        source: "LIVE_PROVIDER",
        stale: false,
        confidence: "HIGH",
        failureReason: null,
        lastTrafficChangeMinutes: null,
        lastChangedAt: null,
        nextCheckAt: "2026-07-24T09:05:00+09:00",
        preparationMinutes: 10,
        preparationStartAt: "2026-07-24T09:20:00+09:00",
        safetyBufferMinutes: 5,
        timeZone: "Asia/Seoul",
        ...overrides,
    };
}

describe("next departure selection", () => {
    const now = new Date("2026-07-24T09:00:00+09:00");

    test("latest statuses reorder multiple departure-ready schedules", () => {
        const savedFirst = schedule("saved-first", {
            departAt: "2026-07-24T09:10:00+09:00",
        });
        const liveFirst = schedule("live-first", {
            departAt: "2026-07-24T09:20:00+09:00",
        });
        const statuses = {
            "saved-first": status("saved-first", {
                recommendedDepartureAt: "2026-07-24T09:40:00+09:00",
                lastTrafficChangeMinutes: -30,
            }),
            "live-first": status("live-first", {
                recommendedDepartureAt: "2026-07-24T09:08:00+09:00",
                lastTrafficChangeMinutes: 12,
            }),
        };

        expect(selectNextDeparture(
            [savedFirst, liveFirst],
            statuses,
            now
        )?.item.id).toBe("live-first");
        expect(rankNextDepartures(
            [savedFirst, liveFirst],
            statuses,
            now
        ).map(({ item }) => item.id)).toEqual(["live-first", "saved-first"]);
    });

    test("passed-but-active stays urgent while ended, departed, and all-day items are excluded", () => {
        const activePast = schedule("active-past", {
            startAt: "2026-07-24T09:05:00+09:00",
            endAt: "2026-07-24T10:00:00+09:00",
            departAt: "2026-07-24T08:50:00+09:00",
        });
        const upcoming = schedule("upcoming", {
            departAt: "2026-07-24T09:10:00+09:00",
        });
        const ended = schedule("ended", {
            startAt: "2026-07-24T07:00:00+09:00",
            endAt: "2026-07-24T08:00:00+09:00",
            departAt: "2026-07-24T06:30:00+09:00",
        });
        const departed = schedule("departed", {
            departAt: "2026-07-24T09:01:00+09:00",
            myDepartedAt: "2026-07-24T08:58:00+09:00",
        });
        const allDay = schedule("all-day", {
            allDay: true,
            departAt: "2026-07-24T09:02:00+09:00",
        });

        const ranked = rankNextDepartures(
            [ended, departed, allDay, upcoming, activePast],
            {},
            now
        );

        expect(ranked.map(({ item }) => item.id)).toEqual([
            "active-past",
            "upcoming",
        ]);
    });

    test("an upcoming destination without ETA remains meaningful and reports missing ETA", () => {
        const noEta = schedule("no-eta", {
            departAt: undefined,
            travelMinutes: undefined,
            destination: "광화문",
            routeSetupRequired: true,
        });
        const candidate = selectNextDeparture([noEta], {}, now);

        expect(candidate?.item.id).toBe("no-eta");
        expect(candidate?.recommendedDepartureAt).toBeNull();
        expect(buildNextDepartureHeroModel(candidate!, now)).toMatchObject({
            phase: "NO_ETA",
            departureClockLabel: "ETA 없음",
            etaLabel: "ETA 없음",
            travelLabel: "이동시간 없음",
        });
    });

    test("stable start/id tie-breakers make selection independent of API order", () => {
        const b = schedule("b", {
            startAt: "2026-07-24T10:00:00+09:00",
            departAt: "2026-07-24T09:30:00+09:00",
        });
        const a = schedule("a", {
            startAt: "2026-07-24T10:00:00+09:00",
            departAt: "2026-07-24T09:30:00+09:00",
        });

        expect(selectNextDeparture([b, a], {}, now)?.item.id).toBe("a");
        expect(selectNextDeparture([a, b], {}, now)?.item.id).toBe("a");
    });

    test("owner departedAt is trusted only for the owner, while shared users require their own state", () => {
        const ownerDeparted = schedule("owner-departed", {
            ownerMemberId: 1,
            departedAt: "2026-07-24T08:50:00+09:00",
            departAt: "2026-07-24T09:10:00+09:00",
        });
        const sharedDeparted = schedule("shared-departed", {
            ownerMemberId: 1,
            departedAt: "2026-07-24T08:50:00+09:00",
            myDepartedAt: "2026-07-24T08:55:00+09:00",
            departAt: "2026-07-24T09:12:00+09:00",
        });

        expect(selectNextDeparture([ownerDeparted], {}, now, 1)).toBeNull();
        expect(selectNextDeparture([ownerDeparted], {}, now, 2)?.item.id)
            .toBe("owner-departed");
        expect(selectNextDeparture([sharedDeparted], {}, now, 2)).toBeNull();
    });

    test("disabled travel collaboration and location-only events cannot displace a valid ETA", () => {
        const disabled = schedule("disabled", {
            departAt: "2026-07-24T09:01:00+09:00",
            travelCollaborationEnabled: false,
        });
        const locationOnly = schedule("location-only", {
            startAt: "2026-07-24T09:05:00+09:00",
            departAt: undefined,
            travelMinutes: undefined,
            destination: "가까운 장소",
        });
        const valid = schedule("valid", {
            departAt: "2026-07-24T09:20:00+09:00",
        });

        expect(rankNextDepartures(
            [disabled, locationOnly, valid],
            {},
            now
        ).map(({ item }) => item.id)).toEqual(["valid"]);
    });
});

describe("next departure presentation", () => {
    const now = new Date("2026-07-24T09:00:00+09:00");

    function modelAt(
        recommendedDepartureAt: string | null,
        overrides: Partial<ScheduleDepartureStatus> = {},
        itemOverrides: Partial<ScheduleItem> = {}
    ) {
        const item = {
            ...schedule("target", {
                startAt: itemOverrides.startAt,
                endAt: itemOverrides.endAt,
                departAt: itemOverrides.departAt,
                travelMinutes: itemOverrides.travelMinutes,
                destination: itemOverrides.destination?.name,
                departedAt: itemOverrides.departedAt,
                allDay: itemOverrides.allDay,
                routeSetupRequired: itemOverrides.routeSetupRequired,
                route: itemOverrides.route,
                travelCollaborationEnabled:
                    itemOverrides.travelCollaborationEnabled ?? undefined,
            }),
            ...itemOverrides,
        };
        return buildNextDepartureHeroModel(
            buildNextDepartureCandidate(
                item,
                status(item.id, { recommendedDepartureAt, ...overrides })
            ),
            now
        );
    }

    test.each([
        ["2026-07-24T09:31:00+09:00", "BEFORE", "출발까지 31분"],
        ["2026-07-24T09:10:00+09:00", "SOON", "곧 출발 · 10분 남음"],
        ["2026-07-24T09:00:30+09:00", "DUE", "지금 출발할 시간이에요"],
        ["2026-07-24T08:55:00+09:00", "PAST", "추천 출발 시각이 5분 지났어요"],
    ])("%s maps to %s", (departureAt, phase, remainingLabel) => {
        expect(modelAt(departureAt)).toMatchObject({ phase, remainingLabel });
    });

    test("an ended item has an explicit ended phase even if a retained card renders briefly", () => {
        expect(modelAt(
            "2026-07-24T08:00:00+09:00",
            {},
            {
                startAt: "2026-07-24T07:00:00+09:00",
                endAt: "2026-07-24T08:30:00+09:00",
            }
        )).toMatchObject({
            phase: "ENDED",
            remainingLabel: "일정이 종료됐어요",
        });
    });

    test("live, stale, fallback, and offline sources never masquerade as one another", () => {
        expect(modelAt("2026-07-24T09:30:00+09:00").etaLabel).toBe("실시간 ETA");
        expect(modelAt("2026-07-24T09:30:00+09:00", {
            stale: true,
        }).etaLabel).toBe("업데이트 지연");
        expect(modelAt("2026-07-24T09:30:00+09:00", {
            source: "SAVED_FALLBACK",
            liveFetchedAt: null,
            failureReason: "provider unavailable",
        }).etaLabel).toBe("저장된 ETA");
        expect(modelAt(null, {
            source: "LIVE_PROVIDER",
            liveFetchedAt: null,
            failureReason: "live fetch failed",
        }, {
            departAt: "2026-07-24T09:30:00+09:00",
        }).etaLabel).toBe("저장된 ETA");

        const savedCandidate = buildNextDepartureCandidate(schedule("saved", {
            departAt: "2026-07-24T09:30:00+09:00",
        }));
        expect(buildNextDepartureHeroModel(
            savedCandidate,
            now
        ).etaLabel).toBe("저장된 ETA");
        expect(buildNextDepartureHeroModel(
            savedCandidate,
            now,
            "offline"
        ).etaLabel).toBe("오프라인 · 저장된 정보");
        expect(buildNextDepartureHeroModel(
            savedCandidate,
            now,
            "error"
        ).etaLabel).toBe("업데이트 실패 · 저장된 정보");
    });

    test("a live snapshot downgrades when nextCheckAt or maximum age has passed", () => {
        expect(modelAt("2026-07-24T09:30:00+09:00", {
            nextCheckAt: "2026-07-24T08:59:59+09:00",
        }).etaLabel).toBe("업데이트 지연");
        expect(buildNextDepartureHeroModel(
            buildNextDepartureCandidate(
                schedule("aged", {
                    departAt: "2026-07-24T09:30:00+09:00",
                }),
                status("aged", {
                    recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
                    evaluatedAt: "2026-07-24T08:54:00+09:00",
                    liveFetchedAt: "2026-07-24T08:54:00+09:00",
                    nextCheckAt: null,
                })
            ),
            now
        ).etaLabel).toBe("업데이트 지연");
    });

    test("traffic change and low confidence are included in the accessible summary", () => {
        const model = modelAt("2026-07-24T09:10:00+09:00", {
            lastTrafficChangeMinutes: 7,
            confidence: "LOW",
        });

        expect(model.trafficChangeLabel).toBe("교통 반영 +7분");
        expect(model.accessibilityLabel).toContain("서울역");
        expect(model.accessibilityLabel).toContain("교통 반영 +7분");
        expect(model.accessibilityLabel).toContain("참고용");
    });
});
