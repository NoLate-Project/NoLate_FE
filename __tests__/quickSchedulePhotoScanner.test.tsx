import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import { ActionSheetIOS, Alert, InteractionManager } from "react-native";

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
const mockCancelQuickSchedulePhotoRecognition = jest.fn().mockResolvedValue(false);

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
    cancelQuickSchedulePhotoRecognition: (...args: unknown[]) => (
        mockCancelQuickSchedulePhotoRecognition(...args)
    ),
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
        mockCancelQuickSchedulePhotoRecognition.mockReset();
        mockCancelQuickSchedulePhotoRecognition.mockResolvedValue(false);
        (Audio.Recording as unknown as jest.Mock).mockReset();
        (Audio.requestPermissionsAsync as jest.Mock).mockReset();
        (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
        (Audio.setAudioModeAsync as jest.Mock).mockReset();
        (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
        (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockReset();
        (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
        (ImagePicker.launchCameraAsync as jest.Mock).mockReset();
        (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
            canceled: true,
            assets: null,
        });
        (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockClear();
        (ImagePicker.launchImageLibraryAsync as jest.Mock).mockReset();
        (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
            canceled: true,
            assets: null,
        });
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
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
        expect(mockRecognizeQuickSchedulePhoto).toHaveBeenCalledWith(
            "file:///tmp/corrected-scan.jpg",
            expect.stringMatching(/^quick-photo-/)
        );
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

    test("OCR이 실패해도 인식 문장을 직접 입력해 분석할 수 있다", async () => {
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        mockRecognizeQuickSchedulePhoto.mockRejectedValueOnce(
            new Error("사진에서 일정 텍스트를 찾지 못했습니다.")
        );

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
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" })
                .props.placeholder
        ).toBe("인식하지 못한 내용을 직접 입력해 주세요.");
        expect(
            renderer!.root.findAll((node) => (
                node.props.children === "사진에서 일정 텍스트를 찾지 못했습니다."
            )).length
        ).toBeGreaterThan(0);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" })
                .props.onChangeText("7월 24일 오후 네 시 서울역 회의");
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장 분석" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "7월 24일 오후 네 시 서울역 회의",
            expect.objectContaining({
                inputMode: "photo",
                photoUri: "file:///tmp/corrected-scan.jpg",
                photoTranscript: "7월 24일 오후 네 시 서울역 회의",
            })
        );
    });

    test("iOS 사진 선택기는 전체 사진 보관함 권한을 먼저 요구하지 않는다", async () => {
        (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockRejectedValueOnce(
            new Error("사진 보관함 권한 거부")
        );
        (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
            canceled: false,
            assets: [{
                uri: "file:///tmp/phpicker-selected.jpg",
                width: 1200,
                height: 1600,
                fileName: "phpicker-selected.jpg",
            }],
        });
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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 앱에서 일정 사진 선택" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
        expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
        expect(mockRecognizeQuickSchedulePhoto).toHaveBeenCalledWith(
            "file:///tmp/phpicker-selected.jpg",
            expect.stringMatching(/^quick-photo-/)
        );
    });

    test("선택한 사진을 바꾸면 진행 중인 OCR 요청을 취소한다", async () => {
        const pendingRecognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => pendingRecognition.promise);

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "문서 스캔으로 사진 입력" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        const requestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "선택한 사진 제거" })
                .props.onPress({ stopPropagation: jest.fn() });
            await Promise.resolve();
        });

        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(requestId);
        await act(async () => {
            pendingRecognition.resolve({
                text: "이전 사진의 결과",
                recognitionConfidence: 0.9,
            });
            await pendingRecognition.promise;
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.editable
        ).toBe(false);
    });

    test("OCR이 15초를 넘으면 취소하고 재시도 또는 직접 입력을 안내한다", async () => {
        const pendingRecognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => pendingRecognition.promise);

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "문서 스캔으로 사진 입력" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        const requestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        await act(async () => {
            jest.advanceTimersByTime(15_000);
            await Promise.resolve();
        });

        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(requestId);
        expect(
            renderer!.root.findAll((node) => (
                node.props.children
                === "사진 인식 시간이 길어져 중단했습니다. 다시 인식하거나 아래에 직접 입력해 주세요."
            )).length
        ).toBeGreaterThan(0);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" })
                .props.editable
        ).toBe(true);

        await act(async () => {
            pendingRecognition.resolve({
                text: "시간 초과 뒤 도착한 결과",
                recognitionConfidence: 0.9,
            });
            await pendingRecognition.promise;
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("");
        expect(
            renderer!.root.findAll((node) => (
                node.props.children
                === "사진 인식 시간이 길어져 중단했습니다. 다시 인식하거나 아래에 직접 입력해 주세요."
            )).length
        ).toBeGreaterThan(0);
    });

    test("사진 A 인식 중 사진 B를 선택하면 B 결과만 유지한다", async () => {
        const firstRecognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto
            .mockImplementationOnce(() => firstRecognition.promise)
            .mockResolvedValueOnce({
                text: "7월 25일 오후 다섯 시 부산역 회의",
                recognitionConfidence: 0.91,
            });
        (ImagePicker.launchImageLibraryAsync as jest.Mock)
            .mockResolvedValueOnce({
                canceled: false,
                assets: [{ uri: "file:///tmp/photo-a.jpg", width: 1000, height: 1400 }],
            })
            .mockResolvedValueOnce({
                canceled: false,
                assets: [{ uri: "file:///tmp/photo-b.jpg", width: 1000, height: 1400 }],
            });

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 앱에서 일정 사진 선택" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        const firstRequestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 앱에서 일정 사진 선택" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        const secondRequestId = mockRecognizeQuickSchedulePhoto.mock.calls[1][1] as string;

        expect(secondRequestId).not.toBe(firstRequestId);
        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(firstRequestId);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("7월 25일 오후 다섯 시 부산역 회의");

        await act(async () => {
            firstRecognition.resolve({
                text: "7월 1일 오전 아홉 시 이전 사진 일정",
                recognitionConfidence: 0.99,
            });
            await firstRecognition.promise;
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("7월 25일 오후 다섯 시 부산역 회의");
    });

    test("액션 시트가 닫힌 뒤에만 문서 스캐너를 표시한다", async () => {
        jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((callback) => {
            (callback as () => void)();
            return { cancel: jest.fn() } as never;
        });
        jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(
            (_options, callback) => callback(0)
        );

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 선택" })
                .props.onPress();
        });

        expect(mockScanDocuments).not.toHaveBeenCalled();
        await act(async () => {
            jest.advanceTimersByTime(359);
        });
        expect(mockScanDocuments).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockScanDocuments).toHaveBeenCalledTimes(1);
    });

    test("액션 시트 선택 직후 화면을 닫으면 예약된 스캐너를 열지 않는다", async () => {
        jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((callback) => {
            (callback as () => void)();
            return { cancel: jest.fn() } as never;
        });
        jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(
            (_options, callback) => callback(0)
        );

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 선택" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.unmount();
            renderer = undefined;
            jest.advanceTimersByTime(360);
            await Promise.resolve();
        });

        expect(mockScanDocuments).not.toHaveBeenCalled();
    });

    test("문서 스캔 미지원 환경에서는 스캔 버튼 대신 카메라 촬영을 제공한다", async () => {
        mockCanScanDocuments.mockResolvedValueOnce(false);

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
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
        });

        expect(
            renderer!.root.findAllByProps({ accessibilityLabel: "문서 스캔으로 사진 입력" })
        ).toHaveLength(0);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "카메라로 일정 사진 촬영" })
        ).toBeDefined();
    });

    test("닫았다 다시 연 뒤 도착한 이전 액션 시트 callback은 source action을 실행하지 않는다", async () => {
        let staleActionSheetCallback: ((buttonIndex: number) => void) | undefined;
        jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((callback) => {
            (callback as () => void)();
            return { cancel: jest.fn() } as never;
        });
        jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(
            (_options, callback) => {
                staleActionSheetCallback = callback;
            }
        );
        const renderModal = (visible: boolean) => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible={visible}
                    defaultDay="2026-07-24"
                    onAnalyze={jest.fn().mockResolvedValue(parseResult)}
                    onSave={jest.fn()}
                    onClose={jest.fn()}
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(renderModal(true));
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 선택" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(staleActionSheetCallback).toBeDefined();

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.update(renderModal(false));
            await Promise.resolve();
            renderer!.update(renderModal(true));
            await Promise.resolve();
        });
        await act(async () => {
            staleActionSheetCallback?.(0);
            jest.advanceTimersByTime(360);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockScanDocuments).not.toHaveBeenCalled();
        expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
        expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    });

    test("스캔 중 입력 source가 바뀌면 늦은 스캔 페이지를 버리고 기존 사진을 유지한다", async () => {
        const pendingScan = createDeferred<{
            capturedPageCount: number;
            pages: Array<{ uri: string; width: number; height: number }>;
        }>();
        mockScanDocuments.mockImplementationOnce(() => pendingScan.promise);
        mockRecognizeQuickSchedulePhoto.mockResolvedValueOnce({
            text: "7월 24일 오후 두 시 기존 사진 일정",
            recognitionConfidence: 0.92,
        });
        (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
            canceled: false,
            assets: [{ uri: "file:///tmp/current-photo.jpg", width: 1000, height: 1400 }],
        });

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진 앱에서 일정 사진 선택" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("7월 24일 오후 두 시 기존 사진 일정");

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "문서 스캔으로 사진 입력" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockScanDocuments).toHaveBeenCalledTimes(1);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "텍스트로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            pendingScan.resolve({
                capturedPageCount: 1,
                pages: [{
                    uri: "file:///tmp/stale-scan.jpg",
                    width: 1200,
                    height: 1600,
                }],
            });
            await pendingScan.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockDiscardDocumentScanPages).toHaveBeenCalledWith([
            "file:///tmp/stale-scan.jpg",
        ]);
        expect(mockRecognizeQuickSchedulePhoto).toHaveBeenCalledTimes(1);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 OCR 인식 텍스트" }).props.value
        ).toBe("7월 24일 오후 두 시 기존 사진 일정");
    });

    test("fallback 녹음 권한을 기다리는 중 unmount되면 recorder를 시작하지 않는다", async () => {
        const pendingPermission = createDeferred<{ granted: boolean }>();
        const recorder = {
            prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
            startAsync: jest.fn().mockResolvedValue(undefined),
            stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
            getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: 0 }),
        };
        (Audio.requestPermissionsAsync as jest.Mock).mockReturnValueOnce(pendingPermission.promise);
        (Audio.Recording as unknown as jest.Mock).mockImplementation(() => recorder);

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
        });
        expect(Audio.requestPermissionsAsync).toHaveBeenCalledTimes(1);

        await act(async () => {
            renderer!.unmount();
            renderer = undefined;
        });
        await act(async () => {
            pendingPermission.resolve({ granted: true });
            await pendingPermission.promise;
            await Promise.resolve();
            await jest.advanceTimersByTimeAsync(1_550);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(Audio.Recording).not.toHaveBeenCalled();
        expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
        expect(recorder.startAsync).not.toHaveBeenCalled();
    });

    test("fallback 녹음 foreground 대기 중 unmount되면 recorder를 시작하지 않는다", async () => {
        const recorder = {
            prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
            startAsync: jest.fn().mockResolvedValue(undefined),
            stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
            getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: 0 }),
        };
        (Audio.Recording as unknown as jest.Mock).mockImplementation(() => recorder);

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.unmount();
            renderer = undefined;
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_550);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(Audio.Recording).not.toHaveBeenCalled();
        expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
        expect(recorder.startAsync).not.toHaveBeenCalled();
    });

    test("fallback 녹음 finalize 중에는 재시작을 막고 완료된 URI를 유지한다", async () => {
        const pendingFinalize = createDeferred<unknown>();
        const recorder = {
            prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
            startAsync: jest.fn().mockResolvedValue(undefined),
            stopAndUnloadAsync: jest.fn().mockReturnValue(pendingFinalize.promise),
            getURI: jest.fn(() => "file:///tmp/fallback-finalized.m4a"),
            getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: 1_500 }),
        };
        (Audio.Recording as unknown as jest.Mock).mockImplementation(() => recorder);

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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_550);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
        ).toBeDefined();

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
                .props.onPress();
            await Promise.resolve();
        });

        const finalizingControl = renderer!.root.findByProps({
            accessibilityLabel: "실시간 음성 인식 시작",
        });
        expect(finalizingControl.props.accessibilityState.disabled).toBe(true);
        expect(finalizingControl.props.disabled).toBe(true);
        expect(
            renderer!.root.findAll((node) => node.props.children === "음성을 정리하고 있어요")
        ).not.toHaveLength(0);

        await act(async () => {
            finalizingControl.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(Audio.Recording).toHaveBeenCalledTimes(1);
        expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
        expect(recorder.startAsync).toHaveBeenCalledTimes(1);

        await act(async () => {
            pendingFinalize.resolve(undefined);
            await pendingFinalize.promise;
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "음성 다시 인식" })
                .props.accessibilityState.disabled
        ).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" })
                .props.placeholder
        ).toBe("일정 만들기를 누르면 녹음을 인식합니다.");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장 분석" })
                .props.accessibilityState.disabled
        ).toBe(false);
        expect(Audio.Recording).toHaveBeenCalledTimes(1);
    });

    test("fallback 시작 실패 복구 중 닫으면 복구 완료 뒤 stale UI나 Alert를 만들지 않는다", async () => {
        const pendingRestore = createDeferred<void>();
        const recorder = {
            prepareToRecordAsync: jest.fn().mockRejectedValue(new Error("prepare failed")),
            startAsync: jest.fn().mockResolvedValue(undefined),
            stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
            getURI: jest.fn(() => null),
            getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: 0 }),
        };
        (Audio.Recording as unknown as jest.Mock).mockImplementation(() => recorder);
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
        const renderModal = (visible: boolean) => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible={visible}
                    prewarm
                    defaultDay="2026-07-24"
                    onAnalyze={jest.fn().mockResolvedValue(parseResult)}
                    onSave={jest.fn()}
                    onClose={jest.fn()}
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(renderModal(true));
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        (Audio.setAudioModeAsync as jest.Mock).mockClear();
        (Audio.setAudioModeAsync as jest.Mock).mockImplementation(
            (options: { allowsRecordingIOS?: boolean }) => (
                options.allowsRecordingIOS ? Promise.resolve() : pendingRestore.promise
            )
        );
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_550);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(Audio.setAudioModeAsync).toHaveBeenCalledWith({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
        });
        expect(alertSpy).not.toHaveBeenCalled();

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.update(renderModal(false));
            await Promise.resolve();
            renderer!.update(renderModal(true));
            await Promise.resolve();
        });
        await act(async () => {
            pendingRestore.resolve(undefined);
            await pendingRestore.promise;
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(alertSpy).not.toHaveBeenCalled();
        expect(Audio.Recording).toHaveBeenCalledTimes(1);
        expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
        expect(recorder.startAsync).not.toHaveBeenCalled();

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
        });
        const reopenedControl = renderer!.root.findByProps({
            accessibilityLabel: "실시간 음성 인식 시작",
        });
        expect(reopenedControl.props.accessibilityState.disabled).toBe(false);
        expect(
            renderer!.root.findAll((node) => node.props.children === "음성을 정리하고 있어요")
        ).toHaveLength(0);
    });
});
