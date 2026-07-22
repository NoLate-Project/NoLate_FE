import { retryPushRegistration } from "../src/modules/notification/pushRegistrationRetry";

describe("push registration retry", () => {
    test("일시적인 APNs 또는 네트워크 실패 뒤 토큰 등록을 다시 시도한다", async () => {
        const task = jest.fn()
            .mockRejectedValueOnce(new Error("APNs token unavailable"))
            .mockRejectedValueOnce(new Error("network timeout"))
            .mockResolvedValue(undefined);
        const sleep = jest.fn().mockResolvedValue(undefined);

        await retryPushRegistration(task, {
            delaysMs: [0, 1_000, 3_000],
            isCurrent: () => true,
            sleep,
        });

        expect(task).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
        expect(sleep).toHaveBeenNthCalledWith(2, 3_000);
    });

    test("로그아웃으로 등록 세대가 바뀌면 남은 재시도를 중단한다", async () => {
        let current = true;
        const task = jest.fn().mockImplementation(async () => {
            current = false;
            throw new Error("registration failed");
        });

        await expect(retryPushRegistration(task, {
            delaysMs: [0, 1_000, 3_000],
            isCurrent: () => current,
            sleep: async () => undefined,
        })).resolves.toBeUndefined();

        expect(task).toHaveBeenCalledTimes(1);
    });

    test("모든 재시도가 실패하면 마지막 오류를 호출자에게 전달한다", async () => {
        const lastError = new Error("FCM registration failed");
        const task = jest.fn()
            .mockRejectedValueOnce(new Error("first"))
            .mockRejectedValueOnce(lastError);

        await expect(retryPushRegistration(task, {
            delaysMs: [0, 1_000],
            isCurrent: () => true,
            sleep: async () => undefined,
        })).rejects.toBe(lastError);
    });
});
