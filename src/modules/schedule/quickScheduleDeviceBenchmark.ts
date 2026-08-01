import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ScheduleParseResult } from "./types";

const STORAGE_KEY = "nolate_internal_quick_schedule_benchmark_v1";
const SCHEMA_VERSION = 1;
const CHANNELS = new Set(["TEXT", "PHOTO", "VOICE"] as const);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type QuickScheduleBenchmarkChannel = "TEXT" | "PHOTO" | "VOICE";
export type QuickScheduleBenchmarkPlatform = "IOS" | "ANDROID";

export type QuickScheduleBenchmarkExpected = {
    date: string;
    time: string;
    destination: string;
};

export type QuickScheduleBenchmarkCase = {
    id: string;
    channel: QuickScheduleBenchmarkChannel;
    expected: QuickScheduleBenchmarkExpected;
    mediaAssetId?: string;
    sourceText?: string;
    prompt?: string;
    referenceDate?: string;
};

export type QuickScheduleBenchmarkManifest = {
    version: typeof SCHEMA_VERSION;
    cases: QuickScheduleBenchmarkCase[];
};

export type QuickScheduleBenchmarkResult = {
    id: string;
    mediaAssetId?: string;
    channel: QuickScheduleBenchmarkChannel;
    platform: QuickScheduleBenchmarkPlatform;
    expected: QuickScheduleBenchmarkExpected;
    actual: QuickScheduleBenchmarkExpected;
    confidence: {
        overall: number;
        level: "HIGH" | "MEDIUM" | "REVIEW";
        recognition?: number;
    };
    attemptCount?: number;
    appVersion?: string;
    confidenceVersion: string;
};

export type QuickScheduleBenchmarkSession = {
    version: typeof SCHEMA_VERSION;
    manifest: QuickScheduleBenchmarkManifest;
    results: QuickScheduleBenchmarkResult[];
};

function requiredString(value: unknown, label: string, maxLength = 300): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} 값이 비어 있습니다.`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) throw new Error(`${label} 값이 너무 깁니다.`);
    return normalized;
}

function optionalString(value: unknown, label: string, maxLength = 300): string | undefined {
    return value === undefined ? undefined : requiredString(value, label, maxLength);
}

function parseExpected(value: unknown, label: string): QuickScheduleBenchmarkExpected {
    if (!value || typeof value !== "object") throw new Error(`${label}.expected가 없습니다.`);
    const source = value as Partial<QuickScheduleBenchmarkExpected>;
    const date = requiredString(source.date, `${label}.expected.date`, 10);
    const time = requiredString(source.time, `${label}.expected.time`, 5);
    const destination = requiredString(source.destination, `${label}.expected.destination`, 200);
    if (!DATE_PATTERN.test(date)) throw new Error(`${label}.expected.date는 YYYY-MM-DD 형식이어야 합니다.`);
    if (!TIME_PATTERN.test(time)) throw new Error(`${label}.expected.time은 HH:mm 형식이어야 합니다.`);
    return { date, time, destination };
}

export function parseQuickScheduleBenchmarkManifest(
    input: string | unknown,
): QuickScheduleBenchmarkManifest {
    let value: unknown = input;
    if (typeof input === "string") {
        try {
            value = JSON.parse(input);
        } catch (error) {
            throw new Error(`manifest JSON을 읽지 못했습니다: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (!value || typeof value !== "object") throw new Error("manifest 객체가 필요합니다.");
    const candidate = value as { version?: unknown; cases?: unknown };
    if (candidate.version !== SCHEMA_VERSION) throw new Error("지원하지 않는 manifest version입니다.");
    if (!Array.isArray(candidate.cases) || candidate.cases.length === 0) {
        throw new Error("manifest.cases에 한 건 이상의 표본이 필요합니다.");
    }
    const ids = new Set<string>();
    const cases = candidate.cases.map((rawCase, index): QuickScheduleBenchmarkCase => {
        const label = `cases[${index}]`;
        if (!rawCase || typeof rawCase !== "object") throw new Error(`${label}가 객체가 아닙니다.`);
        const source = rawCase as Partial<QuickScheduleBenchmarkCase>;
        const id = requiredString(source.id, `${label}.id`, 100);
        if (ids.has(id)) throw new Error(`${label}.id가 중복되었습니다: ${id}`);
        ids.add(id);
        if (!CHANNELS.has(source.channel as QuickScheduleBenchmarkChannel)) {
            throw new Error(`${label}.channel이 올바르지 않습니다.`);
        }
        const channel = source.channel as QuickScheduleBenchmarkChannel;
        const sourceText = optionalString(source.sourceText, `${label}.sourceText`);
        const prompt = optionalString(source.prompt, `${label}.prompt`);
        const mediaAssetId = optionalString(source.mediaAssetId, `${label}.mediaAssetId`, 100);
        const referenceDate = optionalString(source.referenceDate, `${label}.referenceDate`, 10);
        if (referenceDate && !DATE_PATTERN.test(referenceDate)) {
            throw new Error(`${label}.referenceDate는 YYYY-MM-DD 형식이어야 합니다.`);
        }
        if (channel === "TEXT" && !sourceText) throw new Error(`${label}.sourceText가 필요합니다.`);
        if (channel !== "TEXT" && !mediaAssetId) throw new Error(`${label}.mediaAssetId가 필요합니다.`);
        if (channel === "VOICE" && !prompt) throw new Error(`${label}.prompt가 필요합니다.`);
        return {
            id,
            channel,
            expected: parseExpected(source.expected, label),
            ...(mediaAssetId ? { mediaAssetId } : {}),
            ...(sourceText ? { sourceText } : {}),
            ...(prompt ? { prompt } : {}),
            ...(referenceDate ? { referenceDate } : {}),
        };
    });
    return { version: SCHEMA_VERSION, cases };
}

