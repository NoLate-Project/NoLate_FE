export function isCurrentScheduleShareRequest(
    activeResourceKey: string | null,
    requestResourceKey: string,
    currentSequence: number,
    requestSequence: number,
): boolean {
    return activeResourceKey === requestResourceKey
        && currentSequence === requestSequence;
}
