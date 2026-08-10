import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    CALENDAR_VIEW_MODE_STORAGE_KEY,
    getCachedCalendarViewModePreference,
    loadCalendarViewModePreference,
    rememberCalendarViewModePreference,
    resetCalendarViewModePreferenceCacheForTests,
} from "../src/modules/schedule/components/calendar/calendarViewModePreference";

const mockedGetItem = jest.mocked(AsyncStorage.getItem);
const mockedSetItem = jest.mocked(AsyncStorage.setItem);

describe("calendar view mode preference", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetCalendarViewModePreferenceCacheForTests();
        mockedGetItem.mockResolvedValue(null);
        mockedSetItem.mockResolvedValue(undefined);
    });

    it.each(["stack", "detail", "list"] as const)(
        "restores the saved %s mode",
        async (storedMode) => {
            mockedGetItem.mockResolvedValue(storedMode);

            await expect(loadCalendarViewModePreference()).resolves.toBe(storedMode);
            expect(mockedGetItem).toHaveBeenCalledWith(CALENDAR_VIEW_MODE_STORAGE_KEY);
            expect(getCachedCalendarViewModePreference()).toBe(storedMode);
        }
    );

    it.each([null, "", "week", "unknown"])(
        "falls back to detail for a non-selectable stored value: %p",
        async (storedMode) => {
            mockedGetItem.mockResolvedValue(storedMode);

            await expect(loadCalendarViewModePreference()).resolves.toBe("detail");
            expect(getCachedCalendarViewModePreference()).toBe("detail");
        }
    );

    it("uses the in-memory preference on a later route mount", async () => {
        mockedGetItem.mockResolvedValue("stack");

        await expect(loadCalendarViewModePreference()).resolves.toBe("stack");
        await expect(loadCalendarViewModePreference()).resolves.toBe("stack");

        expect(mockedGetItem).toHaveBeenCalledTimes(1);
    });

    it("deduplicates simultaneous cold-start reads", async () => {
        let resolveRead!: (value: string | null) => void;
        mockedGetItem.mockImplementationOnce(() => new Promise((resolve) => {
            resolveRead = resolve;
        }));

        const firstRestore = loadCalendarViewModePreference();
        const secondRestore = loadCalendarViewModePreference();

        expect(secondRestore).toBe(firstRestore);
        expect(mockedGetItem).toHaveBeenCalledTimes(1);

        resolveRead("stack");
        await expect(firstRestore).resolves.toBe("stack");
    });

    it("remembers a user selection immediately and persists it", () => {
        expect(rememberCalendarViewModePreference("list")).toBe(true);

        expect(getCachedCalendarViewModePreference()).toBe("list");
        expect(mockedSetItem).toHaveBeenCalledWith(
            CALENDAR_VIEW_MODE_STORAGE_KEY,
            "list"
        );
    });

    it("does not persist the internal week mode", () => {
        expect(rememberCalendarViewModePreference("week")).toBe(false);

        expect(getCachedCalendarViewModePreference()).toBeNull();
        expect(mockedSetItem).not.toHaveBeenCalled();
    });

    it("does not let a late storage read overwrite a newer selection", async () => {
        let resolveRead!: (value: string | null) => void;
        mockedGetItem.mockImplementationOnce(() => new Promise((resolve) => {
            resolveRead = resolve;
        }));

        const pendingRestore = loadCalendarViewModePreference();
        rememberCalendarViewModePreference("list");
        resolveRead("stack");

        await expect(pendingRestore).resolves.toBe("list");
        expect(getCachedCalendarViewModePreference()).toBe("list");
    });

    it("keeps the current session usable when storage fails", async () => {
        mockedGetItem.mockRejectedValueOnce(new Error("read failed"));

        await expect(loadCalendarViewModePreference()).resolves.toBe("detail");
        expect(getCachedCalendarViewModePreference()).toBeNull();

        mockedSetItem.mockRejectedValueOnce(new Error("write failed"));
        expect(rememberCalendarViewModePreference("stack")).toBe(true);
        await Promise.resolve();

        expect(getCachedCalendarViewModePreference()).toBe("stack");
    });
});
