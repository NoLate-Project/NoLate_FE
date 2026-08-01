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
    requiresOnDeviceRecognition?: boolean;
};

export type LiveSpeechAvailability = {
    serviceAvailable: boolean;
    supportsOnDevice: boolean;
    reason?: string;
};

export type LiveSpeechRecognitionAlternative = {
    text: string;
    confidence?: number;
};

export type LiveSpeechTranscript = {
    sessionId: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
    elapsedMillis?: number;
    alternatives?: LiveSpeechRecognitionAlternative[];
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
    alternatives?: LiveSpeechRecognitionAlternative[];
};

export type LiveSpeechTranscriptBuffer = {
    stableText: string;
    volatileText: string;
};

export type LiveSpeechTranscriptSnapshot = {
    buffer: LiveSpeechTranscriptBuffer;
    text: string;
    alternatives?: LiveSpeechRecognitionAlternative[];
};

type NativeLiveSpeechModule = {
    getAvailability?: (localeIdentifier: string) => Promise<unknown>;
    start: (options: {
        sessionId: string;
        localeIdentifier: string;
        contextualStrings: string[];
        maxDurationMillis: number;
        requiresOnDeviceRecognition: boolean;
    }) => Promise<{ sessionId?: string }>;
    stop: (sessionId: string) => Promise<LiveSpeechFinalResult>;
    cancel: (sessionId: string) => Promise<void>;
    addListener: (eventName: string) => void;
    removeListeners: (count: number) => void;
};

const nativeLiveSpeech = Platform.OS === "ios" || Platform.OS === "android"
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

function normalizeSpeechText(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();
}

export function normalizeLiveSpeechRecognitionAlternatives(
    value: unknown,
    bestText?: string,
    bestConfidence?: number
): LiveSpeechRecognitionAlternative[] {
    const normalizedBestText = normalizeSpeechText(bestText);
    const candidates: LiveSpeechRecognitionAlternative[] = [];
    const appendCandidate = (candidateText: unknown, candidateConfidence?: unknown) => {
        const text = normalizeSpeechText(candidateText);
        if (!text || candidates.some((candidate) => candidate.text === text)) return;
        const confidence = normalizeConfidence(candidateConfidence);
        candidates.push({
            text,
            ...(confidence !== undefined ? { confidence } : {}),
        });
    };

    if (normalizedBestText) {
        appendCandidate(normalizedBestText, bestConfidence);
    }
    if (Array.isArray(value)) {
        for (const candidate of value) {
            if (typeof candidate === "string") {
                appendCandidate(candidate);
            } else if (candidate && typeof candidate === "object") {
                const source = candidate as Record<string, unknown>;
                appendCandidate(source.text, source.confidence);
            }
            if (candidates.length >= 3) break;
        }
    }
    return candidates.slice(0, 3);
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

function normalizeLocaleIdentifier(value: string | undefined): string {
    return value?.trim() || "ko-KR";
}

function normalizeAvailability(value: unknown): LiveSpeechAvailability {
    if (!value || typeof value !== "object") {
        return {
            serviceAvailable: false,
            supportsOnDevice: false,
            reason: "음성 인식 지원 상태를 확인하지 못했습니다.",
        };
    }

    const source = value as Record<string, unknown>;
    const reason = typeof source.reason === "string"
        ? source.reason.trim()
        : "";
    return {
        serviceAvailable: source.serviceAvailable === true,
        supportsOnDevice: source.supportsOnDevice === true,
        ...(reason ? { reason } : {}),
    };
}

function normalizeTranscript(value: unknown): LiveSpeechTranscript | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const sessionId = normalizeSessionId(source.sessionId);
    if (!sessionId || typeof source.text !== "string") return null;

    const text = normalizeSpeechText(source.text);
    const confidence = normalizeConfidence(source.confidence);
    const alternatives = normalizeLiveSpeechRecognitionAlternatives(
        source.alternatives,
        text,
        confidence
    );

    return {
        sessionId,
        text,
        isFinal: source.isFinal === true,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(normalizeElapsedMillis(source.elapsedMillis) !== undefined
            ? { elapsedMillis: normalizeElapsedMillis(source.elapsedMillis) }
            : {}),
        ...(Array.isArray(source.alternatives) && alternatives.length > 0
            ? { alternatives }
            : {}),
    };
}

function transcriptTokens(value: string): string[] {
    return value.split(/\s+/).filter(Boolean);
}

