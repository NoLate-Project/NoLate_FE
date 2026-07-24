jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: jest.fn(() => true),
}));

import {
    advanceAuthSessionEpoch,
    getAuthSessionEpoch,
} from "../src/modules/auth/authSessionEpoch";
import {
    runNotificationPresentationMutation,
} from "../src/modules/notification/notificationPresentationCoordinator";
import {
    clearDeliveredNotificationsForAuthSession,
} from "../src/modules/notification/notificationSessionCleanup";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function createNotificationsApi(options: {
    dismiss?: () => Promise<void>;
} = {}) {
    return {
        dismissAllNotificationsAsync: jest.fn(
            options.dismiss ?? (async () => undefined),
        ),
        setBadgeCountAsync: jest.fn(async () => true),
        clearLastNotificationResponse: jest.fn(),
    };
}

describe("notification tray auth-session cleanup", () => {
    test("A logout은 delivered notifications, badge, initial response를 정리한다", async () => {
        const Notifications = createNotificationsApi();
        const authEpoch = getAuthSessionEpoch();

        await expect(clearDeliveredNotificationsForAuthSession({
            authEpoch,
            loadNotifications: async () => Notifications,
        })).resolves.toBe(true);

        expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
        expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
        expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    });

    test("module load 중 B session이 시작되면 stale A cleanup은 B tray를 건드리지 않는다", async () => {
        const moduleLoad = deferred<ReturnType<typeof createNotificationsApi>>();
        const Notifications = createNotificationsApi();
        const aEpoch = getAuthSessionEpoch();
        const cleanup = clearDeliveredNotificationsForAuthSession({
            authEpoch: aEpoch,
            loadNotifications: () => moduleLoad.promise,
        });

        advanceAuthSessionEpoch();
        const delivered: string[] = [];
        await runNotificationPresentationMutation(async () => {
            delivered.push("B-notification");
        });
        moduleLoad.resolve(Notifications);

        await expect(cleanup).resolves.toBe(false);
        expect(Notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();
        expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
        expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();
        expect(delivered).toEqual(["B-notification"]);
    });

    test("이미 시작된 A native cleanup 뒤에 B notification을 직렬화해 B 알림을 보존한다", async () => {
        const dismiss = deferred<void>();
        const dismissStarted = deferred<void>();
        const delivered = ["A-notification"];
        const Notifications = createNotificationsApi({
            dismiss: async () => {
                dismissStarted.resolve();
                await dismiss.promise;
                delivered.splice(0, delivered.length);
            },
        });
        const cleanup = clearDeliveredNotificationsForAuthSession({
            authEpoch: getAuthSessionEpoch(),
            loadNotifications: async () => Notifications,
        });
        await dismissStarted.promise;

        advanceAuthSessionEpoch();
        const bPresentation = runNotificationPresentationMutation(async () => {
            delivered.push("B-notification");
        });
        expect(delivered).toEqual(["A-notification"]);

        dismiss.resolve();
        await cleanup;
        await bPresentation;

        expect(delivered).toEqual(["B-notification"]);
    });
});
