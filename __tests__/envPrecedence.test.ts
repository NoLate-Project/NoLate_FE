jest.mock("expo/virtual/env", () => ({ env: { EXPO_PUBLIC_MAP_PROVIDER: "TMAP" } }));
const settingKey = "EXPO_PUBLIC_MAP_PROVIDER";
describe("development environment overrides", () => {
    const oldSetting = process.env[settingKey];
    const oldDev = __DEV__;
    afterEach(() => {
        if (oldSetting === undefined) delete process.env[settingKey];
        else process.env[settingKey] = oldSetting;
        (globalThis as any).__DEV__ = oldDev;
        jest.resetModules();
    });
    test("current development override wins over a previously initialized static value", () => {
        (globalThis as any).__DEV__ = true;
        process.env[settingKey] = "TMAP";
        const { getEnv } = require("../src/api/env");
        process.env[settingKey] = "NAVER";
        expect(getEnv(settingKey)).toBe("NAVER");
    });
    test("release retains the static compiled public configuration", () => {
        (globalThis as any).__DEV__ = false;
        process.env[settingKey] = "TMAP";
        const { getEnv } = require("../src/api/env");
        process.env[settingKey] = "NAVER";
        expect(getEnv(settingKey)).toBe("TMAP");
    });
});
