import {
    getValidatedNotificationAccountBinding,
    getNotificationRecipientMemberId,
    validateNotificationAccountBinding,
} from "../src/modules/notification/notificationAccountBinding";

describe("notification account binding", () => {
    test("recipientMemberId 타입을 안전하게 파싱한다", () => {
        expect(getNotificationRecipientMemberId({ recipientMemberId: "42" })).toBe(42);
        expect(getNotificationRecipientMemberId({ recipientMemberId: 7 })).toBe(7);
        expect(getNotificationRecipientMemberId({ recipientMemberId: "x" })).toBeUndefined();
    });

    test("action과 일반 tap 모두 recipient/logical key 누락·불일치에서 fail-closed한다", () => {
        expect(validateNotificationAccountBinding({
            data: {},
            currentMemberId: 1,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1", logicalEventKey: "event-a" },
            currentMemberId: 2,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1", logicalEventKey: "event-a" },
            currentMemberId: null,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1" },
            currentMemberId: 1,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: "event-a",
            },
            currentMemberId: 1,
        })).toBe(true);
        expect(getValidatedNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: "event-a",
            },
            currentMemberId: 1,
        })).toEqual({
            recipientMemberId: 1,
            logicalEventKey: "logical:event-a",
        });
    });

    test("A 알림은 A→logout→B 전환 뒤 같은 공유 schedule에서도 action할 수 없다", () => {
        const payload = {
            logicalEventKey: "departure-42-A",
            scheduleId: "42",
            recipientMemberId: "1",
        };
        expect(validateNotificationAccountBinding({
            data: payload,
            currentMemberId: 1,
        })).toBe(true);
        expect(validateNotificationAccountBinding({
            data: payload,
            currentMemberId: 2,
        })).toBe(false);
    });

    test.each([
        "SCHEDULE_DETAIL",
        "SCHEDULE_SHARE_RECEIVED",
        "SCHEDULE_DEPARTURE_REMINDER",
        "SCHEDULE_PARTICIPANT_DEPARTED",
        "CATEGORY_SHARE_RECEIVED",
    ])("%s tap/action은 transport fallback이 아니라 두 backend binding 필드를 요구한다", (type) => {
        expect(validateNotificationAccountBinding({
            data: {
                type,
                recipientMemberId: "1",
                messageId: "provider-only",
                scheduleId: "42",
            },
            currentMemberId: 1,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: {
                type,
                logicalEventKey: "logical-only",
                scheduleId: "42",
            },
            currentMemberId: 1,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: {
                type,
                recipientMemberId: "1",
                logicalEventKey: "bound-event",
                scheduleId: "42",
            },
            currentMemberId: 1,
        })).toBe(true);
    });
});
