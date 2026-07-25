import * as env from "../src/api/env";
import {
    filterScheduleCategoriesForSharingPolicy,
    filterScheduleItemsForSharingPolicy,
    filterStoredNotificationsForSharingPolicy,
    getScheduleSharingRouteRedirect,
    isScheduleNotificationAllowedBySharingPolicy,
    isScheduleSharingEnabled,
    isScheduleSharingRouteSegments,
    resolveScheduleSharingEnabled,
    retainScheduleShareTokenForEnabledPolicy,
    ScheduleSharingDisabledError,
    assertScheduleSharingEnabled,
} from "../src/modules/share/scheduleSharingPolicy";
import type {
    ScheduleCategory,
    ScheduleItem,
} from "../src/modules/schedule/types";
import {
    createPendingPushNavigationQueue,
    getNotificationActionCategoryFromData,
    getPushNavigationTargetFromNotificationData,
} from "../src/modules/notification/pushNavigation";
import { isDepartureCandidateEligible } from "../src/modules/schedule/nextDeparture";

const ownerCategory: ScheduleCategory = {
    id: "owner",
    title: "내 카테고리",
    color: "#2563EB",
    ownerMemberId: 7,
};
const receivedCategory: ScheduleCategory = {
    id: "received",
    title: "받은 카테고리",
    color: "#16A34A",
    ownerMemberId: 9,
    shared: true,
    sharePermission: "EDITOR",
};
const ownerSchedule: ScheduleItem = {
    id: "owner",
    ownerMemberId: 7,
    title: "내 일정",
    startAt: "2026-07-25T09:00:00+09:00",
    endAt: "2026-07-25T10:00:00+09:00",
    category: ownerCategory,
    departureParticipants: [
        { memberId: 7, role: "OWNER", departed: false },
        { memberId: 9, role: "SHARED", departed: false },
    ],
    travelCollaborationEnabled: true,
};
const receivedSchedule: ScheduleItem = {
    ...ownerSchedule,
    id: "received",
    ownerMemberId: 9,
    sharePermission: "VIEWER",
    category: receivedCategory,
};

