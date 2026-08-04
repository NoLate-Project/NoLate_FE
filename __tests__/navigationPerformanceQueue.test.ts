import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import { postNavigationPerformanceEvents } from "../src/api/performance";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    activateNavigationPerformanceQueue,
    drainNavigationPerformanceQueue,
    NAVIGATION_PERFORMANCE_QUEUE_TEST_CONSTANTS,
    recordNavigationPerformance,
    resetNavigationPerformanceQueueForTests,
} from "../src/modules/performance/navigationPerformanceQueue";

jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

jest.mock("expo-constants", () => ({
    __esModule: true,
    default: {
        nativeApplicationVersion: "1.2.0",
        nativeBuildVersion: "42",
    },
}));

jest.mock("../src/api/performance", () => ({
    postNavigationPerformanceEvents: jest.fn().mockResolvedValue({
        acceptedCount: 1,
        storedCount: 1,
    }),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn().mockResolvedValue({ id: 7 }),
}));

const mockedPostEvents = jest.mocked(postNavigationPerformanceEvents);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedRandomUuid = jest.mocked(Crypto.randomUUID);

describe("navigationPerformanceQueue", () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        resetNavigationPerformanceQueueForTests();
        await AsyncStorage.clear();
        mockedGetAuthMember.mockResolvedValue({ id: 7 });
        mockedRandomUuid.mockReturnValue("11111111-1111-4111-8111-111111111111");
        mockedPostEvents.mockResolvedValue({ acceptedCount: 1, storedCount: 1 });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("persists first, batches the normalized payload, and removes it after success", async () => {
        await activateNavigationPerformanceQueue();
        await recordNavigationPerformance({
            id: 1,
            action: "PUSH",
            fromRoute: "/schedule",
            toRoute: "/schedule/739?source=calendar",
            routeReadyMs: 75,
            totalMs: 240,
            completedBy: "transition",
            startedAtEpochMs: Date.parse("2026-08-04T01:02:03Z"),
        });

        const key = NAVIGATION_PERFORMANCE_QUEUE_TEST_CONSTANTS!.storageKeyForMember(7);
        expect(await AsyncStorage.getItem(key)).toContain("/schedule/[id]");

        expect(await drainNavigationPerformanceQueue()).toBe(1);
        expect(mockedPostEvents).toHaveBeenCalledWith([
            expect.objectContaining({
                eventId: "11111111-1111-4111-8111-111111111111",
                fromRoute: "/schedule",
                toRoute: "/schedule/[id]",
                routeReadyMs: 75,
                totalMs: 240,
                completionKind: "TRANSITION",
            }),
        ]);
        expect(await AsyncStorage.getItem(key)).toBeNull();
    });

    it("keeps the durable batch when the server is unavailable", async () => {
        mockedPostEvents.mockRejectedValueOnce(new Error("offline"));
        await activateNavigationPerformanceQueue();
        await recordNavigationPerformance({
            id: 1,
            action: "REPLACE",
            fromRoute: "/profile",
            toRoute: "/schedule",
            routeReadyMs: 20,
            totalMs: 60,
            completedBy: "frame",
            startedAtEpochMs: Date.now(),
        });

        expect(await drainNavigationPerformanceQueue()).toBe(0);
        const key = NAVIGATION_PERFORMANCE_QUEUE_TEST_CONSTANTS!.storageKeyForMember(7);
        expect(await AsyncStorage.getItem(key)).toContain("11111111-1111-4111-8111-111111111111");
    });
});
