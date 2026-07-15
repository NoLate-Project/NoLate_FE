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

    test("사진 입력은 iOS OCR 결과를 IMAGE_OCR 타입으로 반환한다", async () => {
        const recognizeTextFromImage = jest.fn().mockResolvedValue({
            text: "회의명: 디자인 리뷰\r\n시간: 오후   3시",
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
        });
        expect(recognizeTextFromImage).toHaveBeenCalledWith("file:///tmp/schedule.png");
    });

    test("음성 입력은 iOS 전사 결과를 VOICE_TRANSCRIPT 타입으로 반환한다", async () => {
        const transcribeAudioFile = jest.fn().mockResolvedValue("  내일 오후 세 시 강남역 미팅  ");
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
        });
        expect(transcribeAudioFile).toHaveBeenCalledWith("file:///tmp/schedule.m4a", "ko-KR");
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
