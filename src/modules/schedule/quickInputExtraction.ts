import { NativeModules, Platform } from "react-native";
import type { ParseScheduleInputType } from "../../api/schedule";

export type QuickScheduleMediaInput = {
    inputMode: "text" | "photo" | "voice";
    inputTypeOverride?: ParseScheduleInputType;
    photoUri?: string;
    photoTranscript?: string;
    voiceUri?: string;
    voiceDurationMillis?: number;
    voiceTranscript?: string;
    recognitionConfidence?: number;
};

type NativeNoLateQuickInput = {
    recognizeTextFromImage: (uri: string) => Promise<NativeRecognitionResult | string>;
    recognizeTextFromImageWithRequestId?: (
        uri: string,
        requestId: string
    ) => Promise<NativeRecognitionResult | string>;
    cancelImageRecognition?: (requestId: string) => Promise<boolean>;
    transcribeAudioFile: (
        uri: string,
        localeIdentifier?: string,
        contextualStrings?: string[]
    ) => Promise<NativeRecognitionResult | string>;
};

type NativeRecognitionResult = {
    text?: string;
    confidence?: number;
    alternatives?: string[];
    requestId?: string;
    attemptCount?: number;
};

export type QuickScheduleParseInput = {
    text: string;
    inputType: ParseScheduleInputType;
    recognitionConfidence?: number;
};

export type QuickScheduleRecognitionResult = {
    text: string;
    recognitionConfidence?: number;
    truncated?: boolean;
    sourceLength?: number;
};

const QUICK_SCHEDULE_TEXT_LIMIT = 300;
const DATE_LINE_PATTERN = /(?:오늘|내일|모레|이번\s*주|다음\s*주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2})/;
const TIME_LINE_PATTERN = /(?:오전|오후|아침|점심|저녁|새벽|(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d|\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)/;
const SCHEDULE_LINE_PATTERN = /(?:일정|약속|회의|미팅|예약|회식|데이트|스터디|여행|출발|도착|체크인|체크아웃|탑승)/;
const PLACE_LINE_PATTERN = /(?:역|공항|터미널|정류장|해변|병원|학교|대학교|카페|식당|호텔|센터|빌딩|공원|매장|점)(?:\s|$)/;

const SCHEDULE_SPEECH_CONTEXT = [
    "오늘", "내일", "모레", "이번 주", "다음 주",
    "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일",
    "오전", "오후", "아침", "점심", "저녁", "새벽",
    "출발지", "도착지", "출발", "도착",
    "일정", "약속", "회의", "미팅", "예약", "회식", "데이트", "스터디",
    "강남역", "서울역", "신촌역", "잠실역", "홍대입구역",
] as const;

const nativeQuickInput = Platform.OS === "ios"
    ? NativeModules.NoLateQuickInput as NativeNoLateQuickInput | undefined
    : undefined;

function normalizeExtractedText(value: NativeRecognitionResult | string) {
    const raw = typeof value === "string" ? value : value.text;
    return raw
        ?.replace(/\r\n/g, "\n")
        ?.replace(/\r/g, "\n")
        ?.replace(/[ \t]+/g, " ")
        ?.trim()
        ?? "";
}

function normalizeConfidenceValue(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(value: NativeRecognitionResult | string): number | undefined {
    return typeof value === "string"
        ? undefined
        : normalizeConfidenceValue(value.confidence);
}

function scheduleLineScore(line: string): number {
    let score = 0;
    if (DATE_LINE_PATTERN.test(line)) score += 8;
    if (TIME_LINE_PATTERN.test(line)) score += 7;
    if (SCHEDULE_LINE_PATTERN.test(line)) score += 4;
    if (PLACE_LINE_PATTERN.test(line)) score += 3;
    return score;
}

/**
 * 캘린더/영수증 스크린샷은 상태바와 메뉴 문구가 일정 정보보다 먼저 인식되는 경우가 많다.
 * 날짜·시간이 있는 줄과 그 주변 문맥을 우선 골라낸 뒤 길이를 제한해, 뒤쪽 핵심 정보가
 * 단순 `slice(0, 300)` 때문에 사라지지 않게 한다.
 */
export function prioritizeQuickScheduleOcrText(
    value: string,
    maxLength = QUICK_SCHEDULE_TEXT_LIMIT
): string {
    const normalized = normalizeExtractedText(value);
    if (!normalized || normalized.length <= maxLength) return normalized;

    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line, index, values) => values.indexOf(line) === index);
    const scores = lines.map(scheduleLineScore);
    const anchors = scores
        .map((score, index) => ({ index, score }))
        .filter(({ score }) => score >= 4);
    if (anchors.length === 0) return normalized.slice(0, maxLength).trim();

    const candidatePriority = new Map<number, number>();
    for (const { index, score } of anchors) {
        candidatePriority.set(index, Math.max(candidatePriority.get(index) ?? 0, score + 4));
        for (const neighbor of [index - 1, index + 1]) {
            if (neighbor < 0 || neighbor >= lines.length) continue;
            candidatePriority.set(
                neighbor,
                Math.max(candidatePriority.get(neighbor) ?? 0, scores[neighbor] + 2)
            );
        }
    }

    const selected: number[] = [];
    let usedLength = 0;
    const prioritizedCandidates = Array.from(candidatePriority.entries())
        .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    for (const [index] of prioritizedCandidates) {
        const separatorLength = selected.length > 0 ? 1 : 0;
        if (usedLength + separatorLength + lines[index].length > maxLength) continue;
        selected.push(index);
        usedLength += separatorLength + lines[index].length;
    }

    if (selected.length === 0) {
        const bestLine = lines[anchors[0].index] ?? normalized;
        return bestLine.slice(0, maxLength).trim();
    }
    return selected
        .sort((left, right) => left - right)
        .map((index) => lines[index])
        .join("\n")
        .slice(0, maxLength)
        .trim();
}

