import { InteractionManager } from "react-native";

import {
    runAfterScreenTransition,
    SCREEN_TRANSITION_SETTLE_MS,
} from "../src/modules/performance/runAfterScreenTransition";

const mockInteractionCancel = jest.fn();

describe("runAfterScreenTransition", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((task) => {
            (task as () => void)();
            return { cancel: mockInteractionCancel } as unknown as ReturnType<
                typeof InteractionManager.runAfterInteractions
            >;
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("native interaction 이후 전환 안정화 시간까지 네트워크 작업을 미룬다", () => {
        const task = jest.fn();

        runAfterScreenTransition(task, SCREEN_TRANSITION_SETTLE_MS);
        jest.advanceTimersByTime(SCREEN_TRANSITION_SETTLE_MS - 1);
        expect(task).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it("화면을 벗어나면 예약된 작업을 취소한다", () => {
        const task = jest.fn();
        const scheduled = runAfterScreenTransition(task, SCREEN_TRANSITION_SETTLE_MS);

        scheduled.cancel();
        jest.runAllTimers();

        expect(mockInteractionCancel).toHaveBeenCalledTimes(1);
        expect(task).not.toHaveBeenCalled();
    });
});
