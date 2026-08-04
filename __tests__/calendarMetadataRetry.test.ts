import {
    CALENDAR_METADATA_RETRY_DELAYS_MS,
    getCalendarMetadataRetryTargetKey,
    getNextCalendarMetadataRetry,
    resetCalendarMetadataRetryState,
} from "../src/modules/schedule/calendarMetadataRetry";

describe("calendar metadata retry policy", () => {
    test("5초와 30초 재시도만 허용한 뒤 자동 재시도를 멈춘다", () => {
        const targetKey = getCalendarMetadataRetryTargetKey(
            ["2027-01", "2027-02", "2027-03"],
            0,
        );
        const initialState = resetCalendarMetadataRetryState(targetKey);

        const first = getNextCalendarMetadataRetry(initialState, targetKey);
        const second = getNextCalendarMetadataRetry(first.state, targetKey);
        const exhausted = getNextCalendarMetadataRetry(second.state, targetKey);
        const stillExhausted = getNextCalendarMetadataRetry(
            exhausted.state,
            targetKey,
        );

        expect(CALENDAR_METADATA_RETRY_DELAYS_MS).toEqual([5_000, 30_000]);
        expect(first.delayMs).toBe(5_000);
        expect(second.delayMs).toBe(30_000);
        expect(exhausted.delayMs).toBeNull();
        expect(stillExhausted.delayMs).toBeNull();
        expect(stillExhausted.state.scheduledRetryCount).toBe(2);
        expect(initialState.scheduledRetryCount).toBe(0);
    });

    test("월 target이 바뀌면 소진된 retry budget을 자동으로 초기화한다", () => {
        const januaryTarget = getCalendarMetadataRetryTargetKey(
            ["2026-12", "2027-01", "2027-02"],
            0,
        );
        const februaryTarget = getCalendarMetadataRetryTargetKey(
            ["2027-01", "2027-02", "2027-03"],
            0,
        );
        const first = getNextCalendarMetadataRetry(
            resetCalendarMetadataRetryState(januaryTarget),
            januaryTarget,
        );
        const second = getNextCalendarMetadataRetry(first.state, januaryTarget);
        const changedTarget = getNextCalendarMetadataRetry(
            second.state,
            februaryTarget,
        );

        expect(changedTarget.delayMs).toBe(5_000);
        expect(changedTarget.state).toEqual({
            targetKey: februaryTarget,
            scheduledRetryCount: 1,
        });
    });

    test("firstDay 변경도 별도 target으로 취급한다", () => {
        const sundayTarget = getCalendarMetadataRetryTargetKey(
            ["2027-02"],
            0,
        );
        const mondayTarget = getCalendarMetadataRetryTargetKey(
            ["2027-02"],
            1,
        );
        const sundayRetry = getNextCalendarMetadataRetry(
            resetCalendarMetadataRetryState(sundayTarget),
            sundayTarget,
        );
        const mondayRetry = getNextCalendarMetadataRetry(
            sundayRetry.state,
            mondayTarget,
        );

        expect(sundayTarget).not.toBe(mondayTarget);
        expect(mondayRetry.delayMs).toBe(5_000);
        expect(mondayRetry.state.targetKey).toBe(mondayTarget);
    });

    test("foreground 수동 trigger는 같은 target의 retry budget도 명시적으로 reset할 수 있다", () => {
        const targetKey = getCalendarMetadataRetryTargetKey(["2027-02"], 0);
        const first = getNextCalendarMetadataRetry(
            resetCalendarMetadataRetryState(targetKey),
            targetKey,
        );
        const second = getNextCalendarMetadataRetry(first.state, targetKey);
        const foregroundReset = resetCalendarMetadataRetryState(targetKey);
        const afterForeground = getNextCalendarMetadataRetry(
            foregroundReset,
            targetKey,
        );

        expect(second.state.scheduledRetryCount).toBe(2);
        expect(foregroundReset.scheduledRetryCount).toBe(0);
        expect(afterForeground.delayMs).toBe(5_000);
    });

    test("같은 월 집합은 순서와 중복에 관계없이 같은 target key를 만든다", () => {
        expect(getCalendarMetadataRetryTargetKey(
            ["2027-03", "2027-01", "2027-02", "2027-01"],
            0,
        )).toBe(getCalendarMetadataRetryTargetKey(
            ["2027-01", "2027-02", "2027-03"],
            0,
        ));
    });
});
