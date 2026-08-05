import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    DEFAULT_NOLATE_ALARM_SOUND_ID,
    getNoLateAlarmSound,
    getNoLateAlarmSoundPreference,
    NOLATE_ALARM_SOUNDS,
    NOLATE_ALARM_SOUND_TEST_CONSTANTS,
    normalizeNoLateAlarmSoundId,
    resetNoLateAlarmSoundPreferenceForTests,
    setNoLateAlarmSoundPreference,
} from "../src/modules/notification/customAlarmSounds";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

describe("NoLate alarm sound preference", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        resetNoLateAlarmSoundPreferenceForTests();
    });

    test("exposes three distinct, user-facing choices", () => {
        expect(NOLATE_ALARM_SOUNDS).toEqual([
            { id: "CHIME", label: "차임" },
            { id: "BELL", label: "벨" },
            { id: "BEEP", label: "비프" },
        ]);
        expect(new Set(NOLATE_ALARM_SOUNDS.map(sound => sound.id)).size).toBe(3);
    });

    test("persists and restores the selected sound", async () => {
        await setNoLateAlarmSoundPreference("BELL");
        expect(await getNoLateAlarmSoundPreference()).toBe("BELL");
        expect(
            await AsyncStorage.getItem(NOLATE_ALARM_SOUND_TEST_CONSTANTS!.storageKey),
        ).toBe("BELL");

        resetNoLateAlarmSoundPreferenceForTests();
        expect(await getNoLateAlarmSoundPreference()).toBe("BELL");
        expect(getNoLateAlarmSound("BELL").label).toBe("벨");
    });

    test("falls back to CHIME for missing or forged values", async () => {
        expect(normalizeNoLateAlarmSoundId("UNKNOWN")).toBe(DEFAULT_NOLATE_ALARM_SOUND_ID);
        await AsyncStorage.setItem(NOLATE_ALARM_SOUND_TEST_CONSTANTS!.storageKey, "../../bad.wav");
        resetNoLateAlarmSoundPreferenceForTests();

        expect(await getNoLateAlarmSoundPreference()).toBe("CHIME");
    });

    test("serializes overlapping writes so the latest selection remains persisted", async () => {
        const firstWrite = deferred<void>();
        const writeOrder: string[] = [];
        let persistedValue: string | null = null;
        const setItemSpy = jest
            .spyOn(AsyncStorage, "setItem")
            .mockImplementationOnce(async (_key, value) => {
                writeOrder.push(`start:${value}`);
                await firstWrite.promise;
                persistedValue = value;
                writeOrder.push(`finish:${value}`);
            })
            .mockImplementation(async (_key, value) => {
                writeOrder.push(`start:${value}`);
                persistedValue = value;
                writeOrder.push(`finish:${value}`);
            });

        const bellWrite = setNoLateAlarmSoundPreference("BELL");
        await Promise.resolve();
        const beepWrite = setNoLateAlarmSoundPreference("BEEP");
        await Promise.resolve();

        expect(writeOrder).toEqual(["start:BELL"]);
        firstWrite.resolve();
        await Promise.all([bellWrite, beepWrite]);
        expect(writeOrder).toEqual(["start:BELL", "finish:BELL", "start:BEEP", "finish:BEEP"]);
        expect(persistedValue).toBe("BEEP");

        setItemSpy.mockRestore();
        expect(await getNoLateAlarmSoundPreference()).toBe("BEEP");
    });
});
