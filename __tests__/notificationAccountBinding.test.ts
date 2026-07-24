import {
    createNotificationActionKeys,
    getValidatedNotificationAccountBinding,
    getNotificationRecipientMemberId,
    validateNotificationAccountBinding,
} from "../src/modules/notification/notificationAccountBinding";

const HASH_LOGICAL_EVENT_KEY = `key:${"a".repeat(64)}`;
const UUID_LOGICAL_EVENT_KEY = "event:550e8400-e29b-41d4-a716-446655440000";

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
            data: {
                recipientMemberId: "1",
                logicalEventKey: UUID_LOGICAL_EVENT_KEY,
            },
            currentMemberId: 2,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: UUID_LOGICAL_EVENT_KEY,
            },
            currentMemberId: null,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: { recipientMemberId: "1" },
            currentMemberId: 1,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: `  ${UUID_LOGICAL_EVENT_KEY}  `,
            },
            currentMemberId: 1,
        })).toBe(true);
        expect(getValidatedNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: `  ${UUID_LOGICAL_EVENT_KEY}  `,
            },
            currentMemberId: 1,
        })).toEqual({
            recipientMemberId: 1,
            rawLogicalEventKey: UUID_LOGICAL_EVENT_KEY,
            logicalEventKey: `logical:${UUID_LOGICAL_EVENT_KEY}`,
        });
    });

    test("A 알림은 A→logout→B 전환 뒤 같은 공유 schedule에서도 action할 수 없다", () => {
        const payload = {
            logicalEventKey: HASH_LOGICAL_EVENT_KEY,
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
                logicalEventKey: UUID_LOGICAL_EVENT_KEY,
                scheduleId: "42",
            },
            currentMemberId: 1,
        })).toBe(false);
        expect(validateNotificationAccountBinding({
            data: {
                type,
                recipientMemberId: "1",
                logicalEventKey: HASH_LOGICAL_EVENT_KEY,
                scheduleId: "42",
            },
            currentMemberId: 1,
        })).toBe(true);
    });

    test("BE raw logical key는 canonical dedupe와 idempotency suffix로 분리한다", () => {
        const hashBinding = getValidatedNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: HASH_LOGICAL_EVENT_KEY,
            },
            currentMemberId: 1,
        })!;
        const uuidBinding = getValidatedNotificationAccountBinding({
            data: {
                recipientMemberId: "1",
                logicalEventKey: UUID_LOGICAL_EVENT_KEY,
            },
            currentMemberId: 1,
        })!;

        expect(createNotificationActionKeys("departNow", hashBinding)).toEqual({
            dedupeKey: `departNow:logical:${HASH_LOGICAL_EVENT_KEY}`,
            idempotencyKey: `departNow:${HASH_LOGICAL_EVENT_KEY}`,
        });
        expect(createNotificationActionKeys("snooze", uuidBinding)).toEqual({
            dedupeKey: `snooze:logical:${UUID_LOGICAL_EVENT_KEY}`,
            idempotencyKey: `snooze:${UUID_LOGICAL_EVENT_KEY}`,
        });
        expect(
            createNotificationActionKeys("departNow", hashBinding).idempotencyKey,
        ).not.toContain(":logical:");
    });

    test("이미 logical: namespace가 붙었거나 BE 형식이 아닌 key는 binding에서 거부한다", () => {
        for (const logicalEventKey of [
            `logical:${HASH_LOGICAL_EVENT_KEY}`,
            "event:not-a-uuid",
            `key:${"A".repeat(64)}`,
        ]) {
            expect(validateNotificationAccountBinding({
                data: { recipientMemberId: "1", logicalEventKey },
                currentMemberId: 1,
            })).toBe(false);
        }
    });
});
