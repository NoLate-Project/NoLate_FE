import {
    createCanonicalNotificationEventKey,
    createNotificationEventConsumer,
    getExpoNotificationProviderMessageId,
    withCanonicalNotificationEventKey,
} from "../src/modules/notification/notificationEventKey";
import { configureNotificationOpenLifecycle } from "../src/modules/notification/notificationOpenLifecycle";

type ExpoResponse = {
    id: string;
    data: Record<string, unknown>;
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
});
