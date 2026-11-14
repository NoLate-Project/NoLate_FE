import {
    formatAppNotificationTime,
    getAppNotificationCopy,
    getAppNotificationNavigationTarget,
    getAppNotificationVisual,
} from "../src/modules/notification/appNotificationPresentation";
import type { AppNotification } from "../src/api/notification";

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
    return {
        id: 12,
        type: "SCHEDULE_SHARE_RECEIVED",
        scheduleId: 55,
        categoryId: null,
        title: "새 일정 공유",
        body: "팀 회의 일정이 공유됐어요.",
        data: { type: "SCHEDULE_SHARE_RECEIVED", scheduleId: "55" },
        read: false,
        readAt: null,
        createdAt: "2026-07-22T01:00:00Z",
        ...overrides,
    };
}

describe("app notification presentation", () => {
    test("routes schedule notifications to schedule detail", () => {
        expect(getAppNotificationNavigationTarget(notification())).toEqual({
            kind: "scheduleDetail",
            scheduleId: "55",
        });
    });

    test("repairs missing string payload ids from typed columns", () => {
        expect(getAppNotificationNavigationTarget(notification({
            type: "CATEGORY_SHARE_RECEIVED",
            scheduleId: null,
            categoryId: 7,
            data: {},
        }))).toEqual({ kind: "shareInbox" });
    });

    test("routes calendar shares to the unified share inbox", () => {
        expect(getAppNotificationNavigationTarget(notification({
            type: "CALENDAR_SHARE_RECEIVED",
            scheduleId: null,
            data: { type: "CALENDAR_SHARE_RECEIVED", calendarId: "9" },
        }))).toEqual({ kind: "shareInbox" });
    });

    test("routes D-3 route setup reminders to the affected schedule", () => {
        expect(getAppNotificationNavigationTarget(notification({
            type: "ROUTE_SETUP_REMINDER",
            data: { type: "ROUTE_SETUP_REMINDER", scheduleId: "55" },
        }))).toEqual({ kind: "scheduleDetail", scheduleId: "55" });
    });

    test("promotes a shared resource name and preserves legacy messages without a matching template", () => {
        expect(getAppNotificationCopy(notification({ body: "'팀의 '첫' 회의' 일정이 공유됐어요." })))
            .toEqual({ title: "팀의 '첫' 회의", description: "공유 일정", shared: true });
        expect(getAppNotificationCopy(notification({
            type: "CALENDAR_SHARE_RECEIVED", data: { calendarTitle: "러닝 모임" },
        }))).toEqual({ title: "러닝 모임", description: "공유 캘린더", shared: true });
        expect(getAppNotificationCopy(notification())).toEqual({
            title: "새 일정 공유", description: "팀 회의 일정이 공유됐어요.",
        });
    });

    test("uses a restrained visual for each notification family", () => {
        expect(getAppNotificationVisual("SCHEDULE_PARTICIPANT_DEPARTED")).toMatchObject({
            icon: "navigate-outline",
            tone: "green",
        });
        expect(getAppNotificationVisual("CATEGORY_SHARE_RECEIVED")).toMatchObject({
            icon: "people-outline",
            tone: "blue",
        });
        expect(getAppNotificationVisual("CALENDAR_SHARE_RECEIVED")).toMatchObject({
            icon: "people-outline",
            tone: "blue",
        });
        expect(getAppNotificationVisual("ROUTE_SETUP_REMINDER")).toMatchObject({
            icon: "alarm-outline",
            tone: "blue",
        });
        expect(getAppNotificationVisual("UNKNOWN")).toMatchObject({
            icon: "notifications-outline",
            tone: "neutral",
        });
    });

    test("formats recent timestamps without locale-dependent output", () => {
        const now = Date.parse("2026-07-22T01:30:00Z");

        expect(formatAppNotificationTime("2026-07-22T01:29:40Z", now)).toBe("방금 전");
        expect(formatAppNotificationTime("2026-07-22T01:08:00Z", now)).toBe("22분 전");
        expect(formatAppNotificationTime("invalid", now)).toBe("");
    });
});