export function buildScheduleSpeechContext(supplementalText: string) {
    const supplementalWords = supplementalText
        .split(/[\s,.;:!?，。]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 2 && word.length <= 20);

    return Array.from(new Set([...SCHEDULE_SPEECH_CONTEXT, ...supplementalWords])).slice(0, 100);
}

export async function recognizeQuickSchedulePhoto(
    photoUri: string,
    requestId?: string
): Promise<QuickScheduleRecognitionResult> {
    if (!nativeQuickInput) {
        throw new Error("이 기기에서는 사진 텍스트 인식을 사용할 수 없습니다.");
    }
    if (!photoUri.trim()) {
        throw new Error("분석할 사진을 먼저 선택해 주세요.");
    }

    const normalizedRequestId = requestId?.trim() ?? "";
    const recognition = normalizedRequestId && nativeQuickInput.recognizeTextFromImageWithRequestId
        ? await nativeQuickInput.recognizeTextFromImageWithRequestId(photoUri, normalizedRequestId)
        : await nativeQuickInput.recognizeTextFromImage(photoUri);
    if (
        normalizedRequestId
        && typeof recognition !== "string"
        && typeof recognition.requestId === "string"
        && recognition.requestId !== normalizedRequestId
    ) {
        throw new Error("다른 사진의 인식 결과가 도착했습니다. 다시 시도해 주세요.");
    }
    const normalizedText = normalizeExtractedText(recognition);
    const extractedText = prioritizeQuickScheduleOcrText(normalizedText);
    if (!extractedText) {
        throw new Error("사진에서 일정 텍스트를 찾지 못했습니다.");
    }
    const recognitionConfidence = normalizeConfidence(recognition);
    return {
        text: extractedText,
        ...(normalizedText.length > extractedText.length
            ? { truncated: true, sourceLength: normalizedText.length }
            : {}),
        ...(recognitionConfidence !== undefined ? { recognitionConfidence } : {}),
    };
}

