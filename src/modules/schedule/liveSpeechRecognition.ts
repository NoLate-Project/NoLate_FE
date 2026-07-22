import {
    NativeEventEmitter,
    NativeModules,
    Platform,
    type EmitterSubscription,
} from "react-native";

const TRANSCRIPT_EVENT = "NoLateLiveSpeechTranscript";
const LEVEL_EVENT = "NoLateLiveSpeechLevel";
const STATE_EVENT = "NoLateLiveSpeechState";
const DEFAULT_MAX_DURATION_MILLIS = 60_000;

export type LiveSpeechSessionState =
    | "starting"
    | "listening"
    | "stopping"
    | "finished"
    | "cancelled"
    | "failed";

export type LiveSpeechStartOptions = {
    sessionId?: string;
    localeIdentifier?: string;
    contextualStrings?: string[];
    maxDurationMillis?: number;
};

export type LiveSpeechTranscript = {
    sessionId: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
    elapsedMillis?: number;
};

export type LiveSpeechLevel = {
    sessionId: string;
    rms: number;
    peak: number;
    elapsedMillis?: number;
};

export type LiveSpeechState = {
    sessionId: string;
    state: LiveSpeechSessionState;
    message?: string;
};

export type LiveSpeechFinalResult = {
    sessionId: string;
    text: string;
    confidence?: number;
    elapsedMillis?: number;
};

type NativeLiveSpeechModule = {
    start: (options: {
        sessionId: string;
        localeIdentifier: string;
        contextualStrings: string[];
        maxDurationMillis: number;
    }) => Promise<{ sessionId?: string }>;
    stop: (sessionId: string) => Promise<LiveSpeechFinalResult>;
    cancel: (sessionId: string) => Promise<void>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
};

const nativeLiveSpeech = Platform.OS === "ios"
    ? NativeModules.NoLateLiveSpeech as NativeLiveSpeechModule | undefined
    : undefined;

const liveSpeechEmitter = nativeLiveSpeech
    ? new NativeEventEmitter(nativeLiveSpeech)
    : null;

export const isLiveSpeechRecognitionAvailable = Boolean(nativeLiveSpeech && liveSpeechEmitter);

let nextLiveSpeechSessionSequence = 0;

export function createLiveSpeechSessionId(): string {
    nextLiveSpeechSessionSequence = (nextLiveSpeechSessionSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `live-speech-${Date.now().toString(36)}-${nextLiveSpeechSessionSequence.toString(36)}`;
}

function normalizeConfidence(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(1, value));
}

function normalizeElapsedMillis(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.round(value));
}

function normalizeSessionId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const sessionId = value.trim();
    return sessionId.length > 0 ? sessionId : null;
}

function normalizeContextualStrings(values: string[] | undefined): string[] {
    const normalized = (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length >= 2 && value.length <= 20);
    return Array.from(new Set(normalized)).slice(0, 100);
}

function normalizeMaxDurationMillis(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_MAX_DURATION_MILLIS;
    }
    return Math.max(5_000, Math.min(120_000, Math.round(value)));
}

function normalizeTranscript(value: unknown): LiveSpeechTranscript | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const sessionId = normalizeSessionId(source.sessionId);
    if (!sessionId || typeof source.text !== "string") return null;

    const text = source.text
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();

    return {
        sessionId,
        text,
        isFinal: source.isFinal === true,
        ...(normalizeConfidence(source.confidence) !== undefined
            ? { confidence: normalizeConfidence(source.confidence) }
            : {}),
        ...(normalizeElapsedMillis(source.elapsedMillis) !== undefined
            ? { elapsedMillis: normalizeElapsedMillis(source.elapsedMillis) }
            : {}),
    };
}

function normalizeLevel(value: unknown): LiveSpeechLevel | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const sessionId = normalizeSessionId(source.sessionId);
    if (!sessionId || typeof source.rms !== "number" || typeof source.peak !== "number") {
        return null;
    }

    return {
        sessionId,
        rms: Math.max(0, Math.min(1, source.rms)),
        peak: Math.max(0, Math.min(1, source.peak)),
        ...(normalizeElapsedMillis(source.elapsedMillis) !== undefined
            ? { elapsedMillis: normalizeElapsedMillis(source.elapsedMillis) }
            : {}),
    };
}

function normalizeState(value: unknown): LiveSpeechState | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const sessionId = normalizeSessionId(source.sessionId);
    const validStates: LiveSpeechSessionState[] = [
        "starting",
        "listening",
        "stopping",
        "finished",
        "cancelled",
        "failed",
    ];
    if (!sessionId || !validStates.includes(source.state as LiveSpeechSessionState)) return null;

    return {
        sessionId,
        state: source.state as LiveSpeechSessionState,
        ...(typeof source.message === "string" && source.message.trim()
            ? { message: source.message.trim() }
            : {}),
    };
}

function subscribe<T>(
    eventName: string,
    normalize: (value: unknown) => T | null,
    listener: (value: T) => void
): EmitterSubscription | null {
    if (!liveSpeechEmitter) return null;
    return liveSpeechEmitter.addListener(eventName, (value: unknown) => {
        const normalized = normalize(value);
        if (normalized) listener(normalized);
    });
}

export function addLiveSpeechTranscriptListener(
    listener: (value: LiveSpeechTranscript) => void
): EmitterSubscription | null {
    return subscribe(TRANSCRIPT_EVENT, normalizeTranscript, listener);
}

export function addLiveSpeechLevelListener(
    listener: (value: LiveSpeechLevel) => void
): EmitterSubscription | null {
    return subscribe(LEVEL_EVENT, normalizeLevel, listener);
}

export function addLiveSpeechStateListener(
    listener: (value: LiveSpeechState) => void
): EmitterSubscription | null {
    return subscribe(STATE_EVENT, normalizeState, listener);
}

export async function startLiveSpeechRecognition(
    options: LiveSpeechStartOptions = {}
): Promise<string> {
    if (!nativeLiveSpeech) {
        throw new Error("이 기기에서는 실시간 음성 인식을 사용할 수 없습니다.");
    }

    const requestedSessionId = normalizeSessionId(options.sessionId)
        ?? createLiveSpeechSessionId();

    const result = await nativeLiveSpeech.start({
        sessionId: requestedSessionId,
        localeIdentifier: options.localeIdentifier?.trim() || "ko-KR",
        contextualStrings: normalizeContextualStrings(options.contextualStrings),
        maxDurationMillis: normalizeMaxDurationMillis(options.maxDurationMillis),
    });
    const sessionId = normalizeSessionId(result?.sessionId);
    if (!sessionId || sessionId !== requestedSessionId) {
        throw new Error("실시간 음성 인식 세션을 시작하지 못했습니다.");
    }
    return sessionId;
}

export async function stopLiveSpeechRecognition(
    sessionId: string
): Promise<LiveSpeechFinalResult> {
    if (!nativeLiveSpeech) {
        throw new Error("이 기기에서는 실시간 음성 인식을 사용할 수 없습니다.");
    }
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) throw new Error("종료할 음성 인식 세션이 없습니다.");

    const result = await nativeLiveSpeech.stop(normalizedSessionId);
    const transcript = normalizeTranscript({ ...result, isFinal: true });
    if (!transcript) {
        throw new Error("음성 인식 결과를 마무리하지 못했습니다.");
    }
    return transcript;
}

export async function cancelLiveSpeechRecognition(sessionId: string): Promise<void> {
    if (!nativeLiveSpeech) return;
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return;
    await nativeLiveSpeech.cancel(normalizedSessionId);
}
