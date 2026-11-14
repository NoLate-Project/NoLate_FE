jest.mock("../src/api/env", () => ({ getEnv: jest.fn() }));
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
import axios from "axios";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { getEnv } from "../src/api/env";
import { getIsolatedOdsaySimulatorTransport } from "../src/modules/map/odsaySimulatorTransport";
import { getOdsayTransitRouteOptions } from "../src/modules/map/odsayApi";

const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const oldDev = runtime.__DEV__, oldOS = Platform.OS;
const flag = "EXPO_PUBLIC_ODSAY_ISOLATED_SIMULATOR_FIXTURE";
let enabled: string | undefined, api: string;

beforeEach(() => {
    jest.clearAllMocks(); enabled = "1"; api = "http://127.0.0.1:5523";
    runtime.__DEV__ = true;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    jest.mocked(getEnv).mockImplementation(key => key === flag ? enabled :
        key === "EXPO_PUBLIC_LOCAL_API_BASE_URL" ? api : "must-not-read-real-key");
});
afterEach(() => {
    jest.restoreAllMocks(); runtime.__DEV__ = oldDev;
    Object.defineProperty(Platform, "OS", { configurable: true, value: oldOS });
});

test("normal production/provider flow has no fixture request", async () => {
    enabled = undefined;
    expect(await getIsolatedOdsaySimulatorTransport()).toBeUndefined();
    expect(axios.get).not.toHaveBeenCalled();
});
test("the normal route parser requests the local protocol with no mobile key", async () => {
    jest.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, headers: { "x-nolate-eta-fixture": "h2-memory-only" }, data: { status: "UP" } })
        .mockResolvedValueOnce({ data: { result: { paths: [] } } });
    await expect(getOdsayTransitRouteOptions({ name: "노원", lat: 37.6551, lng: 127.0610 },
        { name: "신림", lat: 37.4842, lng: 126.9297 })).resolves.toEqual([]);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenLastCalledWith("http://127.0.0.1:5523/__eta_fixture__/odsay/maasRP",
        expect.objectContaining({ params: expect.objectContaining({ apiKey: "synthetic-fixture-no-provider-key" }) }));
    expect(jest.mocked(getEnv).mock.calls.flat()).not.toContain("EXPO_PUBLIC_ODSAY_IOS_API_KEY");
});
test("only marked H2 on the explicit simulator receives a synthetic key", async () => {
    jest.mocked(axios.get).mockResolvedValueOnce({ status: 200, headers: { "x-nolate-eta-fixture": "h2-memory-only" }, data: { status: "UP" } });
    expect(await getIsolatedOdsaySimulatorTransport()).toEqual({
        baseUrl: "http://127.0.0.1:5523/__eta_fixture__/odsay", apiKey: "synthetic-fixture-no-provider-key",
    });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith("http://127.0.0.1:5523/health/readiness", { timeout: 3000, maxRedirects: 0 });
    expect(jest.mocked(getEnv).mock.calls.flat()).not.toContain("EXPO_PUBLIC_ODSAY_IOS_API_KEY");
});
test.each(["release", "physical", "android", "shared", "remote"])("%s fixture requests fail before HTTP", async mode => {
    if (mode === "release") runtime.__DEV__ = false;
    if (mode === "physical") jest.replaceProperty(Device, "isDevice", true);
    if (mode === "android") Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    if (mode === "shared") api = "http://127.0.0.1:5522";
    if (mode === "remote") api = "https://nolate.jinuk.dev";
    await expect(getIsolatedOdsaySimulatorTransport()).rejects.toMatchObject({ providerCode: "FIXTURE_REFUSED" });
    expect(axios.get).not.toHaveBeenCalled();
});
test.each([{}, { status: 302 }, { status: 200, headers: {}, data: { status: "UP" } },
    { status: 200, headers: { "x-nolate-eta-fixture": "h2-memory-only" }, data: { status: "DOWN" } }])(
    "unmarked or unavailable fixture never falls back to public ODsay", async ready => {
        jest.mocked(axios.get).mockResolvedValueOnce(ready);
        await expect(getIsolatedOdsaySimulatorTransport()).rejects.toMatchObject({ providerCode: "FIXTURE_NOT_READY" });
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