export async function cancelQuickSchedulePhotoRecognition(requestId: string): Promise<boolean> {
    const normalizedRequestId = requestId.trim();
    if (!normalizedRequestId || !nativeQuickInput?.cancelImageRecognition) return false;
    return nativeQuickInput.cancelImageRecognition(normalizedRequestId);
}

function inputTypeForMode(inputMode: QuickScheduleMediaInput["inputMode"]): ParseScheduleInputType {
    switch (inputMode) {
        case "photo":
            return "IMAGE_OCR";
        case "voice":
            return "VOICE_TRANSCRIPT";
        default:
            return "CONVERSATION";
    }
}

/**
 * QuickScheduleModal은 사진/녹음의 파일 URI만 알고, 백엔드는 텍스트만 받는다.
 * 이 함수가 그 경계다. 사진은 iOS Vision OCR, 음성은 iOS Speech 전사로 텍스트를 만든 뒤
 * 기존 /api/schedules/parse 계약에 맞는 text + inputType과 선택적 신뢰도만 반환한다.
 *
 * 서버로 원본 미디어를 업로드하지 않는 것이 현재 제품 결정이므로, 네이티브 모듈이 없거나
 * 추출 결과가 비어 있으면 즉시 사용자 액션 가능한 오류를 던진다.
 */
export async function resolveQuickScheduleParseInput(
    text: string,
    media?: QuickScheduleMediaInput
): Promise<QuickScheduleParseInput> {
    const inputMode = media?.inputMode ?? "text";
    const inputType = media?.inputTypeOverride ?? inputTypeForMode(inputMode);

    if (inputMode === "text") {
        return {
            text: text.trim(),
            inputType,
        };
    }

    // 실시간 받아쓰기는 녹음 파일을 다시 전사하지 않는다. 사용자가 화면에서 확인하고
    // 수정한 최종 문장을 그대로 일정 분석 경계로 넘겨 불필요한 재인식 손실을 피한다.
    if (inputMode === "voice" && media?.voiceTranscript?.trim()) {
        const recognitionConfidence = normalizeConfidenceValue(media.recognitionConfidence);
        return {
            text: normalizeExtractedText(media.voiceTranscript),
            inputType,
            ...(recognitionConfidence !== undefined ? { recognitionConfidence } : {}),
        };
    }

    if (inputMode === "photo" && media?.photoTranscript?.trim()) {
        const recognitionConfidence = normalizeConfidenceValue(media.recognitionConfidence);
        return {
            text: normalizeExtractedText(media.photoTranscript),
            inputType,
            ...(recognitionConfidence !== undefined ? { recognitionConfidence } : {}),
        };
    }

    if (!nativeQuickInput) {
        throw new Error("이 기기에서는 사진/음성 텍스트 추출을 사용할 수 없습니다.");
    }

    if (inputMode === "photo") {
        if (!media?.photoUri) {
            throw new Error("분석할 사진을 먼저 선택해 주세요.");
        }

        const recognition = await recognizeQuickSchedulePhoto(media.photoUri);

        return {
            text: recognition.text,
            inputType,
            ...(recognition.recognitionConfidence !== undefined
                ? { recognitionConfidence: recognition.recognitionConfidence }
                : {}),
        };
    }

    if (!media?.voiceUri) {
        throw new Error("분석할 음성을 먼저 녹음해 주세요.");
    }

    const recognition = await nativeQuickInput.transcribeAudioFile(
        media.voiceUri,
        "ko-KR",
        buildScheduleSpeechContext(text)
    );
    const extractedText = normalizeExtractedText(recognition);
    if (!extractedText) {
        throw new Error("음성에서 일정 텍스트를 찾지 못했습니다.");
    }

    return {
        text: extractedText,
        inputType,
        ...(normalizeConfidence(recognition) !== undefined
            ? { recognitionConfidence: normalizeConfidence(recognition) }
            : {}),
    };
}