export function buildQuickScheduleBenchmarkResult(
    benchmarkCase: QuickScheduleBenchmarkCase,
    platform: QuickScheduleBenchmarkPlatform,
    parseResult: ScheduleParseResult,
    options: {
        recognitionConfidence?: number;
        attemptCount?: number;
        appVersion?: string;
    } = {},
): QuickScheduleBenchmarkResult {
    const confidence = parseResult.confidence;
    const recognition = confidence?.recognition ?? options.recognitionConfidence;
    return {
        id: benchmarkCase.id,
        ...(benchmarkCase.mediaAssetId ? { mediaAssetId: benchmarkCase.mediaAssetId } : {}),
        channel: benchmarkCase.channel,
        platform,
        expected: benchmarkCase.expected,
        actual: {
            date: parseResult.date?.trim() ?? "",
            time: parseResult.time?.trim() ?? "",
            destination: parseResult.destination?.name?.trim() ?? "",
        },
        confidence: {
            overall: confidence?.overall ?? 0,
            level: confidence?.level ?? "REVIEW",
            ...(recognition === undefined ? {} : { recognition }),
        },
        ...(options.attemptCount === undefined ? {} : { attemptCount: options.attemptCount }),
        ...(options.appVersion ? { appVersion: options.appVersion } : {}),
        confidenceVersion: parseResult.confidenceVersion ?? "missing",
    };
}

function parseSession(value: unknown): QuickScheduleBenchmarkSession | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<QuickScheduleBenchmarkSession>;
    try {
        const manifest = parseQuickScheduleBenchmarkManifest(candidate.manifest);
        if (candidate.version !== SCHEMA_VERSION || !Array.isArray(candidate.results)) return undefined;
        const allowedIds = new Set(manifest.cases.map((item) => item.id));
        const results = candidate.results.filter((result) => (
            result &&
            typeof result === "object" &&
            allowedIds.has((result as QuickScheduleBenchmarkResult).id)
        )) as QuickScheduleBenchmarkResult[];
        return { version: SCHEMA_VERSION, manifest, results };
    } catch {
        return undefined;
    }
}

export async function loadQuickScheduleBenchmarkSession(): Promise<QuickScheduleBenchmarkSession | null> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        return parseSession(JSON.parse(raw)) ?? null;
    } catch {
        return null;
    }
}

export async function startQuickScheduleBenchmarkSession(
    manifestInput: string | unknown,
): Promise<QuickScheduleBenchmarkSession> {
    const session: QuickScheduleBenchmarkSession = {
        version: SCHEMA_VERSION,
        manifest: parseQuickScheduleBenchmarkManifest(manifestInput),
        results: [],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
}

export async function recordQuickScheduleBenchmarkResult(
    session: QuickScheduleBenchmarkSession,
    result: QuickScheduleBenchmarkResult,
): Promise<QuickScheduleBenchmarkSession> {
    if (!session.manifest.cases.some((item) => item.id === result.id)) {
        throw new Error("현재 manifest에 없는 표본 결과입니다.");
    }
    const results = session.results.filter((item) => item.id !== result.id);
    results.push(result);
    const next = { ...session, results };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
}

export async function clearQuickScheduleBenchmarkSession(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
}

export function nextQuickScheduleBenchmarkCase(
    session: QuickScheduleBenchmarkSession,
): QuickScheduleBenchmarkCase | undefined {
    const completed = new Set(session.results.map((result) => result.id));
    return session.manifest.cases.find((item) => !completed.has(item.id));
}

export function exportQuickScheduleBenchmarkJsonl(
    session: QuickScheduleBenchmarkSession,
): string {
    const resultById = new Map(session.results.map((result) => [result.id, result]));
    return session.manifest.cases
        .map((item) => resultById.get(item.id))
        .filter((result): result is QuickScheduleBenchmarkResult => Boolean(result))
        .map((result) => JSON.stringify(result))
        .join("\n");
}

export const QUICK_SCHEDULE_BENCHMARK_STORAGE_KEY = process.env.NODE_ENV === "test"
    ? STORAGE_KEY
    : undefined;
