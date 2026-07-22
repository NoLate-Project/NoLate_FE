describe("quick schedule media input extraction", () => {
    async function loadModuleWithNative(nativeModule?: {
        recognizeTextFromImage?: jest.Mock;
        transcribeAudioFile?: jest.Mock;
    }) {
        jest.resetModules();
        jest.doMock("react-native", () => ({
            NativeModules: nativeModule
                ? { NoLateQuickInput: nativeModule }
                : {},
            Platform: { OS: "ios" },
        }));

        return require("../src/modules/schedule/quickInputExtraction") as typeof import("../src/modules/schedule/quickInputExtraction");
    }

    afterEach(() => {
        jest.dontMock("react-native");
    });

    test("텍스트 입력은 trim 후 CONVERSATION 타입으로 반환한다", async () => {
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative();

        await expect(resolveQuickScheduleParseInput("  내일 오후 3시 회의  "))
            .resolves
            .toEqual({
                text: "내일 오후 3시 회의",
                inputType: "CONVERSATION",
        });
    });

    test("공유에서 복원한 텍스트는 SHARE_TEXT 타입을 유지한다", async () => {
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative();

        await expect(resolveQuickScheduleParseInput("  금요일 7시 강남역 술약속  ", {
            inputMode: "text",
            inputTypeOverride: "SHARE_TEXT",
        })).resolves.toEqual({
            text: "금요일 7시 강남역 술약속",
            inputType: "SHARE_TEXT",
        });
    });

    test("사진 입력은 iOS OCR 결과를 IMAGE_OCR 타입으로 반환한다", async () => {
        const recognizeTextFromImage = jest.fn().mockResolvedValue({
            text: "회의명: 디자인 리뷰\r\n시간: 오후   3시",
            confidence: 0.87,
        });
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative({
            recognizeTextFromImage,
        });

        await expect(resolveQuickScheduleParseInput("사진으로 입력한 일정", {
            inputMode: "photo",
            photoUri: "file:///tmp/schedule.png",
        })).resolves.toEqual({
            text: "회의명: 디자인 리뷰\n시간: 오후 3시",
            inputType: "IMAGE_OCR",
            recognitionConfidence: 0.87,
        });
        expect(recognizeTextFromImage).toHaveBeenCalledWith("file:///tmp/schedule.png");
    });

    test("사용자가 확인한 사진 OCR 문장은 재인식 없이 그대로 반환한다", async () => {
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative();

        await expect(resolveQuickScheduleParseInput("사진으로 입력한 일정", {
            inputMode: "photo",
            photoUri: "file:///tmp/schedule.png",
            photoTranscript: "  7월 24일 오후 두 시  서울역 회의  ",
            recognitionConfidence: 0.61,
        })).resolves.toEqual({
            text: "7월 24일 오후 두 시 서울역 회의",
            inputType: "IMAGE_OCR",
            recognitionConfidence: 0.61,
        });
    });

    test("음성 입력은 iOS 전사 결과를 VOICE_TRANSCRIPT 타입으로 반환한다", async () => {
        const transcribeAudioFile = jest.fn().mockResolvedValue({
            text: "  내일 오후 세 시 강남역 미팅  ",
            confidence: 0.91,
        });
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative({
            transcribeAudioFile,
        });

        await expect(resolveQuickScheduleParseInput("음성으로 입력한 일정", {
            inputMode: "voice",
            voiceUri: "file:///tmp/schedule.m4a",
            voiceDurationMillis: 2400,
        })).resolves.toEqual({
            text: "내일 오후 세 시 강남역 미팅",
            inputType: "VOICE_TRANSCRIPT",
            recognitionConfidence: 0.91,
        });
        expect(transcribeAudioFile).toHaveBeenCalledWith(
            "file:///tmp/schedule.m4a",
            "ko-KR",
            expect.arrayContaining(["내일", "오후", "강남역", "미팅"])
        );
    });

    test("실시간 받아쓰기 문장은 파일 재전사 없이 그대로 반환한다", async () => {
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative();

        await expect(resolveQuickScheduleParseInput("음성으로 입력한 일정", {
            inputMode: "voice",
            voiceTranscript: "  내일 오후 세 시  강남역 미팅  ",
            voiceDurationMillis: 2400,
            recognitionConfidence: 1.4,
        })).resolves.toEqual({
            text: "내일 오후 세 시 강남역 미팅",
            inputType: "VOICE_TRANSCRIPT",
            recognitionConfidence: 1,
        });
    });

    test("네이티브 신뢰도는 안전한 0~1 범위로 제한한다", async () => {
        const recognizeTextFromImage = jest.fn().mockResolvedValue({
            text: "내일 3시 서울역",
            confidence: 1.4,
        });
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative({
            recognizeTextFromImage,
        });

        await expect(resolveQuickScheduleParseInput("", {
            inputMode: "photo",
            photoUri: "file:///tmp/schedule.png",
        })).resolves.toMatchObject({ recognitionConfidence: 1 });
    });

    test("음성 전사 실패 원인을 사용자에게 그대로 전달한다", async () => {
        const transcribeAudioFile = jest.fn().mockRejectedValue(
            new Error("녹음에서 음성을 감지하지 못했습니다. 마이크 입력을 확인하고 다시 녹음해주세요.")
        );
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative({
            transcribeAudioFile,
        });

        await expect(resolveQuickScheduleParseInput("음성으로 입력한 일정", {
            inputMode: "voice",
            voiceUri: "file:///tmp/silent.m4a",
            voiceDurationMillis: 3000,
        })).rejects.toThrow("녹음에서 음성을 감지하지 못했습니다.");
    });

    test("네이티브 모듈이 없으면 미디어 입력은 사용자 액션 가능한 오류를 던진다", async () => {
        const { resolveQuickScheduleParseInput } = await loadModuleWithNative();

        await expect(resolveQuickScheduleParseInput("사진으로 입력한 일정", {
            inputMode: "photo",
            photoUri: "file:///tmp/schedule.png",
        })).rejects.toThrow("이 기기에서는 사진/음성 텍스트 추출을 사용할 수 없습니다.");
    });
});
