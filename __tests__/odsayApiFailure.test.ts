jest.mock("../src/api/env", () => ({ getEnv: jest.fn() }));
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), isAxiosError: (e: any) => e?.isAxiosError === true } }));
import axios from "axios";
import { getEnv } from "../src/api/env";
import { getOdsayTransitRouteOptions } from "../src/modules/map/odsayApi";

const origin = { name: "노원", lat: 37.6563, lng: 127.0635 };
const destination = { name: "신림", lat: 37.4842, lng: 126.9297 };
describe("ODsay safe error identity", () => {
    beforeEach(() => jest.clearAllMocks());
    test("sends every required maasRP field with a Korean-local search time", async () => {
        jest.mocked(getEnv).mockImplementation((name) => name === "EXPO_PUBLIC_ODSAY_IOS_API_KEY"
            ? "verified-mobile-key" : undefined);
        jest.mocked(axios.get).mockResolvedValueOnce({ data: { result: { paths: [] } } });

        await getOdsayTransitRouteOptions(origin, destination, new Date("2026-10-21T09:10:00Z"));

        expect(axios.get).toHaveBeenCalledWith("https://api.odsay.com/v1/api/maasRP", expect.objectContaining({
            params: expect.objectContaining({
                apiKey: "verified-mobile-key", SX: origin.lng, SY: origin.lat,
                EX: destination.lng, EY: destination.lat,
                SearchTime: "202610211810", SearchMethod: 2,
            }),
        }));
    });
    test("missing configuration is distinct and makes no provider request", async () => {
        jest.mocked(getEnv).mockReturnValue(undefined);
        await expect(getOdsayTransitRouteOptions(origin, destination)).rejects.toMatchObject({ providerCode: "KEY_MISSING" });
        expect(axios.get).not.toHaveBeenCalled();
    });
    test.each([[401, undefined, "HTTP_401"], [429, undefined, "429"], [undefined, "ECONNABORTED", "TIMEOUT"],
        [undefined, "ERR_NETWORK", "NETWORK_UNAVAILABLE"]])("preserves safe code for %s/%s", async (status, code, expected) => {
        jest.mocked(getEnv).mockReturnValue("test-only-secret");
        jest.mocked(axios.get).mockRejectedValueOnce({ isAxiosError: true, response: status ? { status, data: {} } : undefined,
            code, message: "url with test-only-secret", config: { params: { apiKey: "test-only-secret" } } });
        try {
            await getOdsayTransitRouteOptions(origin, destination);
            throw new Error("expected failure");
        } catch (error: any) {
            expect(error.providerCode).toBe(expected);
            expect(error.message).not.toContain("test-only-secret");
            expect(error.config).toBeUndefined();
        }
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});