describe("schedule sharing production policy", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        undefined,
        null,
        false,
        true,
        1,
        "",
        "false",
        "TRUE",
        "True",
        " true ",
        "true\n",
    ])("only the exact string true enables sharing: %p", (rawValue) => {
        expect(resolveScheduleSharingEnabled(rawValue)).toBe(false);
    });

    test("the exact string true is enabled", () => {
        expect(resolveScheduleSharingEnabled("true")).toBe(true);
    });

    test("runtime policy and disabled API assertion fail closed when the key is absent", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);

        expect(isScheduleSharingEnabled()).toBe(false);
        expect(() => assertScheduleSharingEnabled())
            .toThrow(ScheduleSharingDisabledError);
    });

    test("off keeps owner data but removes received rows and collaboration projections", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);

        expect(filterScheduleCategoriesForSharingPolicy(
            [ownerCategory, receivedCategory],
            7,
        )).toEqual([ownerCategory]);
        const schedules = filterScheduleItemsForSharingPolicy(
            [ownerSchedule, receivedSchedule],
            7,
        );
        expect(schedules).toHaveLength(1);
        expect(schedules[0]).toMatchObject({
            id: "owner",
            canViewAllTravelPlans: false,
            travelCollaborationEnabled: true,
        });
        expect(schedules[0].departureParticipants).toBeUndefined();
        expect(isDepartureCandidateEligible(
            schedules[0],
            Date.parse("2026-07-25T08:00:00+09:00"),
            7,
        )).toBe(true);
    });

    test("off rejects sharing and cross-user notification families without blocking owner traffic", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);

        for (const type of [
            "SCHEDULE_SHARE_RECEIVED",
            "CATEGORY_SHARE_RECEIVED",
            "CALENDAR_SHARE_RECEIVED",
            "SCHEDULE_PARTICIPANT_DEPARTED",
            "SCHEDULE_DEPARTURE_NUDGE",
            "SCHEDULE_CACHE_INVALIDATED",
        ]) {
            expect(isScheduleNotificationAllowedBySharingPolicy({
                type,
                scheduleId: "42",
            })).toBe(false);
        }
        expect(isScheduleNotificationAllowedBySharingPolicy({
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
            ownerMemberId: "7",
            recipientMemberId: "7",
        })).toBe(true);
        expect(isScheduleNotificationAllowedBySharingPolicy({
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
            recipientMemberId: "7",
        })).toBe(false);
        expect(isScheduleNotificationAllowedBySharingPolicy({
            type: "SCHEDULE_SHARE_RECEIVED_V2",
            scheduleId: "42",
            ownerMemberId: "7",
            recipientMemberId: "7",
        })).toBe(false);
        expect(isScheduleNotificationAllowedBySharingPolicy({
            scheduleId: "42",
        })).toBe(false);
    });

    test("old stored sharing notifications are removed before title/body presentation", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        const ownerTraffic = {
            type: "SCHEDULE_TRAFFIC",
            data: {
                type: "SCHEDULE_TRAFFIC",
                scheduleId: "1",
                ownerMemberId: "7",
                recipientMemberId: "7",
            },
        };
        const received = {
            type: "SCHEDULE_SHARE_RECEIVED",
            data: {
                type: "SCHEDULE_SHARE_RECEIVED",
                scheduleId: "2",
            },
        };

        expect(filterStoredNotificationsForSharingPolicy([
            received,
            ownerTraffic,
        ])).toEqual([ownerTraffic]);
    });

    test("stored type conflicts cannot disguise a sharing notification", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        const ownerProof = {
            scheduleId: "1",
            ownerMemberId: "7",
            recipientMemberId: "7",
        };

        expect(filterStoredNotificationsForSharingPolicy([
            {
                type: "CATEGORY_SHARE_RECEIVED",
                data: { ...ownerProof, type: "SCHEDULE_TRAFFIC" },
            },
            {
                type: "SCHEDULE_SHARE_RECEIVED",
                data: { ...ownerProof, type: "   " },
            },
            {
                type: "SCHEDULE_TRAFFIC",
                data: { ...ownerProof },
            },
        ])).toEqual([
            {
                type: "SCHEDULE_TRAFFIC",
                data: { ...ownerProof },
            },
        ]);
    });

    test("off push parsing rejects navigation/actions before a queued intent can be retained", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        const queue = createPendingPushNavigationQueue();
        const shareIntent = {
            target: { kind: "shareInbox" as const },
            logicalEventKey: "logical:key:share",
            recipientMemberId: 7,
            validationEpoch: 4,
        };

        expect(getPushNavigationTargetFromNotificationData({
            type: "SCHEDULE_SHARE_RECEIVED",
            scheduleId: "42",
        })).toBeUndefined();
        expect(getPushNavigationTargetFromNotificationData({
            type: "CALENDAR_SHARE_RECEIVED",
            calendarId: "9",
        })).toBeUndefined();
        expect(getPushNavigationTargetFromNotificationData({
            scheduleId: "42",
        })).toBeUndefined();
        expect(getNotificationActionCategoryFromData({
            type: "SCHEDULE_DEPARTURE_NUDGE",
            scheduleId: "42",
        })).toBeUndefined();
        expect(queue.defer(shareIntent)).toBe(false);
        expect(queue.peek()).toBeUndefined();
    });

    test("an intent queued by an enabled build is discarded if policy is off at execution", () => {
        const envSpy = jest.spyOn(env, "getEnv").mockReturnValue("true");
        const queue = createPendingPushNavigationQueue();
        queue.defer({
            target: { kind: "shareInbox" },
            logicalEventKey: "logical:key:old-share",
            recipientMemberId: 7,
            validationEpoch: 4,
        });
        envSpy.mockReturnValue(undefined);

        expect(queue.consumeIfReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toBeUndefined();
        expect(queue.peek()).toBeUndefined();
    });

    test.each([
        [["share", "inbox"]],
        [["share", "old-token"]],
        [["schedule", "calendars"]],
    ])("direct sharing route is guarded: %p", (segments) => {
        expect(isScheduleSharingRouteSegments(segments)).toBe(true);
    });

    test("off direct routes and post-auth tokens converge without a share redirect", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);

        expect(getScheduleSharingRouteRedirect({
            segments: ["share", "token"],
            isAuthenticated: false,
            isCurationCompleted: false,
        })).toBe("/auth/login");
        expect(getScheduleSharingRouteRedirect({
            segments: ["share", "inbox"],
            isAuthenticated: true,
            isCurationCompleted: false,
        })).toBe("/onboarding/calendar-import");
        expect(getScheduleSharingRouteRedirect({
            segments: ["schedule", "calendars"],
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toBe("/schedule");
        expect(retainScheduleShareTokenForEnabledPolicy("old-token"))
            .toBeNull();
    });

    test("explicit test opt-in keeps existing sharing behavior", () => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");

        expect(filterScheduleItemsForSharingPolicy(
            [ownerSchedule, receivedSchedule],
            7,
        )).toEqual([ownerSchedule, receivedSchedule]);
        expect(isScheduleNotificationAllowedBySharingPolicy({
            type: "SCHEDULE_SHARE_RECEIVED",
            scheduleId: "2",
        })).toBe(true);
        expect(retainScheduleShareTokenForEnabledPolicy("valid-token"))
            .toBe("valid-token");
        expect(getScheduleSharingRouteRedirect({
            segments: ["share", "valid-token"],
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toBeUndefined();
    });
});
