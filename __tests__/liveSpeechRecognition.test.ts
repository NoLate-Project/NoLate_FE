describe("live speech recognition bridge", () => {
    const listeners = new Map<string, (value: unknown) => void>();

    async function loadModule(nativeModule?: {
        getAvailability?: jest.Mock;
        start: jest.Mock;
        stop: jest.Mock;
        cancel: jest.Mock;
    }) {
        jest.resetModules();
        listeners.clear();

        class NativeEventEmitterMock {
            addListener(eventName: string, listener: (value: unknown) => void) {
                listeners.set(eventName, listener);
                return { remove: jest.fn() };
            }
        }

        jest.doMock("react-native", () => ({
            NativeEventEmitter: NativeEventEmitterMock,
            NativeModules: nativeModule ? { NoLateLiveSpeech: nativeModule } : {},
            Platform: { OS: "ios" },
        }));

        return require("../src/modules/schedule/liveSpeechRecognition") as typeof import("../src/modules/schedule/liveSpeechRecognition");
    }

    afterEach(() => {
        jest.dontMock("react-native");
    });

    test("starts a Korean session with bounded and deduplicated context", async () => {
        const nativeModule = {
            start: jest.fn().mockResolvedValue({ sessionId: " session-1 " }),
            stop: jest.fn(),
            cancel: jest.fn(),
        };
        const bridge = await loadModule(nativeModule);

        await expect(bridge.startLiveSpeechRecognition({
            sessionId: "session-1",
            contextualStrings: [" 내일 ", "내일", "오후", "x", "가".repeat(21)],
            maxDurationMillis: 999_999,
        })).resolves.toBe("session-1");
        expect(nativeModule.start).toHaveBeenCalledWith({
            sessionId: "session-1",
            localeIdentifier: "ko-KR",
            contextualStrings: ["내일", "오후"],
            maxDurationMillis: 120_000,
            requiresOnDeviceRecognition: true,
        });
    });

    test("reports native availability and normalizes the requested locale", async () => {
        const nativeModule = {
            getAvailability: jest.fn().mockResolvedValue({
                serviceAvailable: true,
                supportsOnDevice: false,
                reason: " 온디바이스 모델이 없습니다. ",
            }),
            start: jest.fn(),
            stop: jest.fn(),
            cancel: jest.fn(),
        };
        const bridge = await loadModule(nativeModule);

        await expect(bridge.getLiveSpeechRecognitionAvailability(" ")).resolves.toEqual({
            serviceAvailable: true,
            supportsOnDevice: false,
            reason: "온디바이스 모델이 없습니다.",
        });
        expect(nativeModule.getAvailability).toHaveBeenCalledWith("ko-KR");
    });

    test("allows explicitly opting into Apple's network recognizer", async () => {
        const nativeModule = {
            start: jest.fn().mockResolvedValue({ sessionId: "session-network" }),
            stop: jest.fn(),
            cancel: jest.fn(),
        };
        const bridge = await loadModule(nativeModule);

        await bridge.startLiveSpeechRecognition({
            sessionId: "session-network",
            requiresOnDeviceRecognition: false,
        });

        expect(nativeModule.start).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: "session-network",
            requiresOnDeviceRecognition: false,
        }));
    });

    test("normalizes transcript, level, and state events", async () => {
        const bridge = await loadModule({
            start: jest.fn(),
            stop: jest.fn(),
            cancel: jest.fn(),
        });
        const transcriptListener = jest.fn();
        const levelListener = jest.fn();
        const stateListener = jest.fn();

        bridge.addLiveSpeechTranscriptListener(transcriptListener);
        bridge.addLiveSpeechLevelListener(levelListener);
        bridge.addLiveSpeechStateListener(stateListener);

        listeners.get("NoLateLiveSpeechTranscript")?.({
            sessionId: "session-1",
            text: "  내일   오후 3시  ",
            isFinal: false,
            confidence: 1.7,
            elapsedMillis: 120.4,
        });
        listeners.get("NoLateLiveSpeechLevel")?.({
            sessionId: "session-1",
            rms: -1,
            peak: 1.4,
        });
        listeners.get("NoLateLiveSpeechState")?.({
            sessionId: "session-1",
            state: "listening",
        });

        expect(transcriptListener).toHaveBeenCalledWith({
            sessionId: "session-1",
            text: "내일 오후 3시",
            isFinal: false,
            confidence: 1,
            elapsedMillis: 120,
        });
        expect(levelListener).toHaveBeenCalledWith({
            sessionId: "session-1",
            rms: 0,
            peak: 1,
        });
        expect(stateListener).toHaveBeenCalledWith({
            sessionId: "session-1",
            state: "listening",
        });
    });

    test("ignores malformed events and validates stop results", async () => {
        const nativeModule = {
            start: jest.fn(),
            stop: jest.fn().mockResolvedValue({
                sessionId: "session-2",
                text: "서울역 회의",
                confidence: 0.82,
                elapsedMillis: 2300,
            }),
            cancel: jest.fn().mockResolvedValue(undefined),
        };
        const bridge = await loadModule(nativeModule);
        const listener = jest.fn();
        bridge.addLiveSpeechTranscriptListener(listener);

        listeners.get("NoLateLiveSpeechTranscript")?.({ text: "세션 없음" });
        expect(listener).not.toHaveBeenCalled();

        await expect(bridge.stopLiveSpeechRecognition(" session-2 ")).resolves.toEqual({
            sessionId: "session-2",
            text: "서울역 회의",
            isFinal: true,
            confidence: 0.82,
            elapsedMillis: 2300,
        });
        await bridge.cancelLiveSpeechRecognition("session-2");
        expect(nativeModule.stop).toHaveBeenCalledWith("session-2");
        expect(nativeModule.cancel).toHaveBeenCalledWith("session-2");
    });

    test("reports an actionable error when the native module is unavailable", async () => {
        const bridge = await loadModule();
        expect(bridge.isLiveSpeechRecognitionAvailable).toBe(false);
        await expect(bridge.getLiveSpeechRecognitionAvailability()).resolves.toEqual({
            serviceAvailable: false,
            supportsOnDevice: false,
            reason: "이 기기에서는 실시간 음성 인식을 사용할 수 없습니다.",
        });
        await expect(bridge.startLiveSpeechRecognition()).rejects.toThrow(
            "이 기기에서는 실시간 음성 인식을 사용할 수 없습니다."
        );
    });
});
