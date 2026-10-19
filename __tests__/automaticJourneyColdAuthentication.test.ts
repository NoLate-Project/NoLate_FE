import { Buffer } from "buffer";
jest.mock("../src/api/api", () => ({ API_BASE_URL: "http://127.0.0.1:15544", refreshCurrentAuthTokens: jest.fn() }));
jest.mock("../src/modules/auth/authStorage", () => ({ getAccessToken: jest.fn(), getAuthMember: jest.fn(), getAuthCredentialRevision: jest.fn() }));
import { currentJourneyAuthentication } from "../src/modules/journey/automaticJourneyAuthentication";
import { refreshCurrentAuthTokens } from "../src/api/api";
import { getAccessToken, getAuthMember, getAuthCredentialRevision } from "../src/modules/auth/authStorage";
const token = (exp: number, sg = 2) => `e30.${Buffer.from(JSON.stringify({ type: "ACCESS", sub: "7", sg, iat: 900, exp })).toString("base64url")}.c2ln`;
beforeEach(() => {
    jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(1000000);
    jest.mocked(getAuthCredentialRevision).mockReturnValue(1);
    jest.mocked(getAuthMember).mockResolvedValue({ id: 7 });
    jest.mocked(getAccessToken).mockResolvedValue(token(999));
});
afterEach(() => jest.useRealTimers());
it('long preparation joins shared refresh even when current access has ten minutes left', async () => {
    jest.mocked(getAccessToken).mockResolvedValue(token(1600));
    jest.mocked(refreshCurrentAuthTokens).mockImplementation(async () => {
        jest.mocked(getAccessToken).mockResolvedValue(token(9000));
        return { kind: 'refreshed', tokens: { accessToken: token(9000), refreshToken: 'synthetic-refresh' } };
    });
    await expect(currentJourneyAuthentication(8200)).resolves.toMatchObject({ expiresAtEpochSeconds: 9000 });
    expect(refreshCurrentAuthTokens).toHaveBeenCalledTimes(1);
});
it('does not refresh an already-covered long preparation', async () => {
    jest.mocked(getAccessToken).mockResolvedValue(token(8230));
    await expect(currentJourneyAuthentication(8200)).resolves.toMatchObject({ expiresAtEpochSeconds: 8230 });
    expect(refreshCurrentAuthTokens).not.toHaveBeenCalled();
});
it('a shared refresh cannot grant more lifetime than the actual renewed JWT', async () => {
    jest.mocked(refreshCurrentAuthTokens).mockImplementation(async () => {
        jest.mocked(getAccessToken).mockResolvedValue(token(1600));
        return { kind: 'refreshed', tokens: { accessToken: token(1600), refreshToken: 'synthetic-refresh' } };
    });
    await expect(currentJourneyAuthentication(8200)).rejects.toThrow('AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT');
});
it("cold expired access joins existing refresh then returns only fresh same-identity credentials", async () => {
    jest.mocked(refreshCurrentAuthTokens).mockImplementation(async () => {
        jest.mocked(getAccessToken).mockResolvedValue(token(1600));
        return { kind: "refreshed", tokens: { accessToken: token(1600), refreshToken: "synthetic-refresh" } };
    });
    await expect(currentJourneyAuthentication()).resolves.toMatchObject({ expiresAtEpochSeconds: 1600, loginGeneration: 2 });
    expect(refreshCurrentAuthTokens).toHaveBeenCalledTimes(1);
});
it("logout while recovering blocks successful late refresh", async () => {
    jest.mocked(refreshCurrentAuthTokens).mockImplementation(async () => {
        jest.mocked(getAuthCredentialRevision).mockReturnValue(2);
        return { kind: "refreshed", tokens: { accessToken: token(1600), refreshToken: "synthetic-refresh" } };
    });
    await expect(currentJourneyAuthentication()).rejects.toThrow("AUTOMATIC_AUTH_CHANGED");
});
it("an exchange claiming success without a fresh stored token cannot reach native", async () => {
    jest.mocked(refreshCurrentAuthTokens).mockResolvedValue({ kind: "refreshed", tokens: { accessToken: token(1600), refreshToken: "synthetic-refresh" } });
    await expect(currentJourneyAuthentication()).rejects.toThrow("AUTOMATIC_AUTH_REQUIRED");
});
it("a newer login generation cannot inherit an old checkpoint", async () => {
    jest.mocked(refreshCurrentAuthTokens).mockImplementation(async () => {
        jest.mocked(getAccessToken).mockResolvedValue(token(1600, 3));
        return { kind: "refreshed", tokens: { accessToken: token(1600, 3), refreshToken: "synthetic-refresh" } };
    });
    await expect(currentJourneyAuthentication()).rejects.toThrow("AUTOMATIC_AUTH_CHANGED");
});
it.each(["invalid", "unavailable", "superseded"] as const)("cold %s recovery keeps fail-closed boundary", async kind => {
    jest.mocked(refreshCurrentAuthTokens).mockResolvedValue(kind === "unavailable" ? { kind, cause: new Error("synthetic outage") } : { kind });
    await expect(currentJourneyAuthentication()).rejects.toThrow();
});
