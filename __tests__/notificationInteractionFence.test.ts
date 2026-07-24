import {
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    beginAuthLogoutSession,
    getAuthSessionEpoch,
    isAuthSessionActive,
} from "../src/modules/auth/authSessionEpoch";
import {
    scheduleNotificationInteractionForAuthSession,
} from "../src/modules/notification/notificationInteractionFence";

function createInteractionQueue() {
    const callbacks: Array<() => void> = [];
    return {
        schedule: (callback: () => void) => {
            callbacks.push(callback);
            return {
                cancel: () => {
                    const index = callbacks.indexOf(callback);
                    if (index >= 0) callbacks.splice(index, 1);
                },
            };
        },
        flush: () => {
            callbacks.splice(0).forEach((callback) => callback());
        },
    };
}

describe("notification InteractionManager auth fence", () => {
    beforeEach(() => {
        const epoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(epoch);
    });

    test("A failure 예약 뒤 logout/switch하면 interactions flush가 Alert를 띄우지 않는다", () => {
        const queue = createInteractionQueue();
        const showAlert = jest.fn();
        const aEpoch = getAuthSessionEpoch();

        scheduleNotificationInteractionForAuthSession({
            authEpoch: aEpoch,
            isAuthSessionActive,
            schedule: queue.schedule,
            action: showAlert,
        });
        beginAuthLogoutSession();
        const bEpoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(bEpoch);
        queue.flush();

        expect(showAlert).not.toHaveBeenCalled();
    });

    test("현재 B session의 새 failure는 interactions flush에서 정확히 한 번 표시한다", () => {
        const queue = createInteractionQueue();
        const showAlert = jest.fn();

        scheduleNotificationInteractionForAuthSession({
            authEpoch: getAuthSessionEpoch(),
            isAuthSessionActive,
            schedule: queue.schedule,
            action: showAlert,
        });
        queue.flush();
        queue.flush();

        expect(showAlert).toHaveBeenCalledTimes(1);
    });
});
