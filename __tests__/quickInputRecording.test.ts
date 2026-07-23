import { finalizeQuickScheduleRecording } from "../src/modules/schedule/quickInputRecording";

describe("finalizeQuickScheduleRecording", () => {
    test("파일 종료가 완료된 뒤 URI를 반환한다", async () => {
        let finalized = false;
        const recording = {
            stopAndUnloadAsync: jest.fn(async () => {
                finalized = true;
            }),
            getURI: jest.fn(() => finalized ? "file:///tmp/schedule.m4a" : null),
        };

        await expect(finalizeQuickScheduleRecording(recording))
            .resolves.toBe("file:///tmp/schedule.m4a");
        expect(recording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
        expect(recording.getURI).toHaveBeenCalledTimes(1);
    });

    test("저장 후에도 URI가 없으면 분석 단계로 넘기지 않는다", async () => {
        const recording = {
            stopAndUnloadAsync: jest.fn(async () => undefined),
            getURI: jest.fn(() => null),
        };

        await expect(finalizeQuickScheduleRecording(recording))
            .rejects.toThrow("녹음 파일을 저장하지 못했습니다");
    });

    test("녹음기 저장 오류를 호출자에게 그대로 전달한다", async () => {
        const recording = {
            stopAndUnloadAsync: jest.fn(async () => {
                throw new Error("recorder write failed");
            }),
            getURI: jest.fn(() => "file:///tmp/incomplete.m4a"),
        };

        await expect(finalizeQuickScheduleRecording(recording))
            .rejects.toThrow("recorder write failed");
        expect(recording.getURI).not.toHaveBeenCalled();
    });
});
