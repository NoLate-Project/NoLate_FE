import {
    NativeEventEmitter,
    NativeModules,
    Platform,
    type EmitterSubscription,
} from "react-native";

export type NoLateAudioSpectrumFrame = {
    waveform?: number[];
    bands?: number[];
    rms?: number;
    peak?: number;
    timestamp?: number;
};

type NativeNoLateAudioSpectrum = {
    start: (bandCount: number) => Promise<{ running: boolean }>;
    stop: () => void;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
};

const nativeAudioSpectrum = Platform.OS === "ios"
    ? NativeModules.NoLateAudioSpectrum as NativeNoLateAudioSpectrum | undefined
    : undefined;

const audioSpectrumEmitter = nativeAudioSpectrum
    ? new NativeEventEmitter(nativeAudioSpectrum)
    : null;

export const isNoLateAudioSpectrumAvailable = Boolean(nativeAudioSpectrum && audioSpectrumEmitter);

export function addNoLateAudioSpectrumListener(
    listener: (frame: NoLateAudioSpectrumFrame) => void
): EmitterSubscription | null {
    if (!audioSpectrumEmitter) return null;

    return audioSpectrumEmitter.addListener("NoLateAudioSpectrumData", listener);
}

export async function startNoLateAudioSpectrum(bandCount: number) {
    if (!nativeAudioSpectrum) {
        return { running: false };
    }

    return nativeAudioSpectrum.start(bandCount);
}

export function stopNoLateAudioSpectrum() {
    nativeAudioSpectrum?.stop();
}
