/** The diagnostic screen may never replay alarms from a production account or real device. */
export function isIsolatedAlarmVerificationEnvironment(input: {
    development: boolean;
    platform: string;
    physicalDevice: boolean;
    apiBase: string;
    memberId: number | undefined;
    fixtureMarker: string | null;
}): boolean {
    return input.development && input.platform === "ios" && !input.physicalDevice &&
        input.apiBase === "http://127.0.0.1:5523" && input.memberId === 296 &&
        input.fixtureMarker === "h2-memory-only";
}
