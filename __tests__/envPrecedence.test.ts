jest.mock("expo/virtual/env", () => ({ env: { EXPO_PUBLIC_TRANSIT_PROVIDER: "odsay" } }));
const providerKey = "EXPO_PUBLIC_TRANSIT_PROVIDER";
describe("development environment overrides", () => {
    const oldProvider = process.env[providerKey];
    const oldDev = __DEV__;
    afterEach(() => {
        if (oldProvider === undefined) delete process.env[providerKey];
        else process.env[providerKey] = oldProvider;
        (globalThis as any).__DEV__ = oldDev;
        jest.resetModules();
    });
    test("current development override wins over a previously initialized static value", () => {
        (globalThis as any).__DEV__ = true;
        process.env[providerKey] = "odsay";
        const { getEnv } = require("../src/api/env");
        process.env[providerKey] = "tmap";
        expect(getEnv("EXPO_PUBLIC_TRANSIT_PROVIDER")).toBe("tmap");
    });
    test("release retains the static compiled public configuration", () => {
        (globalThis as any).__DEV__ = false;
        process.env[providerKey] = "odsay";
        const { getEnv } = require("../src/api/env");
        process.env[providerKey] = "tmap";
        expect(getEnv("EXPO_PUBLIC_TRANSIT_PROVIDER")).toBe("odsay");
    });
});
