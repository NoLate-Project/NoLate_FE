import {
    executeNotificationActionForActiveSession,
    resolveActiveNotificationAccountBinding,
} from "../src/modules/notification/notificationSessionFence";

const LOGICAL_EVENT_KEY = `key:${"a".repeat(64)}`;

describe("notification open/action logout fence", () => {
    test("logout-pending이면 open payload 검증과 navigation을 시작하지 않는다", async () => {
        const navigate = jest.fn();
        const binding = await resolveActiveNotificationAccountBinding({
            data: {
                scheduleId: "42",
                recipientMemberId: "1",
                logicalEventKey: LOGICAL_EVENT_KEY,
            },
            getAuthEpoch: () => 8,
            isAuthSessionActive: () => false,
            getCurrentMemberId: async () => 1,
        });

        if (binding) navigate(binding);
        expect(binding).toBeUndefined();
        expect(navigate).not.toHaveBeenCalled();
    });

    test.each(["depart", "snooze"])(
        "logout-pending이면 %s API/cache/status/event side effect를 모두 0으로 유지한다",
        async () => {
            const serverMutation = jest.fn(async () => ({ ok: true }));
            const cacheMutation = jest.fn();
            const statusRefresh = jest.fn();
            const eventEmit = jest.fn();

            await expect(executeNotificationActionForActiveSession(
                8,
                () => false,
                serverMutation,
            )).rejects.toThrow("AUTH_SESSION_INACTIVE");

            expect(serverMutation).not.toHaveBeenCalled();
            expect(cacheMutation).not.toHaveBeenCalled();
            expect(statusRefresh).not.toHaveBeenCalled();
            expect(eventEmit).not.toHaveBeenCalled();
        },
    );

    test("A action 응답이 늦게 끝나는 동안 B로 전환되면 성공 side effect를 거부한다", async () => {
        let activeEpoch = 1;
        const actionResult = Promise.resolve({ ok: true });
        const action = jest.fn(() => {
            activeEpoch = 2;
            return actionResult;
        });

        await expect(executeNotificationActionForActiveSession(
            1,
            (epoch) => epoch === activeEpoch,
            action,
        )).rejects.toThrow("AUTH_SESSION_CHANGED");
        expect(action).toHaveBeenCalledTimes(1);
    });
});
