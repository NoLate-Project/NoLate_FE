import * as SecureStore from "../src/modules/storage/secureStorage";
import {
    hasDeviceCalendarPermission,
} from "../src/modules/onboarding/deviceCalendarImport";
import {
    getStoredGoogleCalendarAccessToken,
    loadGoogleCalendarImportSummary,
} from "../src/modules/onboarding/googleCalendarImport";
import {
    clearCalendarConnectionSnapshot,
    getCalendarConnectionSnapshot,
    recordCalendarImportCompleted,
    recordCalendarScan,
    refreshCalendarConnectionSnapshotFromDevice,
} from "../src/modules/onboarding/calendarConnectionStorage";

jest.mock("../src/modules/storage/secureStorage", () => ({
    deleteItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

jest.mock("../src/modules/onboarding/deviceCalendarImport", () => ({
    getCalendarProviderLabel: jest.fn(() => "기기 캘린더"),
    getDeviceCalendarProvider: jest.fn(() => "APPLE_DEVICE"),
    hasDeviceCalendarPermission: jest.fn(),
    loadDeviceCalendarImportSummary: jest.fn(),
}));

jest.mock("../src/modules/onboarding/googleCalendarImport", () => ({
    getStoredGoogleCalendarAccessToken: jest.fn(),
    loadGoogleCalendarImportSummary: jest.fn(),
}));

const mockedGetItem = jest.mocked(SecureStore.getItemAsync);
const mockedDeleteItem = jest.mocked(SecureStore.deleteItemAsync);
const mockedSetItem = jest.mocked(SecureStore.setItemAsync);
const mockedHasDevicePermission = jest.mocked(hasDeviceCalendarPermission);
const mockedGetGoogleToken = jest.mocked(getStoredGoogleCalendarAccessToken);
const mockedLoadGoogleSummary = jest.mocked(loadGoogleCalendarImportSummary);

const STORED_SNAPSHOT = JSON.stringify({
    provider: "GOOGLE",
    providerLabel: "Google Calendar",
    providerLabels: ["Google Calendar"],
    status: "CONNECTED",
    calendarCount: 2,
    calendarNames: ["개인", "업무"],
    eventCandidateCount: 5,
    importedCount: 1,
    lastScannedAt: "2026-07-17T00:00:00.000Z",
});

describe("calendar connection refresh", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetItem.mockResolvedValue(STORED_SNAPSHOT);
        mockedDeleteItem.mockResolvedValue(undefined);
        mockedSetItem.mockResolvedValue(undefined);
        mockedHasDevicePermission.mockResolvedValue(false);
        mockedGetGoogleToken.mockResolvedValue(null);
    });

    it("clears a stale connected badge after every provider is disconnected", async () => {
        await expect(refreshCalendarConnectionSnapshotFromDevice()).resolves.toBeNull();

        expect(mockedDeleteItem).toHaveBeenCalledWith("nolate_calendar_connection_snapshot");
    });

    it("shows a retryable error instead of claiming Google is connected while verification fails", async () => {
        mockedGetGoogleToken.mockResolvedValue("google-access-token");
        mockedLoadGoogleSummary.mockRejectedValue(new Error("offline"));

        await expect(refreshCalendarConnectionSnapshotFromDevice()).rejects.toThrow(
            "Google Calendar 연결 상태를 확인하지 못했어요.",
        );
        expect(mockedDeleteItem).not.toHaveBeenCalled();
    });

    it("does not restore the previous account calendar snapshot when logout wins an in-flight refresh", async () => {
        let resolvePermission: ((allowed: boolean) => void) | undefined;
        mockedHasDevicePermission.mockImplementation(() => new Promise((resolve) => {
            resolvePermission = resolve;
        }));

        const refresh = refreshCalendarConnectionSnapshotFromDevice();
        await Promise.resolve();
        await clearCalendarConnectionSnapshot();
        resolvePermission?.(false);

        await expect(refresh).resolves.toBeNull();
        expect(mockedSetItem).not.toHaveBeenCalled();
    });

    it("keeps each import result when a rescan and another import are saved together", async () => {
        let stored = STORED_SNAPSHOT;
        mockedGetItem.mockImplementation(async () => stored);
        mockedSetItem.mockImplementation(async (_key, value) => { stored = value; });

        await recordCalendarImportCompleted(2, 1, 1);
        await Promise.all([
            recordCalendarScan({
                provider: "APPLE_DEVICE", providerLabel: "Apple 캘린더",
                calendarCount: 1, calendarNames: ["개인"], eventCandidateCount: 3,
            }),
            recordCalendarImportCompleted(1, 2, 0),
        ]);

        expect(await getCalendarConnectionSnapshot()).toMatchObject({
            importedCount: 4,
            importHistory: [
                { imported: 1, duplicate: 2, failed: 0, providerLabels: ["Apple 캘린더"] },
                { imported: 2, duplicate: 1, failed: 1, providerLabels: ["Google Calendar"] },
            ],
        });
    });
});
