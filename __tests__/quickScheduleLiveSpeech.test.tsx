import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import { ActionSheetIOS, Alert } from "react-native";

import QuickScheduleModal from "../src/modules/schedule/components/form/QuickScheduleModal";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type {
    LiveSpeechLevel,
    LiveSpeechState,
    LiveSpeechTranscript,
} from "../src/modules/schedule/liveSpeechRecognition";
import type { ScheduleParseResult } from "../src/modules/schedule/types";

let mockTranscriptListener: ((event: LiveSpeechTranscript) => void) | undefined;
let mockLevelListener: ((event: LiveSpeechLevel) => void) | undefined;
let mockStateListener: ((event: LiveSpeechState) => void) | undefined;
const mockStartLiveSpeechRecognition = jest.fn(async (options: { sessionId: string }) => options.sessionId);
const mockStopLiveSpeechRecognition = jest.fn().mockResolvedValue({
    sessionId: "speech-session-1",
    text: "내일 오후 세 시 강남역 회의",
    confidence: 0.92,
    elapsedMillis: 2800,
});
const mockCancelLiveSpeechRecognition = jest.fn().mockResolvedValue(undefined);
const mockCreateLiveSpeechSessionId = jest.fn(() => "speech-session-1");
const mockGetLiveSpeechRecognitionAvailability = jest.fn().mockResolvedValue({
    serviceAvailable: true,
    supportsOnDevice: true,
});

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
    ...jest.requireActual("../src/modules/schedule/liveSpeechRecognition"),
    isLiveSpeechRecognitionAvailable: true,
    getLiveSpeechRecognitionAvailability: (...args: unknown[]) => (
        mockGetLiveSpeechRecognitionAvailability(...args)
    ),
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
    addLiveSpeechStateListener: (listener: (event: LiveSpeechState) => void) => {
        mockStateListener = listener;
        return { remove: jest.fn() };
    },
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
    confidence: {
        overall: 0.97,
        level: "HIGH",
        fields: { date: 0.98, time: 0.98, destination: 0.94 },
        reasons: [],
    },
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
        mockStateListener = undefined;
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
        mockGetLiveSpeechRecognitionAvailability.mockReset();
        mockGetLiveSpeechRecognitionAvailability.mockResolvedValue({
            serviceAvailable: true,
            supportsOnDevice: true,
        });
        (Audio.requestPermissionsAsync as jest.Mock).mockReset();
        (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
        (ImagePicker.launchImageLibraryAsync as jest.Mock).mockClear();
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
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
        expect(
            renderer!.root.findByProps({ testID: "quick-schedule-voice-spectrum" })
        ).toBeDefined();
        expect(
            renderer!.root.findAll((node) => (
                node.props.testID === "quick-schedule-voice-spectrum-bar"
                && typeof node.type === "string"
            ))
        ).toHaveLength(48);
        expect(
            renderer!.root.findAll((node) => node.props.children === "말하기")
        ).not.toHaveLength(0);
        expect(
            renderer!.root.findAll((node) => node.props.children === "눌러서 시작")
        ).not.toHaveLength(0);
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
            requiresOnDeviceRecognition: true,
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
        expect(
            renderer!.root.findAll((node) => (
                typeof node.props.children === "string"
                && node.props.children.includes("음성 인식 참고값")
            ))
        ).toHaveLength(0);

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
                .findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
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

    test("짧아진 부분 인식 결과가 먼저 말한 내용을 지우지 않는다", async () => {
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

        await act(async () => {
            mockTranscriptListener?.({
                sessionId: "speech-session-1",
                text: "내일 오후 세 시 강남역 회의",
                isFinal: false,
            });
            mockTranscriptListener?.({
                sessionId: "speech-session-1",
                text: "강남역 회의",
                isFinal: false,
            });
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("내일 오후 세 시 강남역 회의");
    });

    test("최종 전사 뒤 자발적 finished가 오면 남은 시간으로 자동 재시작하고 이어 붙인다", async () => {
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        mockCreateLiveSpeechSessionId
            .mockReturnValueOnce("speech-session-a")
            .mockReturnValueOnce("speech-session-b");
        mockStopLiveSpeechRecognition.mockResolvedValueOnce({
            sessionId: "speech-session-b",
            text: "강남역 회의",
            confidence: 0.88,
            elapsedMillis: 800,
            alternatives: [
                { text: "강남역 회의", confidence: 0.88 },
                { text: "강남형 회의", confidence: 0.61 },
            ],
        });

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
        await act(async () => {
            mockTranscriptListener?.({
                sessionId: "speech-session-a",
                text: "내일 오후 세 시",
                isFinal: true,
                confidence: 0.91,
                elapsedMillis: 1000,
                alternatives: [
                    { text: "내일 오후 세 시", confidence: 0.91 },
                    { text: "내일 오후 네 시", confidence: 0.72 },
                ],
            });
            mockStateListener?.({
                sessionId: "speech-session-a",
                state: "finished",
            });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(2);
        expect(mockStartLiveSpeechRecognition).toHaveBeenLastCalledWith(expect.objectContaining({
            sessionId: "speech-session-b",
            maxDurationMillis: 59_000,
        }));
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("내일 오후 세 시");

        await act(async () => {
            mockTranscriptListener?.({
                sessionId: "speech-session-b",
                text: "강남역 회의",
                isFinal: false,
                confidence: 0.88,
                elapsedMillis: 800,
                alternatives: [
                    { text: "강남역 회의", confidence: 0.88 },
                    { text: "강남형 회의", confidence: 0.61 },
                ],
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
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledWith(
            "내일 오후 세 시 강남역 회의",
            expect.objectContaining({
                inputMode: "voice",
                voiceDurationMillis: 1800,
                voiceTranscript: "내일 오후 세 시 강남역 회의",
                voiceAlternatives: [
                    { text: "내일 오후 세 시 강남역 회의", confidence: 0.88 },
                    { text: "내일 오후 세 시 강남형 회의", confidence: 0.61 },
                ],
            })
        );
    });

    test("명시적 중지 중 finished가 와도 자동 재시작하지 않는다", async () => {
        const pendingStop = createDeferred<{
            sessionId: string;
            text: string;
            confidence: number;
            elapsedMillis: number;
        }>();
        mockCreateLiveSpeechSessionId.mockReturnValueOnce("speech-session-a");
        mockStopLiveSpeechRecognition.mockImplementationOnce(() => pendingStop.promise);

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
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
                .props.onPress();
            mockStateListener?.({
                sessionId: "speech-session-a",
                state: "finished",
            });
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(1);

        await act(async () => {
            pendingStop.resolve({
                sessionId: "speech-session-a",
                text: "내일 오후 세 시 회의",
                confidence: 0.9,
                elapsedMillis: 1000,
            });
            await pendingStop.promise;
            await Promise.resolve();
        });
        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(1);
    });

    test("명시적으로 완료한 뒤 다시 인식하면 이전 전사와 시간을 지우고 새로 시작한다", async () => {
        mockCreateLiveSpeechSessionId
            .mockReturnValueOnce("speech-session-a")
            .mockReturnValueOnce("speech-session-b");
        mockStopLiveSpeechRecognition.mockResolvedValueOnce({
            sessionId: "speech-session-a",
            text: "내일 오후 세 시 회의",
            confidence: 0.9,
            elapsedMillis: 1000,
        });

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
        await act(async () => {
            mockTranscriptListener?.({
                sessionId: "speech-session-a",
                text: "내일 오후 세 시 회의",
                isFinal: false,
                elapsedMillis: 900,
            });
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 중지" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("내일 오후 세 시 회의");

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "음성 다시 인식" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("");
        expect(mockStartLiveSpeechRecognition).toHaveBeenLastCalledWith(expect.objectContaining({
            sessionId: "speech-session-b",
            maxDurationMillis: 60_000,
        }));

        await act(async () => {
            mockTranscriptListener?.({
                sessionId: "speech-session-b",
                text: "금요일 오전 열 시 병원",
                isFinal: false,
                elapsedMillis: 600,
            });
        });
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" }).props.value
        ).toBe("금요일 오전 열 시 병원");
    });

    test("이전 시작 실패가 다시 연 모달의 새 음성 세션을 초기화하지 않는다", async () => {
        const firstStart = createDeferred<string>();
        const secondStart = createDeferred<string>();
        const onAnalyze = jest.fn().mockResolvedValue(parseResult);
        const onSave = jest.fn();
        const onClose = jest.fn();
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
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
            alertSpy.mock.calls.at(-1)?.[2]?.find(button => button.text === "작성 취소")?.onPress?.();
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
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
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
            alertSpy.mock.calls.at(-1)?.[2]?.find(button => button.text === "작성 취소")?.onPress?.();
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

    test("온디바이스 모델이 없으면 동의 후에만 Apple 온라인 인식을 시작한다", async () => {
        mockGetLiveSpeechRecognitionAvailability.mockResolvedValueOnce({
            serviceAvailable: true,
            supportsOnDevice: false,
            reason: "이 기기에서는 오프라인 음성 입력을 사용할 수 없어요.",
        });
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

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
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            "음성 입력 방법을 선택해 주세요",
            expect.stringContaining("Apple 음성 인식 서비스로 전송될 수 있지만"),
            expect.any(Array)
        );
        const buttons = alertSpy.mock.calls.at(-1)?.[2];
        const onlineButton = buttons?.find((button) => button.text === "인터넷 음성 입력");

        await act(async () => {
            onlineButton?.onPress?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledWith(expect.objectContaining({
            requiresOnDeviceRecognition: false,
        }));
        alertSpy.mockRestore();
    });

    test("음성 서비스가 없으면 녹음을 시작하지 않고 직접 입력을 안내한다", async () => {
        mockGetLiveSpeechRecognitionAvailability.mockResolvedValueOnce({
            serviceAvailable: false,
            supportsOnDevice: false,
            reason: "현재 한국어 음성 인식 서비스를 사용할 수 없습니다.",
        });
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

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
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            "음성 인식 사용 불가",
            expect.stringContaining("직접 입력해 주세요")
        );
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "실시간 음성 인식 텍스트" })
                .props.editable
        ).toBe(true);
        alertSpy.mockRestore();
    });

    test("닫기 전에 띄운 온라인 인식 동의는 재오픈 뒤 새 녹음을 시작하지 않는다", async () => {
        mockGetLiveSpeechRecognitionAvailability.mockResolvedValueOnce({
            serviceAvailable: true,
            supportsOnDevice: false,
            reason: "이 기기에서는 오프라인 음성 입력을 사용할 수 없어요.",
        });
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
        const renderModal = (visible: boolean) => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible={visible}
                    defaultDay="2026-07-23"
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
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "실시간 음성 인식 시작" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        const buttons = alertSpy.mock.calls.at(-1)?.[2];
        const staleOnlineButton = buttons?.find((button) => button.text === "인터넷 음성 입력");

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
            staleOnlineButton?.onPress?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    test("활성 STT 오디오 세션 취소가 끝난 뒤에만 사진 선택기를 연다", async () => {
        const pendingCancel = createDeferred<void>();
        const actionSheetSpy = jest
            .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
            .mockImplementation(() => undefined);
        mockCancelLiveSpeechRecognition.mockImplementationOnce(() => pendingCancel.promise);

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

        expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
        expect(actionSheetSpy).not.toHaveBeenCalled();
        await act(async () => {
            pendingCancel.resolve(undefined);
            await pendingCancel.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(actionSheetSpy).toHaveBeenCalledTimes(1);
        const actionSheetCallback = actionSheetSpy.mock.calls[0][1];
        await act(async () => {
            actionSheetCallback(1);
            await jest.advanceTimersByTimeAsync(360);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
        actionSheetSpy.mockRestore();
    });

    test("이전 STT 정리가 끝나기 전에는 재시작하지 않고 새 세션도 닫을 때 정리한다", async () => {
        const firstCancel = createDeferred<void>();
        const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
        mockCreateLiveSpeechSessionId
            .mockReturnValueOnce("speech-session-a")
            .mockReturnValueOnce("speech-session-b");
        mockCancelLiveSpeechRecognition
            .mockImplementationOnce(() => firstCancel.promise)
            .mockResolvedValueOnce(undefined);

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
            await Promise.resolve();
        });
        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(1);

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "사진으로 빠른 일정 만들기" })
                .props.onPress();
            await Promise.resolve();
        });
        expect(mockCancelLiveSpeechRecognition).toHaveBeenCalledWith("speech-session-a");

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

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(1);

        await act(async () => {
            firstCancel.resolve(undefined);
            await firstCancel.promise;
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockStartLiveSpeechRecognition).toHaveBeenCalledTimes(2);
        expect(mockStartLiveSpeechRecognition).toHaveBeenLastCalledWith(expect.objectContaining({
            sessionId: "speech-session-b",
        }));

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            alertSpy.mock.calls.at(-1)?.[2]?.find(button => button.text === "작성 취소")?.onPress?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockCancelLiveSpeechRecognition).toHaveBeenCalledWith("speech-session-b");
        expect(
            mockCancelLiveSpeechRecognition.mock.calls.filter(
                ([sessionId]) => sessionId === "speech-session-b"
            )
        ).toHaveLength(1);
    });
});
