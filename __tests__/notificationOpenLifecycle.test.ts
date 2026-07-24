import {
    createCanonicalNotificationEventKey,
    createNotificationEventConsumer,
    consumeNotificationEventAfterValidation,
    getExpoNotificationProviderMessageId,
    withCanonicalNotificationEventKey,
} from "../src/modules/notification/notificationEventKey";
import { configureNotificationOpenLifecycle } from "../src/modules/notification/notificationOpenLifecycle";

type ExpoResponse = {
    id: string;
    data: Record<string, unknown>;
    actionIdentifier?: string;
};

type FirebaseMessage = {
    messageId: string;
    data: Record<string, unknown>;
};

describe("notification canonical event consumption", () => {
    test("provider message ID가 같으면 Expo/Firebase payload shape가 달라도 한 번만 소비한다", () => {
        const expoData = { type: "SCHEDULE_TRAFFIC", scheduleId: "42", extra: "local" };
        const firebaseData = { type: "SCHEDULE_TRAFFIC", scheduleId: "42", sentAt: "server" };
        const expoKey = createCanonicalNotificationEventKey(expoData, "firebase-message");
        const firebaseKey = createCanonicalNotificationEventKey(firebaseData, "firebase-message");
        const consumer = createNotificationEventConsumer();

        expect(expoKey).toBe(firebaseKey);
        expect(consumer.consume(expoKey, 1_000)).toBe(true);
        expect(consumer.consume(firebaseKey, 1_001)).toBe(false);
    });

    test("backend logical event key는 provider ID보다 우선한다", () => {
        expect(createCanonicalNotificationEventKey(
            { logicalEventKey: "traffic-42-v2" },
            "provider-1",
        )).toBe("logical:traffic-42-v2");
        expect(createCanonicalNotificationEventKey(
            { logicalEventKey: "traffic-42-v2", extra: "different" },
            "provider-2",
        )).toBe("logical:traffic-42-v2");
    });

    test("foreground에서 local Expo 알림에 심은 canonical key도 Firebase 원본과 같다", () => {
        const data = { type: "SCHEDULE_TRAFFIC", scheduleId: "42" };
        const firebaseKey = createCanonicalNotificationEventKey(data, "firebase-message");
        const localData = withCanonicalNotificationEventKey(data, "firebase-message");

        expect(createCanonicalNotificationEventKey(localData, "expo-request")).toBe(firebaseKey);
    });

    test("Expo Android trigger의 Firebase messageId를 canonical provider id로 읽는다", () => {
        expect(getExpoNotificationProviderMessageId({
            notification: {
                request: {
                    trigger: {
                        remoteMessage: { messageId: "provider-42" },
                    },
                },
            },
        })).toBe("provider-42");
    });

    test("malformed/stale payload는 key를 소비하지 않아 정상 Firebase가 같은 key를 사용할 수 있다", () => {
        const consumer = createNotificationEventConsumer();
        const key = "logical:valid-after-malformed";
        expect(consumeNotificationEventAfterValidation(consumer, key, false, 1)).toBe(false);
        expect(consumeNotificationEventAfterValidation(consumer, key, true, 2)).toBe(true);
    });
});
describe("background and terminated notification open lifecycle", () => {
    test("background Expo/Firebase listener를 연결하고 해제한다", async () => {
        let expoListener: ((response: ExpoResponse) => void) | undefined;
        let firebaseListener: ((message: FirebaseMessage) => void) | undefined;
        const removeExpo = jest.fn();
        const removeFirebase = jest.fn();
        const handleExpoResponse = jest.fn();
        const handleFirebaseMessage = jest.fn();

        const unsubscribe = await configureNotificationOpenLifecycle({
            addExpoResponseListener: (listener) => {
                expoListener = listener;
                return { remove: removeExpo };
            },
            onFirebaseOpened: (listener) => {
                firebaseListener = listener;
                return removeFirebase;
            },
            getInitialFirebase: async () => null,
            getLastExpoResponse: () => null,
        }, {
            handleExpoResponse,
            handleFirebaseMessage,
        });

        expoListener?.({ id: "expo", data: { scheduleId: "42" } });
        firebaseListener?.({ messageId: "firebase", data: { scheduleId: "42" } });

        expect(handleExpoResponse).toHaveBeenCalledTimes(1);
        expect(handleFirebaseMessage).toHaveBeenCalledTimes(1);

        unsubscribe();
        expect(removeExpo).toHaveBeenCalledTimes(1);
        expect(removeFirebase).toHaveBeenCalledTimes(1);
    });

    test("terminated Firebase initial을 우선하고 stale Expo response는 정리만 한다", async () => {
        const firebaseData = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
            eventId: "current-42",
        };
        const staleExpoData = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "7",
            eventId: "stale-7",
        };
        const openSchedule = jest.fn();
        const clearLastExpoResponse = jest.fn();
        const consumer = createNotificationEventConsumer();
        const handle = (eventData: Record<string, unknown>, providerId: string) => {
            if (consumer.consume(createCanonicalNotificationEventKey(eventData, providerId))) {
                openSchedule(eventData.scheduleId);
            }
        };

        const unsubscribe = await configureNotificationOpenLifecycle<ExpoResponse, FirebaseMessage>({
            onFirebaseOpened: () => jest.fn(),
            getInitialFirebase: async () => ({ messageId: "firebase-id", data: firebaseData }),
            getLastExpoResponse: () => ({ id: "expo-id", data: staleExpoData }),
            clearLastExpoResponse,
        }, {
            handleExpoResponse: (response) => handle(response.data, response.id),
            handleFirebaseMessage: (message) => handle(message.data, message.messageId),
        });

        expect(openSchedule).toHaveBeenCalledTimes(1);
        expect(openSchedule).toHaveBeenCalledWith("42");
        expect(clearLastExpoResponse).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    test("same-key terminated Expo action은 1회 실행하고 Firebase navigation도 전달한다", async () => {
        const handleExpoResponse = jest.fn();
        const handleFirebaseMessage = jest.fn();
        const data = { logicalEventKey: "reminder-42", scheduleId: "42" };

        await configureNotificationOpenLifecycle<ExpoResponse, FirebaseMessage>({
            onFirebaseOpened: () => jest.fn(),
            getInitialFirebase: async () => ({ messageId: "fcm", data }),
            getLastExpoResponse: () => ({
                id: "expo",
                data,
                actionIdentifier: "depart",
            }),
            clearLastExpoResponse: jest.fn(),
        }, {
            handleExpoResponse,
            handleFirebaseMessage,
            getExpoEventKey: (response) =>
                createCanonicalNotificationEventKey(response.data, response.id),
            getFirebaseEventKey: (message) =>
                createCanonicalNotificationEventKey(message.data, message.messageId),
            isExpoAction: (response) => response.actionIdentifier === "depart",
        });

        expect(handleExpoResponse).toHaveBeenCalledTimes(1);
        expect(handleFirebaseMessage).toHaveBeenCalledTimes(1);
    });

    test("different stale Expo action은 Firebase initial이 있으면 폐기한다", async () => {
        const handleExpoResponse = jest.fn();
        const handleFirebaseMessage = jest.fn();

        await configureNotificationOpenLifecycle<ExpoResponse, FirebaseMessage>({
            onFirebaseOpened: () => jest.fn(),
            getInitialFirebase: async () => ({
                messageId: "fcm",
                data: { logicalEventKey: "current", scheduleId: "42" },
            }),
            getLastExpoResponse: () => ({
                id: "expo",
                data: { logicalEventKey: "stale", scheduleId: "7" },
                actionIdentifier: "depart",
            }),
        }, {
            handleExpoResponse,
            handleFirebaseMessage,
            getExpoEventKey: (response) =>
                createCanonicalNotificationEventKey(response.data, response.id),
            getFirebaseEventKey: (message) =>
                createCanonicalNotificationEventKey(message.data, message.messageId),
            isExpoAction: () => true,
        });

        expect(handleExpoResponse).not.toHaveBeenCalled();
        expect(handleFirebaseMessage).toHaveBeenCalledTimes(1);
    });

    test("Expo-only action과 Firebase-only initial은 각각 전달한다", async () => {
        const expoHandler = jest.fn();
        await configureNotificationOpenLifecycle<ExpoResponse, FirebaseMessage>({
            onFirebaseOpened: () => jest.fn(),
            getInitialFirebase: async () => null,
            getLastExpoResponse: () => ({ id: "expo", data: {}, actionIdentifier: "depart" }),
        }, {
            handleExpoResponse: expoHandler,
            handleFirebaseMessage: jest.fn(),
        });
        expect(expoHandler).toHaveBeenCalledTimes(1);

        const firebaseHandler = jest.fn();
        await configureNotificationOpenLifecycle<ExpoResponse, FirebaseMessage>({
            onFirebaseOpened: () => jest.fn(),
            getInitialFirebase: async () => ({ messageId: "fcm", data: {} }),
            getLastExpoResponse: () => null,
        }, {
            handleExpoResponse: jest.fn(),
            handleFirebaseMessage: firebaseHandler,
        });
        expect(firebaseHandler).toHaveBeenCalledTimes(1);
    });
});
