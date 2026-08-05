import AsyncStorage from "@react-native-async-storage/async-storage";

export const NOLATE_ALARM_SOUNDS = [
    { id: "CHIME", label: "차임" },
    { id: "BELL", label: "벨" },
    { id: "BEEP", label: "비프" },
] as const;

export type NoLateAlarmSoundId = (typeof NOLATE_ALARM_SOUNDS)[number]["id"];

export const DEFAULT_NOLATE_ALARM_SOUND_ID: NoLateAlarmSoundId = "CHIME";

const STORAGE_KEY = "@nolate/custom-alarm-sound/v1";

let cachedSoundId: NoLateAlarmSoundId | undefined;
let storageRevision = 0;
let storageWriteQueue: Promise<void> = Promise.resolve();

export function normalizeNoLateAlarmSoundId(value: unknown): NoLateAlarmSoundId {
    return NOLATE_ALARM_SOUNDS.some(sound => sound.id === value)
        ? (value as NoLateAlarmSoundId)
        : DEFAULT_NOLATE_ALARM_SOUND_ID;
}

export function getNoLateAlarmSound(soundId: NoLateAlarmSoundId) {
    return NOLATE_ALARM_SOUNDS.find(sound => sound.id === soundId) ?? NOLATE_ALARM_SOUNDS[0];
}

export async function getNoLateAlarmSoundPreference(): Promise<NoLateAlarmSoundId> {
    if (cachedSoundId) return cachedSoundId;

    const revision = storageRevision;
    try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        const normalized = normalizeNoLateAlarmSoundId(stored);
        if (revision === storageRevision) cachedSoundId = normalized;
        return revision === storageRevision ? normalized : cachedSoundId ?? DEFAULT_NOLATE_ALARM_SOUND_ID;
    } catch {
        return cachedSoundId ?? DEFAULT_NOLATE_ALARM_SOUND_ID;
    }
}

export async function setNoLateAlarmSoundPreference(soundId: NoLateAlarmSoundId): Promise<void> {
    const normalized = normalizeNoLateAlarmSoundId(soundId);
    const revision = ++storageRevision;
    const write = storageWriteQueue.then(() => AsyncStorage.setItem(STORAGE_KEY, normalized));
    storageWriteQueue = write.catch(() => undefined);
    await write;
    if (revision === storageRevision) cachedSoundId = normalized;
}

export function resetNoLateAlarmSoundPreferenceForTests(): void {
    cachedSoundId = undefined;
    storageRevision += 1;
}

export const NOLATE_ALARM_SOUND_TEST_CONSTANTS =
    process.env.NODE_ENV === "test"
        ? {
              storageKey: STORAGE_KEY,
          }
        : undefined;
