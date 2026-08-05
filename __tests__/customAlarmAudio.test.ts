const mockSetAudioModeAsync = jest.fn();
const mockCreateAsync = jest.fn();

type MockSound = {
    setIsMutedAsync: jest.Mock;
    stopAsync: jest.Mock;
    unloadAsync: jest.Mock;
};

const mockSounds: MockSound[] = [];

jest.mock("expo-av", () => ({
    InterruptionModeAndroid: { DuckOthers: 2 },
    InterruptionModeIOS: { MixWithOthers: 0 },
    Audio: {
        setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
        Sound: {
            createAsync: (...args: unknown[]) => mockCreateAsync(...args),
        },
    },
}));
jest.mock("../assets/sounds/nolate_departure_chime.wav", () => 1);
jest.mock("../assets/sounds/nolate_alarm_bell.wav", () => 2);
jest.mock("../assets/sounds/nolate_alarm_beep.wav", () => 3);

import {
    startNoLateCustomAlarmAudio,
    type NoLateCustomAlarmAudioSession,
} from "../src/modules/notification/customAlarmAudio";

const ALARM_MODE = {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
};
const NEUTRAL_MODE = {
    ...ALARM_MODE,
    interruptionModeIOS: 0,
    playsInSilentModeIOS: false,
    interruptionModeAndroid: 2,
};

describe("NoLate custom alarm audio", () => {
    let sessions: NoLateCustomAlarmAudioSession[] = [];

    beforeEach(() => {
        sessions = [];
        mockSounds.length = 0;
        mockSetAudioModeAsync.mockReset().mockResolvedValue(undefined);
        mockCreateAsync.mockReset().mockImplementation(() => {
            const sound: MockSound = {
                setIsMutedAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
                stopAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
                unloadAsync: jest.fn().mockResolvedValue({ isLoaded: false }),
            };
            mockSounds.push(sound);
            return Promise.resolve({ sound });
        });
    });

    afterEach(async () => {
        await Promise.allSettled(sessions.reverse().map((session) => session.stop()));
    });

    async function startSession(): Promise<NoLateCustomAlarmAudioSession> {
        const session = await startNoLateCustomAlarmAudio();
        sessions.push(session);
        return session;
    }

    test("starts a bundled looping sound and restores neutral audio mode after stop", async () => {
        const session = await startSession();

        expect(mockSetAudioModeAsync).toHaveBeenNthCalledWith(1, ALARM_MODE);
        expect(mockCreateAsync).toHaveBeenCalledWith(
            expect.anything(),
            {
                shouldPlay: true,
                isLooping: true,
                volume: 1,
            },
        );

        await session.setMuted(true);
        expect(mockSounds[0].setIsMutedAsync).toHaveBeenCalledWith(true);

        await session.stop();
        expect(mockSounds[0].stopAsync).toHaveBeenCalledTimes(1);
        expect(mockSounds[0].unloadAsync).toHaveBeenCalledTimes(1);
        expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(NEUTRAL_MODE);
    });

    test.each([
        ["CHIME", 1],
        ["BELL", 2],
        ["BEEP", 3],
    ] as const)("plays the selected %s sound asset", async (soundId, expectedAsset) => {
        const session = await startNoLateCustomAlarmAudio(soundId);
        sessions.push(session);

        expect(mockCreateAsync).toHaveBeenLastCalledWith(
            expectedAsset,
            expect.objectContaining({ shouldPlay: true, isLooping: true }),
        );
    });

    test("starting a new process-wide session stops and unloads the previous one", async () => {
        const first = await startSession();
        const second = await startSession();

        expect(mockSounds).toHaveLength(2);
        expect(mockSounds[0].stopAsync).toHaveBeenCalledTimes(1);
        expect(mockSounds[0].unloadAsync).toHaveBeenCalledTimes(1);
        expect(mockSounds[1].stopAsync).not.toHaveBeenCalled();
        expect(mockSounds[0].unloadAsync.mock.invocationCallOrder[0]).toBeLessThan(
            mockCreateAsync.mock.invocationCallOrder[1],
        );

        await first.setMuted(true);
        expect(mockSounds[0].setIsMutedAsync).not.toHaveBeenCalled();
        await second.setMuted(true);
        expect(mockSounds[1].setIsMutedAsync).toHaveBeenCalledWith(true);

        await first.stop();
        expect(mockSetAudioModeAsync).not.toHaveBeenCalledWith(NEUTRAL_MODE);
        await second.stop();
        expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(NEUTRAL_MODE);
    });

    test("an old stop cannot restore neutral mode while a newer start is waiting", async () => {
        const first = await startSession();
        let finishOldStop: (status: { isLoaded: boolean }) => void = () => undefined;
        mockSounds[0].stopAsync.mockImplementationOnce(() => new Promise((resolve) => {
            finishOldStop = resolve;
        }));

        const oldStop = first.stop();
        const newerStart = startNoLateCustomAlarmAudio();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockSetAudioModeAsync).not.toHaveBeenCalledWith(NEUTRAL_MODE);
        finishOldStop({ isLoaded: true });
        await oldStop;
        const second = await newerStart;
        sessions.push(second);

        const neutralCallsBeforeFinalStop = mockSetAudioModeAsync.mock.calls.filter(
            ([mode]) => mode.playsInSilentModeIOS === false,
        );
        expect(neutralCallsBeforeFinalStop).toHaveLength(0);
        expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(ALARM_MODE);

        await second.stop();
        expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(NEUTRAL_MODE);
    });

    test("stops and unloads exactly once when cleanup races a button action", async () => {
        const session = await startSession();

        await Promise.all([session.stop(), session.stop()]);

        expect(mockSounds[0].stopAsync).toHaveBeenCalledTimes(1);
        expect(mockSounds[0].unloadAsync).toHaveBeenCalledTimes(1);
        expect(mockSetAudioModeAsync).toHaveBeenCalledWith(NEUTRAL_MODE);
        await session.setMuted(true);
        expect(mockSounds[0].setIsMutedAsync).not.toHaveBeenCalled();
    });

    test("restores neutral mode when the latest sound cannot be created", async () => {
        mockCreateAsync.mockRejectedValueOnce(new Error("create failed"));

        await expect(startNoLateCustomAlarmAudio()).rejects.toThrow("create failed");

        expect(mockSetAudioModeAsync).toHaveBeenNthCalledWith(1, ALARM_MODE);
        expect(mockSetAudioModeAsync).toHaveBeenNthCalledWith(2, NEUTRAL_MODE);
    });
});
