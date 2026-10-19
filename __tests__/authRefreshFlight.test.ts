jest.mock("../src/api/env", () => ({ getEnv: () => undefined }));
jest.mock("../src/modules/journey/automaticJourney", () => ({ refreshAutomaticJourneyCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("axios", () => ({
    __esModule: true,
    default: {
        create: () => Object.assign(jest.fn().mockResolvedValue({ data: "retried" }), {
            interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
        }),
        post: jest.fn(),
        isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
    },
}));
jest.mock("../src/modules/auth/authStorage", () => ({
    configureSharedAuthApiBaseUrl: jest.fn(), clearAuthTokens: jest.fn(),
    getAccessToken: jest.fn(), getRefreshToken: jest.fn(),
    getAuthCredentialRevision: jest.fn(), saveRefreshedAuthTokens: jest.fn(),
}));
import axios from "axios";
import { apiClient, refreshCurrentAuthTokens } from "../src/api/api";
import { refreshAutomaticJourneyCredentials } from "../src/modules/journey/automaticJourney";
import { getAccessToken, getAuthCredentialRevision, getRefreshToken, saveRefreshedAuthTokens } from "../src/modules/auth/authStorage";
const recover401 = (apiClient.interceptors.response.use as jest.Mock).mock.calls[0][1];
const response = { data: { success: true, data: { accessToken: "new-access", refreshToken: "new-refresh" } } };
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAuthCredentialRevision).mockReturnValue(1);
    jest.mocked(getRefreshToken).mockResolvedValue("refresh");
    jest.mocked(getAccessToken).mockResolvedValue("old-access");
    jest.mocked(saveRefreshedAuthTokens).mockResolvedValue(true);
    jest.mocked(refreshAutomaticJourneyCredentials).mockResolvedValue(null);
});
it("concurrent proactive refreshes share one rotation flight", async () => {
    jest.mocked(axios.post).mockResolvedValue(response);
    const result = await Promise.all([refreshCurrentAuthTokens(), refreshCurrentAuthTokens(), refreshCurrentAuthTokens()]);
    expect(result.map(value => value.kind)).toEqual(["refreshed", "refreshed", "refreshed"]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(saveRefreshedAuthTokens).toHaveBeenCalledTimes(1);
});
it("normal 401 recovery joins the proactive refresh flight", async () => {
    jest.mocked(axios.post).mockResolvedValue(response);
    const error = () => ({ response: { status: 401 }, config: { url: "/api/me", headers: { Authorization: "Bearer old-access" } } });
    await Promise.all([refreshCurrentAuthTokens(), recover401(error()), recover401(error())]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(apiClient).toHaveBeenCalledTimes(2);
});
it("debug native exchange joins the same guarded rotation commit, without axios fallback", async () => {
    jest.mocked(refreshAutomaticJourneyCredentials).mockResolvedValue(response.data);
    await expect(refreshCurrentAuthTokens()).resolves.toMatchObject({ kind: "refreshed" });
    expect(axios.post).not.toHaveBeenCalled();
    expect(saveRefreshedAuthTokens).toHaveBeenCalledTimes(1);
});
it("enabled native refresh rejection cannot leak refresh credentials to another client", async () => {
    jest.mocked(refreshAutomaticJourneyCredentials).mockRejectedValue(new Error("AUTOMATIC_SERVER_REJECTED"));
    await expect(refreshCurrentAuthTokens()).resolves.toMatchObject({ kind: "invalid" });
    expect(axios.post).not.toHaveBeenCalled();
});
it("invalid token fields cannot reach credential storage", async () => {
    jest.mocked(refreshAutomaticJourneyCredentials).mockResolvedValue({ success: true, data: { accessToken: 7, refreshToken: "fixture" } });
    await expect(refreshCurrentAuthTokens()).resolves.toEqual({ kind: "invalid" });
    expect(saveRefreshedAuthTokens).not.toHaveBeenCalled();
});
it("successful late reply after logout is ignored before credential storage", async () => {
    jest.mocked(axios.post).mockImplementation(async () => {
        jest.mocked(getAuthCredentialRevision).mockReturnValue(2);
        return response;
    });
    await expect(refreshCurrentAuthTokens()).resolves.toEqual({ kind: "superseded" });
    expect(saveRefreshedAuthTokens).not.toHaveBeenCalled();
});
it("old rejection cannot invalidate a newly selected account", async () => {
    jest.mocked(axios.post).mockImplementation(async () => {
        jest.mocked(getAuthCredentialRevision).mockReturnValue(2);
        throw { isAxiosError: true, response: { status: 401 } };
    });
    await expect(refreshCurrentAuthTokens()).resolves.toEqual({ kind: "superseded" });
});
it.each([429, 503])("transient %s retains credentials", async status => {
    jest.mocked(axios.post).mockRejectedValue({ isAxiosError: true, response: { status } });
    await expect(refreshCurrentAuthTokens()).resolves.toMatchObject({ kind: "unavailable" });
    expect(saveRefreshedAuthTokens).not.toHaveBeenCalled();
});
it("write-time revision mismatch fences a reply too", async () => {
    jest.mocked(axios.post).mockResolvedValue(response);
    jest.mocked(saveRefreshedAuthTokens).mockResolvedValue(false);
    await expect(refreshCurrentAuthTokens()).resolves.toEqual({ kind: "superseded" });
});
