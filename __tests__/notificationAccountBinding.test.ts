import {
    getNotificationRecipientMemberId,
    validateNotificationAccountBinding,
} from "../src/modules/notification/notificationAccountBinding";

describe("notification account binding", () => {
    test("recipientMemberId 타입을 안전하게 파싱한다", () => {
        expect(getNotificationRecipientMemberId({ recipientMemberId: "42" })).toBe(42);
        expect(getNotificationRecipientMemberId({ recipientMemberId: 7 })).toBe(7);
        expect(getNotificationRecipientMemberId({ recipientMemberId: "x" })).toBeUndefined();
    });

    test("action은 recipient missing/mismatch/logout에서 fail-closed한다", () => {
        expect(validateNotificationAccountBinding({
            data: {},
            currentMemberId: 1,
            requireRecipient: true,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1" },
            currentMemberId: 2,
            requireRecipient: true,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1" },
            currentMemberId: null,
            requireRecipient: true,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1" },
            currentMemberId: 1,
            requireRecipient: true,
        })).toBe(true);
    });

    test("일반 tap은 rollout recipient 누락을 허용하지만 명시 mismatch는 막는다", () => {
        expect(validateNotificationAccountBinding({
            data: {},
            currentMemberId: 2,
            requireRecipient: false,
        })).toBe(true);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1" },
            currentMemberId: 2,
            requireRecipient: false,
        })).toBe(false);
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
            requireRecipient: true,
        })).toBe(true);
        expect(validateNotificationAccountBinding({
            data: payload,
            currentMemberId: 2,
            requireRecipient: true,
        })).toBe(false);
    });
});
