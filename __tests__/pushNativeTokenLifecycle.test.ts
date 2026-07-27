import {
    clearPushNativeTokenState,
    getPushTokenForNativeContext,
    writePushNativeContext,
} from "../src/modules/notification/pushNativeTokenLifecycle";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe("native push token session lifecycle", () => {
    test("A의 늦은 context read가 완료돼도 B token을 삭제하거나 회전하지 않는다", async () => {
        let authEpoch = 10;
        let generation = 1;
        let nativeToken = "pre-B-token";
        let storedContext: string | null = null;
        const aContextRead = deferred<string | null>();
        const aDeleteToken = jest.fn(async () => {
            nativeToken = "";
        });
        const aGetToken = jest.fn(async () => {
            nativeToken = "late-A-token";
            return nativeToken;
        });
        const aServerRegister = jest.fn(async (_token: string) => undefined);
        const aContextWrite = jest.fn(async (value: string) => {
            storedContext = value;
        });
        const aEpoch = authEpoch;
        const aGeneration = generation;
        const aFence = {
            isCurrent: () =>
                authEpoch === aEpoch && generation === aGeneration,
        };

        const aRegistration = (async () => {
            const token = await getPushTokenForNativeContext({
                nativeContext: "A-context",
                fence: aFence,
                readContext: () => aContextRead.promise,
                deleteToken: aDeleteToken,
                getToken: aGetToken,
            });
            if (!token || !aFence.isCurrent()) return;
            await aServerRegister(token);
            if (!aFence.isCurrent()) return;
            await writePushNativeContext({
                nativeContext: "A-context",
                fence: aFence,
                writeContext: aContextWrite,
            });
        })();

        authEpoch = 11;
        generation = 2;
        const bFence = {
            isCurrent: () => authEpoch === 11 && generation === 2,
        };
        const bDeleteToken = jest.fn(async () => {
            nativeToken = "";
        });
        const bGetToken = jest.fn(async () => {
            nativeToken = "B-token";
            return nativeToken;
        });
        const bServerRegister = jest.fn(async (_token: string) => undefined);
        const bContextWrite = jest.fn(async (value: string) => {
            storedContext = value;
        });

        const bToken = await getPushTokenForNativeContext({
            nativeContext: "B-context",
            fence: bFence,
            readContext: async () => storedContext,
            deleteToken: bDeleteToken,
            getToken: bGetToken,
        });
        expect(bToken).toBe("B-token");
        if (!bToken) throw new Error("B token should be available");
        await bServerRegister(bToken);
        await writePushNativeContext({
            nativeContext: "B-context",
            fence: bFence,
            writeContext: bContextWrite,
        });

        aContextRead.resolve(null);
        await aRegistration;

        expect(aDeleteToken).not.toHaveBeenCalled();
        expect(aGetToken).not.toHaveBeenCalled();
        expect(aServerRegister).not.toHaveBeenCalled();
        expect(aContextWrite).not.toHaveBeenCalled();
        expect(bDeleteToken).toHaveBeenCalledTimes(1);
        expect(bGetToken).toHaveBeenCalledTimes(1);
        expect(bServerRegister).toHaveBeenCalledWith("B-token");
        expect(bContextWrite).toHaveBeenCalledWith("B-context");
        expect(nativeToken).toBe("B-token");
        expect(storedContext).toBe("B-context");
    });

    test("logout은 진행 중 getToken 뒤에 직렬화되어 old refresh 결과와 context를 제거한다", async () => {
        let current = true;
        let nativeToken = "A-token";
        let storedContext: string | null = "same-context";
        const tokenRead = deferred<string>();
        const oldServerRegister = jest.fn(async (_token: string) => undefined);
        const oldContextWrite = jest.fn(async (value: string) => {
            storedContext = value;
        });
        const fence = { isCurrent: () => current };

        const oldRefresh = (async () => {
            const token = await getPushTokenForNativeContext({
                nativeContext: "same-context",
                fence,
                readContext: async () => storedContext,
                deleteToken: jest.fn(async () => undefined),
                getToken: () => tokenRead.promise,
            });
            if (!token || !fence.isCurrent()) return;
            await oldServerRegister(token);
            await writePushNativeContext({
                nativeContext: "same-context",
                fence,
                writeContext: oldContextWrite,
            });
        })();
        await Promise.resolve();
        await Promise.resolve();

        current = false;
        const logoutDeleteToken = jest.fn(async () => {
            nativeToken = "";
        });
        const logout = clearPushNativeTokenState({
            deleteContext: async () => {
                storedContext = null;
            },
            deleteToken: logoutDeleteToken,
        });
        tokenRead.resolve("late-A-token");

        await oldRefresh;
        await logout;

        expect(oldServerRegister).not.toHaveBeenCalled();
        expect(oldContextWrite).not.toHaveBeenCalled();
        expect(logoutDeleteToken).toHaveBeenCalledTimes(1);
        expect(nativeToken).toBe("");
        expect(storedContext).toBeNull();
    });
});
