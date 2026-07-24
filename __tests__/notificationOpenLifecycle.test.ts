import {
    createCanonicalNotificationEventKey,
    createNotificationEventConsumer,
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
    test("Expo와 Firebase 식별자가 달라도 동일 payload navigation은 한 번만 소비한다", () => {
        const data = { type: "SCHEDULE_TRAFFIC", scheduleId: "42", sentAt: "2026-07-24T09:00:00Z" };
        const expoKey = createCanonicalNotificationEventKey(data, "expo-request");
        const firebaseKey = createCanonicalNotificationEventKey(data, "firebase-message");
        const consumer = createNotificationEventConsumer();

        expect(expoKey).toBe(firebaseKey);
        expect(consumer.consume(expoKey, 1_000)).toBe(true);
        expect(consumer.consume(firebaseKey, 1_001)).toBe(false);
    });

    test("foreground에서 local Expo 알림에 심은 canonical key도 Firebase 원본과 같다", () => {
        const data = { type: "SCHEDULE_TRAFFIC", scheduleId: "42" };
        const firebaseKey = createCanonicalNotificationEventKey(data, "firebase-message");
        const localData = withCanonicalNotificationEventKey(data, "firebase-message");

        expect(createCanonicalNotificationEventKey(localData, "expo-request")).toBe(firebaseKey);
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

    test("terminated 초기 Expo와 Firebase 동일 이벤트를 모두 소비·정리하되 navigation은 한 번이다", async () => {
        const data = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
            eventId: "traffic-42-100",
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
            getInitialFirebase: async () => ({ messageId: "firebase-id", data }),
            getLastExpoResponse: () => ({ id: "expo-id", data }),
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
