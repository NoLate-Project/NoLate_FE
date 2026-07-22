import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickScheduleModal from "../src/modules/schedule/components/form/QuickScheduleModal";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type {
    LiveSpeechLevel,
    LiveSpeechTranscript,
} from "../src/modules/schedule/liveSpeechRecognition";
import type { ScheduleParseResult } from "../src/modules/schedule/types";

let mockTranscriptListener: ((event: LiveSpeechTranscript) => void) | undefined;
let mockLevelListener: ((event: LiveSpeechLevel) => void) | undefined;
const mockStartLiveSpeechRecognition = jest.fn(async (options: { sessionId: string }) => options.sessionId);
const mockStopLiveSpeechRecognition = jest.fn().mockResolvedValue({
    sessionId: "speech-session-1",
    text: "내일 오후 세 시 강남역 회의",
    confidence: 0.92,
    elapsedMillis: 2800,
});
const mockCancelLiveSpeechRecognition = jest.fn().mockResolvedValue(undefined);
const mockCreateLiveSpeechSessionId = jest.fn(() => "speech-session-1");

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
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
jest.mock("../src/modules/schedule/liveSpeechRecognition", () => ({
    isLiveSpeechRecognitionAvailable: true,
    startLiveSpeechRecognition: (options: { sessionId: string }) => mockStartLiveSpeechRecognition(options),
    stopLiveSpeechRecognition: (...args: unknown[]) => mockStopLiveSpeechRecognition(...args),
    cancelLiveSpeechRecognition: (...args: unknown[]) => mockCancelLiveSpeechRecognition(...args),
    createLiveSpeechSessionId: () => mockCreateLiveSpeechSessionId(),
    addLiveSpeechTranscriptListener: (listener: (event: LiveSpeechTranscript) => void) => {
        mockTranscriptListener = listener;
        return { remove: jest.fn() };
    },
    addLiveSpeechLevelListener: (listener: (event: LiveSpeechLevel) => void) => {
        mockLevelListener = listener;
        return { remove: jest.fn() };
    },
    addLiveSpeechStateListener: () => ({ remove: jest.fn() }),
}));
jest.mock("../src/modules/schedule/components/form/QuickScheduleLogoLoader", () => "QuickScheduleLogoLoader");
jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");

const parseResult: ScheduleParseResult = {
    title: "강남역 회의",
    startAt: "2026-07-23T15:00:00+09:00",
    destination: { name: "강남역" },
    originSource: "REQUIRED",
    originRequired: false,
    parseSource: "RULE",
    aiAttempted: false,
    needsReview: false,
    warnings: [],
    missingFields: [],
};

