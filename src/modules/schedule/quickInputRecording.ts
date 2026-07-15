export type QuickScheduleRecording = {
    stopAndUnloadAsync: () => Promise<unknown>;
    getURI: () => string | null;
};

/**
 * expo-av 녹음은 중지 요청 직후 파일 URI가 준비된다고 보장하지 않는다. 컨테이너의 마지막
 * 오디오 프레임과 헤더가 기록된 뒤에만 URI를 반환해야 Speech가 완전한 파일을 읽을 수 있다.
 */
export async function finalizeQuickScheduleRecording(
    recording: QuickScheduleRecording
): Promise<string> {
    await recording.stopAndUnloadAsync();

    const uri = recording.getURI()?.trim();
    if (!uri) {
        throw new Error("녹음 파일을 저장하지 못했습니다. 다시 녹음해주세요.");
    }

    return uri;
}
