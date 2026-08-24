import type { NoLateWidgetSnapshot } from "../src/modules/widget/widgetSnapshot";

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

const snapshot: NoLateWidgetSnapshot = {
    version: 1,
    generatedAt: "2026-08-24T00:00:00.000Z",
    schedules: [],
};

describe("NoLate native widget bridge fence", () => {
    afterEach(() => {
        jest.dontMock("react-native");
        jest.resetModules();
        jest.clearAllMocks();
    });

    it("serializes clear after an accepted write and reports that invalidated write as stale", async () => {
        const nativeWrite = deferred<boolean>();
        const order: string[] = [];
        const nativeWidget = {
            writeSnapshot: jest.fn(() => {
                order.push("write-start");
                return nativeWrite.promise.then((value) => {
                    order.push("write-end");
                    return value;
                });
            }),
            clearSnapshot: jest.fn(async () => {
                order.push("clear");
                return true;
            }),
        };
        jest.doMock("react-native", () => ({
            NativeModules: { NoLateWidget: nativeWidget },
            Platform: { OS: "ios" },
        }));

        const bridge = require("../src/modules/widget/nativeWidgetBridge") as
            typeof import("../src/modules/widget/nativeWidgetBridge");
        const generation = bridge.activateNoLateWidgetSnapshotPublishing();
        const write = bridge.writeNoLateWidgetSnapshot(snapshot, generation);
        await Promise.resolve();
        const clear = bridge.clearNoLateWidgetSnapshot();

        expect(nativeWidget.clearSnapshot).not.toHaveBeenCalled();
        nativeWrite.resolve(true);

        await expect(write).resolves.toBe(false);
        await expect(clear).resolves.toBe(true);
        expect(order).toEqual(["write-start", "write-end", "clear"]);
    });

    it("drops a stale account write before it crosses the native bridge", async () => {
        const nativeWidget = {
            writeSnapshot: jest.fn().mockResolvedValue(true),
            clearSnapshot: jest.fn().mockResolvedValue(true),
        };
        jest.doMock("react-native", () => ({
            NativeModules: { NoLateWidget: nativeWidget },
            Platform: { OS: "ios" },
        }));

        const bridge = require("../src/modules/widget/nativeWidgetBridge") as
            typeof import("../src/modules/widget/nativeWidgetBridge");
        const staleGeneration = bridge.activateNoLateWidgetSnapshotPublishing();
        await bridge.clearNoLateWidgetSnapshot();

        await expect(
            bridge.writeNoLateWidgetSnapshot(snapshot, staleGeneration),
        ).resolves.toBe(false);
        expect(nativeWidget.writeSnapshot).not.toHaveBeenCalled();
    });
});