function joinTranscriptParts(left: string, right: string): string {
    const normalizedLeft = normalizeSpeechText(left);
    const normalizedRight = normalizeSpeechText(right);
    if (!normalizedLeft) return normalizedRight;
    if (!normalizedRight) return normalizedLeft;
    if (normalizedRight === normalizedLeft || normalizedRight.startsWith(`${normalizedLeft} `)) {
        return normalizedRight;
    }
    if (normalizedLeft.endsWith(` ${normalizedRight}`)) return normalizedLeft;

    const leftTokens = transcriptTokens(normalizedLeft);
    const rightTokens = transcriptTokens(normalizedRight);
    const maxOverlap = Math.min(leftTokens.length, rightTokens.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const leftSuffix = leftTokens.slice(-overlap).join(" ");
        const rightPrefix = rightTokens.slice(0, overlap).join(" ");
        if (leftSuffix === rightPrefix) {
            return [...leftTokens, ...rightTokens.slice(overlap)].join(" ");
        }
    }
    return `${normalizedLeft} ${normalizedRight}`;
}

/**
 * iOS와 Android의 부분 결과는 확정 전까지 앞 문장을 다시 쓰거나 일시적으로 짧아질 수 있다.
 * 새 가설이 기존 가설을 확장하면 갱신하고, 기존 가설의 일부로 되돌아간 경우에는 더 완전한
 * 문장을 보존한다. 서로 겹치지 않는 재가설은 긴 쪽을 선택해 순간적인 앞 문장 유실을 막는다.
 */
export function mergeLiveSpeechHypothesis(previous: string, incoming: string): string {
    const normalizedPrevious = normalizeSpeechText(previous);
    const normalizedIncoming = normalizeSpeechText(incoming);
    if (!normalizedPrevious) return normalizedIncoming;
    if (!normalizedIncoming) return normalizedPrevious;
    if (normalizedPrevious === normalizedIncoming) return normalizedPrevious;
    if (
        normalizedIncoming.startsWith(`${normalizedPrevious} `)
        || normalizedIncoming.includes(` ${normalizedPrevious} `)
    ) {
        return normalizedIncoming;
    }
    if (
        normalizedPrevious.startsWith(`${normalizedIncoming} `)
        || normalizedPrevious.endsWith(` ${normalizedIncoming}`)
        || normalizedPrevious.includes(` ${normalizedIncoming} `)
    ) {
        return normalizedPrevious;
    }

    const appended = joinTranscriptParts(normalizedPrevious, normalizedIncoming);
    if (appended !== `${normalizedPrevious} ${normalizedIncoming}`) return appended;
    return normalizedIncoming.length >= normalizedPrevious.length
        ? normalizedIncoming
        : normalizedPrevious;
}

export function createLiveSpeechTranscriptBuffer(
    stableText = ""
): LiveSpeechTranscriptBuffer {
    return {
        stableText: normalizeSpeechText(stableText),
        volatileText: "",
    };
}

/**
 * stableText는 이전에 끝난 세션/사용자 수정 문장이고 volatileText는 현재 세션의 가설이다.
 * 따라서 인식을 다시 시작해도 stableText가 유지되며 새 세션의 결과만 뒤에 이어 붙는다.
 */
export function accumulateLiveSpeechTranscript(
    buffer: LiveSpeechTranscriptBuffer,
    transcript: Pick<LiveSpeechTranscript, "text" | "confidence" | "alternatives">
): LiveSpeechTranscriptSnapshot {
    const volatileText = mergeLiveSpeechHypothesis(buffer.volatileText, transcript.text);
    const nextBuffer = {
        stableText: normalizeSpeechText(buffer.stableText),
        volatileText,
    };
    const text = joinTranscriptParts(nextBuffer.stableText, volatileText);
    const alternatives = transcript.alternatives
        ?.map((alternative) => ({
            text: joinTranscriptParts(nextBuffer.stableText, alternative.text),
            ...(alternative.confidence !== undefined
                ? { confidence: alternative.confidence }
                : {}),
        }));
    const normalizedAlternatives = alternatives
        ? normalizeLiveSpeechRecognitionAlternatives(
            alternatives,
            text,
            transcript.confidence
        )
        : [];

    return {
        buffer: nextBuffer,
        text,
        ...(normalizedAlternatives.length > 0
            ? { alternatives: normalizedAlternatives }
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

export async function getLiveSpeechRecognitionAvailability(
    localeIdentifier = "ko-KR"
): Promise<LiveSpeechAvailability> {
    if (!nativeLiveSpeech?.getAvailability) {
        return {
            serviceAvailable: false,
            supportsOnDevice: false,
            reason: "이 기기에서는 실시간 음성 인식을 사용할 수 없습니다.",
        };
    }

    const result = await nativeLiveSpeech.getAvailability(
        normalizeLocaleIdentifier(localeIdentifier)
    );
    return normalizeAvailability(result);
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
        localeIdentifier: normalizeLocaleIdentifier(options.localeIdentifier),
        contextualStrings: normalizeContextualStrings(options.contextualStrings),
        maxDurationMillis: normalizeMaxDurationMillis(options.maxDurationMillis),
        requiresOnDeviceRecognition: options.requiresOnDeviceRecognition !== false,
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
