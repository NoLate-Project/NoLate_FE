import {
    getOrCreatePushDeviceId,
} from "../src/modules/notification/pushDeviceId";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe("push installation device ID", () => {
    test("A/B 동시 최초 등록도 하나의 ID만 생성·저장·서버 등록에 사용한다", async () => {
        let storedDeviceId: string | null = null;
        const firstWrite = deferred<void>();
        const writeStarted = deferred<void>();
        const generate = jest.fn(() => "installation-one");
        const read = jest.fn(async () => storedDeviceId);
        const write = jest.fn(async (deviceId: string) => {
            writeStarted.resolve();
            await firstWrite.promise;
            storedDeviceId = deviceId;
        });
        const serverRegistrations: string[] = [];

        const register = async () => {
            const deviceId = await getOrCreatePushDeviceId({
                read,
                write,
                generate,
            });
            serverRegistrations.push(deviceId);
            return deviceId;
        };

        const aRegistration = register();
        await writeStarted.promise;
        const bRegistration = register();
        firstWrite.resolve();

        await expect(Promise.all([aRegistration, bRegistration])).resolves.toEqual([
            "installation-one",
            "installation-one",
        ]);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
        expect(serverRegistrations).toEqual([
            "installation-one",
            "installation-one",
        ]);
        expect(storedDeviceId).toBe("installation-one");
    });
});
