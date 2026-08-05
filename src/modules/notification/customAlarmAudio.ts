import {
    Audio,
    InterruptionModeAndroid,
    InterruptionModeIOS,
    type AVPlaybackStatus,
} from "expo-av";

import {
    DEFAULT_NOLATE_ALARM_SOUND_ID,
    type NoLateAlarmSoundId,
} from "./customAlarmSounds";

export type NoLateCustomAlarmAudioSession = {
    setMuted: (muted: boolean) => Promise<void>;
    stop: () => Promise<void>;
};

type AlarmSound = Awaited<ReturnType<typeof Audio.Sound.createAsync>>["sound"];

type ActiveAudioSession = {
    generation: number;
    released: boolean;
    sound: AlarmSound;
};

const NOLATE_ALARM_LOOPS: Record<NoLateAlarmSoundId, number> = {
    CHIME: require("../../../assets/sounds/nolate_departure_chime.wav"),
    BELL: require("../../../assets/sounds/nolate_alarm_bell.wav"),
    BEEP: require("../../../assets/sounds/nolate_alarm_beep.wav"),
};
const ALARM_AUDIO_MODE = {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
} as const;
const NEUTRAL_AUDIO_MODE = {
    allowsRecordingIOS: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    playsInSilentModeIOS: false,
    staysActiveInBackground: false,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
} as const;

let activeSession: ActiveAudioSession | null = null;
let latestRequestedGeneration = 0;
let lifecycleQueue: Promise<void> = Promise.resolve();

export function startNoLateCustomAlarmAudio(
    soundId: NoLateAlarmSoundId = DEFAULT_NOLATE_ALARM_SOUND_ID,
): Promise<NoLateCustomAlarmAudioSession> {
    const generation = ++latestRequestedGeneration;

    return enqueueAudioLifecycle(async () => {
        if (activeSession) {
            const previousSession = activeSession;
            activeSession = null;
            await releaseSession(previousSession);
        }

        let sound: AlarmSound;
        try {
            await Audio.setAudioModeAsync(ALARM_AUDIO_MODE);
            ({ sound } = await Audio.Sound.createAsync(
                NOLATE_ALARM_LOOPS[soundId] ?? NOLATE_ALARM_LOOPS[DEFAULT_NOLATE_ALARM_SOUND_ID],
                {
                    shouldPlay: true,
                    isLooping: true,
                    volume: 1,
                },
            ));
        } catch (error) {
            if (generation === latestRequestedGeneration && activeSession === null) {
                await restoreNeutralAudioMode();
            }
            throw error;
        }

        const session: ActiveAudioSession = {
            generation,
            released: false,
            sound,
        };
        activeSession = session;

        return {
            async setMuted(muted: boolean) {
                await enqueueAudioLifecycle(async () => {
                    if (session.released || activeSession !== session) return;
                    await session.sound.setIsMutedAsync(muted);
                });
            },
            async stop() {
                await enqueueAudioLifecycle(async () => {
                    if (session.released) return;

                    const ownsActiveSession = activeSession === session;
                    if (ownsActiveSession) activeSession = null;
                    await releaseSession(session);

                    // A newer start request may already be waiting in the queue. In that case,
                    // leaving the alarm audio mode in place prevents this old cleanup from
                    // racing the new session's setup.
                    if (
                        ownsActiveSession &&
                        activeSession === null &&
                        generation === latestRequestedGeneration
                    ) {
                        await restoreNeutralAudioMode();
                    }
                });
            },
        };
    });
}

function enqueueAudioLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycleQueue.then(operation, operation);
    lifecycleQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

async function releaseSession(session: ActiveAudioSession): Promise<void> {
    if (session.released) return;
    session.released = true;
    await settlePlaybackOperation(() => session.sound.stopAsync());
    await settlePlaybackOperation(() => session.sound.unloadAsync());
}

async function restoreNeutralAudioMode(): Promise<void> {
    try {
        await Audio.setAudioModeAsync(NEUTRAL_AUDIO_MODE);
    } catch {
        // The OS can reject audio-mode changes while the app is tearing down.
    }
}

async function settlePlaybackOperation(
    operation: () => Promise<AVPlaybackStatus>,
): Promise<void> {
    try {
        await operation();
    } catch {
        // The OS may already have released the player while the alarm screen is closing.
    }
}
