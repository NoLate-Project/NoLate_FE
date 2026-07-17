import { NativeModules, Platform } from "react-native";
import type { ParseScheduleInputType } from "../../api/schedule";

export type QuickScheduleMediaInput = {
    inputMode: "text" | "photo" | "voice";
    inputTypeOverride?: ParseScheduleInputType;
    photoUri?: string;
    voiceUri?: string;
    voiceDurationMillis?: number;
};

type NativeNoLateQuickInput = {
    recognizeTextFromImage: (uri: string) => Promise<{ text?: string } | string>;
    transcribeAudioFile: (uri: string, localeIdentifier?: string) => Promise<{ text?: string } | string>;
};

const nativeQuickInput = Platform.OS === "ios"
    ? NativeModules.NoLateQuickInput as NativeNoLateQuickInput | undefined
    : undefined;

function normalizeExtractedText(value: { text?: string } | string) {
    const raw = typeof value === "string" ? value : value.text;
    return raw
        ?.replace(/\r\n/g, "\n")
        ?.replace(/\r/g, "\n")
        ?.replace(/[ \t]+/g, " ")
        ?.trim()
        ?? "";
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
 * 기존 /api/schedules/parse 계약에 맞는 text + inputType만 반환한다.
 *
 * 서버로 원본 미디어를 업로드하지 않는 것이 현재 제품 결정이므로, 네이티브 모듈이 없거나
 * 추출 결과가 비어 있으면 즉시 사용자 액션 가능한 오류를 던진다.
 */
export async function resolveQuickScheduleParseInput(
    text: string,
    media?: QuickScheduleMediaInput
): Promise<{ text: string; inputType: ParseScheduleInputType }> {
    const inputMode = media?.inputMode ?? "text";
    const inputType = media?.inputTypeOverride ?? inputTypeForMode(inputMode);

    if (inputMode === "text") {
        return {
            text: text.trim(),
            inputType,
        };
    }

    if (!nativeQuickInput) {
        throw new Error("이 기기에서는 사진/음성 텍스트 추출을 사용할 수 없습니다.");
    }

    if (inputMode === "photo") {
        if (!media?.photoUri) {
            throw new Error("분석할 사진을 먼저 선택해 주세요.");
        }

        const extractedText = normalizeExtractedText(
            await nativeQuickInput.recognizeTextFromImage(media.photoUri)
        );
        if (!extractedText) {
            throw new Error("사진에서 일정 텍스트를 찾지 못했습니다.");
        }

        return {
            text: extractedText,
            inputType,
        };
    }

    if (!media?.voiceUri) {
        throw new Error("분석할 음성을 먼저 녹음해 주세요.");
    }

    const extractedText = normalizeExtractedText(
        await nativeQuickInput.transcribeAudioFile(media.voiceUri, "ko-KR")
    );
    if (!extractedText) {
        throw new Error("음성에서 일정 텍스트를 찾지 못했습니다.");
    }

    return {
        text: extractedText,
        inputType,
    };
}
