jest.mock("../src/api/env", () => ({ getEnv: jest.fn() }));
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), isAxiosError: (e: any) => e?.isAxiosError === true } }));
import axios from "axios";
import { getEnv } from "../src/api/env";
import { getOdsayTransitRouteOptions } from "../src/modules/map/odsayApi";

const origin = { name: "노원", lat: 37.6563, lng: 127.0635 };
const destination = { name: "신림", lat: 37.4842, lng: 126.9297 };
describe("ODsay safe error identity", () => {
    beforeEach(() => jest.clearAllMocks());
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
