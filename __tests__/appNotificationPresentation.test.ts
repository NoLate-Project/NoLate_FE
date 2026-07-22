import {
    formatAppNotificationTime,
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

    test("uses a restrained visual for each notification family", () => {
        expect(getAppNotificationVisual("SCHEDULE_PARTICIPANT_DEPARTED")).toMatchObject({
            icon: "navigate-outline",
            tone: "green",
        });
        expect(getAppNotificationVisual("CATEGORY_SHARE_RECEIVED")).toMatchObject({
            icon: "people-outline",
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
