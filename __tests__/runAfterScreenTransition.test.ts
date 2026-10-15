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

    it("애니메이션 없는 화면에서는 interaction 직후 작업을 시작한다", () => {
        const task = jest.fn();

        runAfterScreenTransition(task, SCREEN_TRANSITION_SETTLE_MS);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it("화면을 벗어나면 예약된 작업을 취소한다", () => {
        const task = jest.fn();
        const scheduled = runAfterScreenTransition(task, 10);

        scheduled.cancel();
        jest.runAllTimers();

        expect(mockInteractionCancel).toHaveBeenCalledTimes(1);
        expect(task).not.toHaveBeenCalled();
    });
});
