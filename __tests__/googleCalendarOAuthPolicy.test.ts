import * as AuthSession from "expo-auth-session";
import { AuthRequest } from "expo-auth-session/build/AuthRequest";
import * as GoogleAuth from "expo-auth-session/providers/google";

import {
    createGoogleCalendarAuthRequestConfig,
    GOOGLE_CALENDAR_SCOPES,
} from "../src/modules/onboarding/googleCalendarImport";

jest.mock("../src/modules/storage/secureStorage", () => ({
    deleteItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));
jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));
jest.mock("expo-auth-session", () => ({
    Prompt: { SelectAccount: "select_account" },
    ResponseType: { Code: "code" },
}));
jest.mock("expo-auth-session/providers/google", () => ({
    discovery: {
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenEndpoint: "https://oauth2.googleapis.com/token",
    },
}));
jest.mock("expo-modules-core", () => ({
    CodedError: class CodedError extends Error {},
}));
jest.mock("expo-web-browser", () => ({
    openAuthSessionAsync: jest.fn(),
}));

describe("Google Calendar OAuth policy", () => {
    it("requests only the two endpoint-specific read-only scopes", async () => {
        const config = createGoogleCalendarAuthRequestConfig(
            "calendar-client-id",
            "nolate:/oauthredirect"
        );

        expect(GOOGLE_CALENDAR_SCOPES).toEqual([
            "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
            "https://www.googleapis.com/auth/calendar.events.readonly",
        ]);
        expect(config).toMatchObject({
            clientId: "calendar-client-id",
            redirectUri: "nolate:/oauthredirect",
            scopes: GOOGLE_CALENDAR_SCOPES,
            prompt: AuthSession.Prompt.SelectAccount,
            responseType: AuthSession.ResponseType.Code,
            usePKCE: true,
        });

        const request = new AuthRequest({
            ...config,
            state: "calendar-oauth-state",
        });
        request.codeVerifier = "v".repeat(64);
        request.codeChallenge = "calendar-oauth-code-challenge";

        const authorizationUrl = await request.makeAuthUrlAsync(GoogleAuth.discovery);
        const query = authorizationUrl.split("?", 2)[1] ?? "";
        const getQueryParameter = (name: string): string | null => {
            const prefix = `${name}=`;
            const entry = query.split("&").find((value) => value.startsWith(prefix));
            return entry
                ? decodeURIComponent(entry.slice(prefix.length).replace(/\+/g, " "))
                : null;
        };
        const requestedScopes = getQueryParameter("scope")?.split(" ") ?? [];

        expect(requestedScopes).toEqual(GOOGLE_CALENDAR_SCOPES);
        expect(requestedScopes).not.toContain("https://www.googleapis.com/auth/calendar.readonly");
        expect(requestedScopes).not.toContain("openid");
        expect(requestedScopes).not.toContain("https://www.googleapis.com/auth/userinfo.profile");
        expect(requestedScopes).not.toContain("https://www.googleapis.com/auth/userinfo.email");
        expect(getQueryParameter("response_type")).toBe("code");
        expect(getQueryParameter("prompt")).toBe("select_account");
        expect(getQueryParameter("code_challenge_method")).toBe("S256");
        expect(getQueryParameter("redirect_uri")).toBe("nolate:/oauthredirect");
    });
});
