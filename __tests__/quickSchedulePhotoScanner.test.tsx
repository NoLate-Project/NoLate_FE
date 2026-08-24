import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import { ActionSheetIOS, Alert } from "react-native";

import QuickScheduleModal, {
    resolvePhotoPreviewAspectRatio,
} from "../src/modules/schedule/components/form/QuickScheduleModal";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleParseResult } from "../src/modules/schedule/types";

const mockRecognizeQuickSchedulePhoto = jest.fn().mockResolvedValue({
    text: "7월 24일 오후 두 시 서울역 회의",
    recognitionConfidence: 0.58,
});
const mockCancelQuickSchedulePhotoRecognition = jest.fn().mockResolvedValue(false);

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
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
jest.mock("../src/modules/schedule/quickInputExtraction", () => ({
    buildScheduleSpeechContext: jest.fn(() => []),
    cancelQuickSchedulePhotoRecognition: (...args: unknown[]) => (
        mockCancelQuickSchedulePhotoRecognition(...args)
    ),
    recognizeQuickSchedulePhoto: (...args: unknown[]) => mockRecognizeQuickSchedulePhoto(...args),
}));
jest.mock("../src/modules/schedule/liveSpeechRecognition", () => ({
    ...jest.requireActual("../src/modules/schedule/liveSpeechRecognition"),
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
    confidence: {
        overall: 0.97,
        level: "HIGH",
        fields: { date: 0.98, time: 0.98, destination: 0.94 },
        reasons: [],
    },
};

describe("QuickScheduleModal photo OCR", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.useFakeTimers();
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
        jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("긴 영수증과 가로 파노라마도 포커스가 겹치지 않는 미리보기 비율로 제한한다", () => {
        expect(resolvePhotoPreviewAspectRatio(0.2)).toBe(0.55);
        expect(resolvePhotoPreviewAspectRatio(4 / 3)).toBe(4 / 3);
        expect(resolvePhotoPreviewAspectRatio(4)).toBe(2.2);
        expect(resolvePhotoPreviewAspectRatio(Number.NaN)).toBe(1);
    });

    async function renderQuickScheduleModal(
        onAnalyze: jest.Mock = jest.fn().mockResolvedValue(parseResult),
    ) {
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
            await Promise.resolve();
        });
    }

    async function enterPhotoMode() {
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });
    }

    async function selectLibraryPhoto(uri: string) {
        (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
            canceled: false,
            assets: [{
                uri,
                width: 1200,
                height: 1600,
                fileName: uri.split("/").pop(),
            }],
        });

        await choosePhotoSource(1);
    }

    async function choosePhotoSource(buttonIndex: 0 | 1) {
        const emptyPhotoButton = renderer!.root.findAllByProps({ accessibilityLabel: "사진 선택" })[0];
        const photoChangeButton = renderer!.root.findAllByProps({ accessibilityLabel: "선택한 사진 변경" })[0];

        await act(async () => {
            (emptyPhotoButton ?? photoChangeButton).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        const actionSheetCallback = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock)
            .mock.calls.at(-1)?.[1] as ((selectedIndex: number) => void) | undefined;
        expect(actionSheetCallback).toEqual(expect.any(Function));

        await act(async () => {
            actionSheetCallback?.(buttonIndex);
            await jest.advanceTimersByTimeAsync(360);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    async function captureCameraPhoto(uri: string) {
        (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
            canceled: false,
            assets: [{
                uri,
                width: 1200,
                height: 1600,
                fileName: uri.split("/").pop(),
            }],
        });

        await choosePhotoSource(0);
    }

    function hasPhotoScanOverlay() {
        return renderer!.root.findAllByProps({
            testID: "quick-schedule-photo-scan-overlay",
        }).length > 0;
    }

    test("일반 카메라 사진은 OCR 중 스캔 오버레이를 표시하고 성공하면 제거한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal();
        await enterPhotoMode();
        expect(
            renderer!.root.findAllByProps({ accessibilityLabel: "카메라로 일정 사진 촬영" })
        ).toHaveLength(0);
        expect(
            renderer!.root.findAllByProps({ accessibilityLabel: "사진 앱에서 일정 사진 선택" })
        ).toHaveLength(0);
        await captureCameraPhoto("file:///tmp/camera-schedule.jpg");

        expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
        expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
        expect(mockRecognizeQuickSchedulePhoto).toHaveBeenCalledWith(
            "file:///tmp/camera-schedule.jpg",
            expect.stringMatching(/^quick-photo-/)
        );
        expect(hasPhotoScanOverlay()).toBe(true);
        expect(
            renderer!.root.findAll((node) => (
                node.props.accessibilityLabel === "사진에서 일정 내용 읽는 중"
                && typeof node.type === "string"
            ))
        ).toHaveLength(1);
        expect(
            renderer!.root.findAllByProps({ accessibilityLabel: "선택한 사진 정보 및 변경" })
        ).toHaveLength(0);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
                .props.accessibilityState.disabled
        ).toBe(true);

        await act(async () => {
            recognition.resolve({
                text: "7월 24일 오후 두 시 서울역 회의",
                recognitionConfidence: 0.92,
            });
            await recognition.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" }).props.value
        ).toBe("7월 24일 오후 두 시 서울역 회의");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
                .props.accessibilityState.disabled
        ).toBe(false);
        const photoChangeButton = renderer!.root.findByProps({
            accessibilityLabel: "선택한 사진 변경",
        });
        expect(photoChangeButton.props.accessibilityRole).toBe("button");
        expect(photoChangeButton.props.onPress).toEqual(expect.any(Function));
    });

    test("iOS 사진 선택은 보관함 선권한 없이 OCR 오버레이를 표시하고 수정문을 분석한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);
        (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockRejectedValueOnce(
            new Error("사진 보관함 권한 거부")
        );

        await renderQuickScheduleModal(onAnalyze);
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/library-schedule.jpg");

        expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
        expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            recognition.resolve({
                text: "7월 24일 오후 두 시 서울역 회의",
                recognitionConfidence: 0.58,
            });
            await recognition.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findAll((node) => (
                node.props.children === "일부 내용을 정확히 읽지 못했어요. 날짜·시간·장소를 확인해 주세요."
            )).length
        ).toBeGreaterThan(0);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진에서 읽은 내용" })
                .props.onChangeText("7월 24일 오후 세 시 서울역 회의");
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "7월 24일 오후 세 시 서울역 회의",
            expect.objectContaining({
                inputMode: "photo",
                photoUri: "file:///tmp/library-schedule.jpg",
                photoTranscript: "7월 24일 오후 세 시 서울역 회의",
            })
        );
        expect(onAnalyze.mock.calls[0][1].recognitionConfidence).toBeUndefined();
    });

    test("OCR 실패 시 오버레이를 제거하고 재시도와 직접 입력을 제공한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal(onAnalyze);
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/unreadable-schedule.jpg");

        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            recognition.reject(new Error("사진에서 일정 내용을 찾지 못했어요."));
            await recognition.promise.catch(() => undefined);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 내용 다시 읽기" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" })
                .props.placeholder
        ).toBe("읽지 못한 내용을 직접 입력해 주세요.");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" })
                .props.editable
        ).toBe(true);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진에서 읽은 내용" })
                .props.onChangeText("7월 24일 오후 네 시 서울역 회의");
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "7월 24일 오후 네 시 서울역 회의",
            expect.objectContaining({
                inputMode: "photo",
                photoUri: "file:///tmp/unreadable-schedule.jpg",
                photoTranscript: "7월 24일 오후 네 시 서울역 회의",
            })
        );
    });

    test("OCR이 15초를 넘으면 요청과 오버레이를 정리하고 늦은 결과를 무시한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal();
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/slow-schedule.jpg");
        const requestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            jest.advanceTimersByTime(15_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(requestId);
        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진 내용 다시 읽기" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" })
                .props.editable
        ).toBe(true);

        await act(async () => {
            recognition.resolve({
                text: "시간 초과 뒤 도착한 결과",
                recognitionConfidence: 0.99,
            });
            await recognition.promise;
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" }).props.value
        ).toBe("");
    });

    test("사진 A 인식 중 사진 B를 선택하면 A를 취소하고 B 오버레이와 결과만 유지한다", async () => {
        const firstRecognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        const secondRecognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto
            .mockImplementationOnce(() => firstRecognition.promise)
            .mockImplementationOnce(() => secondRecognition.promise);

        await renderQuickScheduleModal();
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/photo-a.jpg");
        const firstRequestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        expect(hasPhotoScanOverlay()).toBe(true);

        await selectLibraryPhoto("file:///tmp/photo-b.jpg");
        const secondRequestId = mockRecognizeQuickSchedulePhoto.mock.calls[1][1] as string;

        expect(secondRequestId).not.toBe(firstRequestId);
        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(firstRequestId);
        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            secondRecognition.resolve({
                text: "7월 25일 오후 다섯 시 부산역 회의",
                recognitionConfidence: 0.91,
            });
            await secondRecognition.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" }).props.value
        ).toBe("7월 25일 오후 다섯 시 부산역 회의");

        await act(async () => {
            firstRecognition.resolve({
                text: "7월 1일 오전 아홉 시 이전 사진 일정",
                recognitionConfidence: 0.99,
            });
            await firstRecognition.promise;
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" }).props.value
        ).toBe("7월 25일 오후 다섯 시 부산역 회의");
    });

    test("선택한 사진을 제거하면 진행 중 OCR을 취소하고 오버레이를 제거한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal();
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/removable-schedule.jpg");
        const requestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "선택한 사진 제거" })
                .props.onPress({ stopPropagation: jest.fn() });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(requestId);
        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findAllByProps({ accessibilityLabel: "사진에서 읽은 내용" })
        ).toHaveLength(0);

        await act(async () => {
            recognition.resolve({
                text: "제거한 사진의 늦은 결과",
                recognitionConfidence: 0.99,
            });
            await recognition.promise;
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findAllByProps({ accessibilityLabel: "사진에서 읽은 내용" })
        ).toHaveLength(0);
    });

    test("OCR 중 모달을 unmount하면 요청을 취소하고 스캔 오버레이를 정리한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal();
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/unmounted-schedule.jpg");
        const requestId = mockRecognizeQuickSchedulePhoto.mock.calls[0][1] as string;

        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            renderer!.unmount();
        });
        renderer = undefined;

        expect(mockCancelQuickSchedulePhotoRecognition).toHaveBeenCalledWith(requestId);
    });

    test("OCR 중 다른 모드로 이동하면 해당 모드 제출은 허용하고 사진 인식 상태는 보존한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal(onAnalyze);
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/mode-transition-schedule.jpg");

        expect(hasPhotoScanOverlay()).toBe(true);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "텍스트로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(mockCancelQuickSchedulePhotoRecognition).not.toHaveBeenCalled();

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장" })
                .props.onChangeText("내일 오후 세 시 회의");
            await Promise.resolve();
        });

        const textSubmitButton = renderer!.root.findByProps({
            accessibilityLabel: "입력 내용으로 일정 미리보기",
        });
        expect(textSubmitButton.props.accessibilityState.disabled).toBe(false);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(true);
        expect(mockRecognizeQuickSchedulePhoto).toHaveBeenCalledTimes(1);

        await act(async () => {
            recognition.resolve({
                text: "7월 26일 오전 열 시 모드 전환 회의",
                recognitionConfidence: 0.9,
            });
            await recognition.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(hasPhotoScanOverlay()).toBe(false);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "사진에서 읽은 내용" }).props.value
        ).toBe("7월 26일 오전 열 시 모드 전환 회의");
    });

    test("사진 OCR이 백그라운드에서 실행 중이어도 텍스트 일정을 분석한다", async () => {
        const recognition = createDeferred<{
            text: string;
            recognitionConfidence: number;
        }>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        mockRecognizeQuickSchedulePhoto.mockImplementationOnce(() => recognition.promise);

        await renderQuickScheduleModal(onAnalyze);
        await enterPhotoMode();
        await selectLibraryPhoto("file:///tmp/background-ocr-schedule.jpg");

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "텍스트로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장" })
                .props.onChangeText("내일 오후 세 시 회의");
            await Promise.resolve();
        });

        const textSubmitButton = renderer!.root.findByProps({
            accessibilityLabel: "입력 내용으로 일정 미리보기",
        });
        expect(textSubmitButton.props.accessibilityState.disabled).toBe(false);

        await act(async () => {
            textSubmitButton.props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "내일 오후 세 시 회의",
            expect.objectContaining({ inputMode: "text" }),
        );

        await act(async () => {
            recognition.resolve({
                text: "7월 27일 오전 열 시 백그라운드 OCR 회의",
                recognitionConfidence: 0.91,
            });
            await recognition.promise;
            await jest.advanceTimersByTimeAsync(220);
            await Promise.resolve();
        });
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
            renderer!.root.findAll((node) => node.props.children === "확인 중")
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
        ).toBe("필요하면 내용을 직접 적어 주세요.");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
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
        expect(alertSpy).toHaveBeenCalledWith(
            "작성 중인 일정이 있어요",
            "지금 닫으면 입력한 내용은 저장되지 않아요.",
            expect.any(Array),
            expect.objectContaining({ cancelable: true }),
        );
        await act(async () => {
            alertSpy.mock.calls.at(-1)?.[2]?.find(button => button.text === "작성 취소")?.onPress?.();
            await Promise.resolve();
        });
        alertSpy.mockClear();
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
            renderer!.root.findAll((node) => node.props.children === "확인 중")
        ).toHaveLength(0);
    });
});
