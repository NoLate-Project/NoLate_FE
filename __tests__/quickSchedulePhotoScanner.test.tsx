import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickScheduleModal from "../src/modules/schedule/components/form/QuickScheduleModal";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleParseResult } from "../src/modules/schedule/types";

const mockCanScanDocuments = jest.fn().mockResolvedValue(true);
const mockScanDocuments = jest.fn().mockResolvedValue({
    capturedPageCount: 1,
    pages: [{ uri: "file:///tmp/corrected-scan.jpg", width: 1200, height: 1600 }],
});
const mockDiscardDocumentScanPages = jest.fn().mockResolvedValue(undefined);
const mockRecognizeQuickSchedulePhoto = jest.fn().mockResolvedValue({
    text: "7월 24일 오후 두 시 서울역 회의",
    recognitionConfidence: 0.58,
});

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    usePathname: () => "/schedule",
    useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");
jest.mock("expo-av", () => ({
    Audio: {
        Recording: jest.fn(),
        RecordingOptionsPresets: { HIGH_QUALITY: {} },
        requestPermissionsAsync: jest.fn(),
        setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock("../src/modules/schedule/documentScanner", () => ({
    canScanDocuments: (...args: unknown[]) => mockCanScanDocuments(...args),
    scanDocuments: (...args: unknown[]) => mockScanDocuments(...args),
    discardDocumentScanPages: (...args: unknown[]) => mockDiscardDocumentScanPages(...args),
}));
jest.mock("../src/modules/schedule/quickInputExtraction", () => ({
    buildScheduleSpeechContext: jest.fn(() => []),
    recognizeQuickSchedulePhoto: (...args: unknown[]) => mockRecognizeQuickSchedulePhoto(...args),
}));
jest.mock("../src/modules/schedule/liveSpeechRecognition", () => ({
    isLiveSpeechRecognitionAvailable: false,
    addLiveSpeechTranscriptListener: jest.fn(() => null),
    addLiveSpeechLevelListener: jest.fn(() => null),
    addLiveSpeechStateListener: jest.fn(() => null),
    cancelLiveSpeechRecognition: jest.fn().mockResolvedValue(undefined),
    createLiveSpeechSessionId: jest.fn(() => "speech-session-1"),
    startLiveSpeechRecognition: jest.fn(),
    stopLiveSpeechRecognition: jest.fn(),
}));
jest.mock("../src/modules/schedule/components/form/QuickScheduleLogoLoader", () => "QuickScheduleLogoLoader");
jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");

const parseResult: ScheduleParseResult = {
    title: "서울역 회의",
    startAt: "2026-07-24T14:00:00+09:00",
    destination: { name: "서울역" },
    originSource: "REQUIRED",
    originRequired: false,
    parseSource: "RULE",
    aiAttempted: false,
    needsReview: false,
    warnings: [],
    missingFields: [],
};

describe("QuickScheduleModal document scan OCR", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        mockCanScanDocuments.mockReset();
        mockCanScanDocuments.mockResolvedValue(true);
        mockScanDocuments.mockReset();
        mockScanDocuments.mockResolvedValue({
            capturedPageCount: 1,
            pages: [{ uri: "file:///tmp/corrected-scan.jpg", width: 1200, height: 1600 }],
        });
        mockDiscardDocumentScanPages.mockReset();
        mockDiscardDocumentScanPages.mockResolvedValue(undefined);
        mockRecognizeQuickSchedulePhoto.mockReset();
        mockRecognizeQuickSchedulePhoto.mockResolvedValue({
            text: "7월 24일 오후 두 시 서울역 회의",
            recognitionConfidence: 0.58,
        });
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("보정 스캔을 OCR하고 낮은 신뢰도를 알린 뒤 수정문을 분석한다", async () => {
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-24"
                        onAnalyze={onAnalyze}
                        onSave={jest.fn()}
                        onClose={jest.fn()}
                    />
                </ThemeProvider>
            );
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "문서 스캔으로 사진 입력" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockScanDocuments).toHaveBeenCalledWith({ maxPages: 1, jpegQuality: 0.94 });
        expect(mockRecognizeQuickSchedulePhoto).toHaveBeenCalledWith("file:///tmp/corrected-scan.jpg");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("7월 24일 오후 두 시 서울역 회의");
        expect(
            renderer!.root.findAll((node) => (
                node.props.children === "인식이 불확실해요. 날짜·시간·장소를 확인해 주세요."
            )).length
        ).toBeGreaterThan(0);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" })
                .props.onChangeText("7월 24일 오후 세 시 서울역 회의");
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장 분석" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "7월 24일 오후 세 시 서울역 회의",
            expect.objectContaining({
                inputMode: "photo",
                photoUri: "file:///tmp/corrected-scan.jpg",
                photoTranscript: "7월 24일 오후 세 시 서울역 회의",
            })
        );
        expect(onAnalyze.mock.calls[0][1].recognitionConfidence).toBeUndefined();
    });

    test("스캔 결과가 unmount 뒤 도착하면 임시 파일을 폐기하고 OCR하지 않는다", async () => {
        const pendingScan = createDeferred<{
            capturedPageCount: number;
            pages: Array<{ uri: string; width: number; height: number }>;
        }>();
        mockScanDocuments.mockImplementationOnce(() => pendingScan.promise);

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-24"
                        onAnalyze={jest.fn().mockResolvedValue(parseResult)}
                        onSave={jest.fn()}
                        onClose={jest.fn()}
                    />
                </ThemeProvider>
            );
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "문서 스캔으로 사진 입력" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(mockScanDocuments).toHaveBeenCalledTimes(1);
        await act(async () => {
            renderer!.unmount();
            renderer = undefined;
        });

        await act(async () => {
            pendingScan.resolve({
                capturedPageCount: 1,
                pages: [{
                    uri: "file:///tmp/deferred-corrected-scan.jpg",
                    width: 1400,
                    height: 1900,
                }],
            });
            await pendingScan.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockDiscardDocumentScanPages).toHaveBeenCalledTimes(1);
        expect(mockDiscardDocumentScanPages).toHaveBeenCalledWith([
            "file:///tmp/deferred-corrected-scan.jpg",
        ]);
        expect(mockRecognizeQuickSchedulePhoto).not.toHaveBeenCalled();
    });
});
