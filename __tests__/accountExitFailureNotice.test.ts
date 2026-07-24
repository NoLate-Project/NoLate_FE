import {
    consumeAccountExitFailure,
    reportAccountExitFailure,
    subscribeAccountExitFailure,
} from "../src/modules/auth/accountExitFailureNotice";
import {
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    beginAuthLogoutSession,
} from "../src/modules/auth/authSessionEpoch";

describe("account-exit failure handoff", () => {
    beforeEach(() => {
        const epoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(epoch);
    });

    test("현재 logout operation의 탈퇴 실패만 로그인 화면에 한 번 전달한다", () => {
        const exitEpoch = beginAuthLogoutSession();
        const listener = jest.fn();
        const unsubscribe = subscribeAccountExitFailure(listener);

        expect(reportAccountExitFailure({
            authEpoch: exitEpoch,
            message: "다시 로그인한 뒤 재시도해 주세요.",
        })).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(consumeAccountExitFailure()).toEqual({
            authEpoch: exitEpoch,
            message: "다시 로그인한 뒤 재시도해 주세요.",
        });
        expect(consumeAccountExitFailure()).toBeUndefined();
        unsubscribe();
    });

    test("A withdrawal 실패보다 B login이 먼저 끝나면 B 화면에는 안내를 표시하지 않는다", () => {
        const aExitEpoch = beginAuthLogoutSession();
        const bEpoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(bEpoch);
        const listener = jest.fn();
        const unsubscribe = subscribeAccountExitFailure(listener);

        expect(reportAccountExitFailure({
            authEpoch: aExitEpoch,
            message: "A account failure",
        })).toBe(false);
        expect(listener).not.toHaveBeenCalled();
        expect(consumeAccountExitFailure()).toBeUndefined();
        unsubscribe();
    });
});