describe("QuickScheduleModal live speech", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        mockTranscriptListener = undefined;
        mockLevelListener = undefined;
        mockStartLiveSpeechRecognition.mockReset();
        mockStartLiveSpeechRecognition.mockImplementation(
            async (options: { sessionId: string }) => options.sessionId
        );
        mockStopLiveSpeechRecognition.mockReset();
        mockStopLiveSpeechRecognition.mockResolvedValue({
            sessionId: "speech-session-1",
            text: "내일 오후 세 시 강남역 회의",
            confidence: 0.92,
            elapsedMillis: 2800,
        });
        mockCancelLiveSpeechRecognition.mockReset();
        mockCancelLiveSpeechRecognition.mockResolvedValue(undefined);
        mockCreateLiveSpeechSessionId.mockReset();
        mockCreateLiveSpeechSessionId.mockReturnValue("speech-session-1");
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("부분 문장을 표시하고 수정한 최종 문장을 분석에 전달한다", async () => {
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-23"
                        onAnalyze={onAnalyze}
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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: "speech-session-1",
            localeIdentifier: "ko-KR",
            maxDurationMillis: 60_000,
        }));

        await act(async () => {
            mockTranscriptListener?.({
                sessionId: "previous-session",
                text: "이전 세션 문장",
                isFinal: false,
            });
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("");

        await act(async () => {
            mockLevelListener?.({
                sessionId: "speech-session-1",
                rms: 0.34,
                peak: 0.62,
                elapsedMillis: 1800,
            });
            mockTranscriptListener?.({
                sessionId: "speech-session-1",
                text: "내일 오후 세 시 강남역 회의",
                isFinal: false,
                confidence: 0.86,
                elapsedMillis: 1900,
            });
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("내일 오후 세 시 강남역 회의");

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
                .props.onPress();
            await Promise.resolve();
        });
        expect(mockStopLiveSpeechRecognition).toHaveBeenCalledWith("speech-session-1");

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" })
                .props.onChangeText("내일 오후 네 시 강남역 회의");
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장 분석" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "내일 오후 네 시 강남역 회의",
            expect.objectContaining({
                inputMode: "voice",
                voiceTranscript: "내일 오후 네 시 강남역 회의",
                voiceDurationMillis: 2800,
            })
        );
        expect(onAnalyze.mock.calls[0][1].recognitionConfidence).toBeUndefined();
    });

    test("이전 시작 실패가 다시 연 모달의 새 음성 세션을 초기화하지 않는다", async () => {
        const firstStart = createDeferred<string>();
        const secondStart = createDeferred<string>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        const onSave = jest.fn();
        const onClose = jest.fn();
        const renderModal = (visible: boolean) => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible={visible}
                    defaultDay="2026-07-23"
                    onAnalyze={onAnalyze}
                    onSave={onSave}
                    onClose={onClose}
                />
            </ThemeProvider>
        );
        mockCreateLiveSpeechSessionId
            .mockReturnValueOnce("speech-session-a")
            .mockReturnValueOnce("speech-session-b");
        mockStartLiveSpeechRecognition
            .mockImplementationOnce(() => firstStart.promise)
            .mockImplementationOnce(() => secondStart.promise);

        await act(async () => {
            renderer = TestRenderer.create(renderModal(true));
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.update(renderModal(false));
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.update(renderModal(true));
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(2);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.accessibilityState.disabled
        ).toBe(true);

        await act(async () => {
            firstStart.reject(new Error("이전 세션 시작 취소"));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.accessibilityState.disabled
        ).toBe(true);

        await act(async () => {
            secondStart.resolve("speech-session-b");
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
        ).toBeDefined();
        expect(mockCancelLiveSpeechRecognition).not.toHaveBeenCalledWith("speech-session-b");
    });

    test("이전 중지 완료가 다시 연 모달의 새 음성 세션을 초기화하지 않는다", async () => {
        const firstStop = createDeferred<{
            sessionId: string;
            text: string;
            confidence: number;
            elapsedMillis: number;
        }>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        const onSave = jest.fn();
        const onClose = jest.fn();
        const renderModal = (visible: boolean) => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible={visible}
                    defaultDay="2026-07-23"
                    onAnalyze={onAnalyze}
                    onSave={onSave}
                    onClose={onClose}
                />
            </ThemeProvider>
        );
        mockCreateLiveSpeechSessionId
            .mockReturnValueOnce("speech-session-a")
            .mockReturnValueOnce("speech-session-b");
        mockStopLiveSpeechRecognition.mockImplementationOnce(() => firstStop.promise);

        await act(async () => {
            renderer = TestRenderer.create(renderModal(true));
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
                .props.onPress();
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" })
                .props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.update(renderModal(false));
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.update(renderModal(true));
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성으로 빠른 일정 만들기" })
                .props.onPress();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(2);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
        ).toBeDefined();

        await act(async () => {
            firstStop.resolve({
                sessionId: "speech-session-a",
                text: "이전 세션 결과",
                confidence: 0.8,
                elapsedMillis: 1200,
            });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
        ).toBeDefined();
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("");
        expect(mockCancelLiveSpeechRecognition).not.toHaveBeenCalledWith("speech-session-b");
    });

    test("중지 버튼을 연속으로 눌러도 활성 세션 중지는 한 번만 요청한다", async () => {
        const stopResult = createDeferred<{
            sessionId: string;
            text: string;
            confidence: number;
            elapsedMillis: number;
        }>();
        mockStopLiveSpeechRecognition.mockImplementationOnce(() => stopResult.promise);

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-23"
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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
        });

        const stopButton = renderer!.root.findByProps({
            accessibilityLabel: "실시간 음성 인식 중지",
        });
        await act(async () => {
            stopButton.props.onPress();
            stopButton.props.onPress();
            await Promise.resolve();
        });

        expect(mockStopLiveSpeechRecognition).toHaveBeenCalledTimes(1);
        expect(mockStopLiveSpeechRecognition).toHaveBeenCalledWith("speech-session-1");

        await act(async () => {
            stopResult.resolve({
                sessionId: "speech-session-1",
                text: "내일 오후 세 시 강남역 회의",
                confidence: 0.92,
                elapsedMillis: 2800,
            });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("내일 오후 세 시 강남역 회의");
    });
});
