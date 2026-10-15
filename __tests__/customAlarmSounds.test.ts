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

    test("exposes ten distinct, user-facing choices in canonical order", () => {
        expect(NOLATE_ALARM_SOUNDS).toEqual([
            { id: "CHIME", label: "차임" },
            { id: "BELL", label: "벨" },
            { id: "BEEP", label: "비프" },
            { id: "DIGITAL", label: "디지털" },
            { id: "CRYSTAL", label: "크리스털" },
            { id: "KNOCK", label: "노크" },
            { id: "TRIPLE", label: "3연속" },
            { id: "SWEEP", label: "상승 신호" },
            { id: "SIREN", label: "사이렌" },
            { id: "KLAXON", label: "경적" },
        ]);
        expect(new Set(NOLATE_ALARM_SOUNDS.map(sound => sound.id)).size).toBe(10);
    });

    test("persists and restores the final catalog sound", async () => {
        await setNoLateAlarmSoundPreference("KLAXON");
        expect(await getNoLateAlarmSoundPreference()).toBe("KLAXON");
        expect(
            await AsyncStorage.getItem(NOLATE_ALARM_SOUND_TEST_CONSTANTS!.storageKey),
        ).toBe("KLAXON");

        resetNoLateAlarmSoundPreferenceForTests();
        expect(await getNoLateAlarmSoundPreference()).toBe("KLAXON");
        expect(getNoLateAlarmSound("KLAXON").label).toBe("경적");
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
