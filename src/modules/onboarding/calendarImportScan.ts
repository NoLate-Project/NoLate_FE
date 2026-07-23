import type {
    DeviceCalendarImportSummary,
    DeviceCalendarProvider,
} from "./deviceCalendarImport";

export type CalendarScanProviderId = "device" | "google";

export type CalendarScanProgress =
    | "device-permission"
    | "device-events"
    | "google-auth"
    | "google-events";

export type CalendarProviderScanResult = {
    provider: DeviceCalendarProvider;
    providerLabel: string;
    summary: DeviceCalendarImportSummary;
};

export type CalendarProviderScanFailure = {
    providerId: CalendarScanProviderId;
    providerLabel: string;
    message: string;
};

type CalendarProviderScanDependencies = {
    selectedProviderIds: ReadonlySet<CalendarScanProviderId>;
    deviceProvider: DeviceCalendarProvider;
    deviceProviderLabel: string;
    requestDevicePermission: () => Promise<boolean>;
    loadDeviceSummary: () => Promise<DeviceCalendarImportSummary>;
    requestGoogleAccessToken: () => Promise<string | null>;
    loadGoogleSummary: (accessToken: string) => Promise<DeviceCalendarImportSummary>;
    onProgress?: (progress: CalendarScanProgress) => void;
    shouldContinue?: () => boolean;
};

export type CalendarProviderScanOutcome = {
    scans: CalendarProviderScanResult[];
    failures: CalendarProviderScanFailure[];
    cancelled: boolean;
};

/**
 * 공급자 스캔을 서로 격리한다. 한 공급자의 권한·인증·조회가 실패해도 다른 공급자의
 * 결과는 버리지 않으며, 화면을 벗어난 경우 다음 공급자 작업을 시작하지 않는다.
 */
export async function scanSelectedCalendarProviders(
    dependencies: CalendarProviderScanDependencies
): Promise<CalendarProviderScanOutcome> {
    const scans: CalendarProviderScanResult[] = [];
    const failures: CalendarProviderScanFailure[] = [];
    const shouldContinue = dependencies.shouldContinue ?? (() => true);

    if (dependencies.selectedProviderIds.has("device")) {
        dependencies.onProgress?.("device-permission");

        try {
            const granted = await dependencies.requestDevicePermission();
            if (!shouldContinue()) return { scans, failures, cancelled: true };

            if (!granted) {
                failures.push({
                    providerId: "device",
                    providerLabel: dependencies.deviceProviderLabel,
                    message: "캘린더 접근 권한이 꺼져 있어요.",
                });
            } else {
                dependencies.onProgress?.("device-events");
                const summary = await dependencies.loadDeviceSummary();
                if (!shouldContinue()) return { scans, failures, cancelled: true };

                scans.push({
                    provider: dependencies.deviceProvider,
                    providerLabel: dependencies.deviceProviderLabel,
                    summary,
                });
            }
        } catch (error) {
            failures.push({
                providerId: "device",
                providerLabel: dependencies.deviceProviderLabel,
                message: getErrorMessage(error, "일정을 확인하지 못했어요."),
            });
        }
    }

    if (!shouldContinue()) return { scans, failures, cancelled: true };

    if (dependencies.selectedProviderIds.has("google")) {
        dependencies.onProgress?.("google-auth");

        try {
            const accessToken = await dependencies.requestGoogleAccessToken();
            if (!shouldContinue()) return { scans, failures, cancelled: true };

            if (!accessToken) {
                failures.push({
                    providerId: "google",
                    providerLabel: "Google Calendar",
                    message: "Google 계정 연결이 취소됐어요.",
                });
            } else {
                dependencies.onProgress?.("google-events");
                const summary = await dependencies.loadGoogleSummary(accessToken);
                if (!shouldContinue()) return { scans, failures, cancelled: true };

                scans.push({
                    provider: "GOOGLE",
                    providerLabel: "Google Calendar",
                    summary,
                });
            }
        } catch (error) {
            failures.push({
                providerId: "google",
                providerLabel: "Google Calendar",
                message: getErrorMessage(error, "일정을 확인하지 못했어요."),
            });
        }
    }

    return { scans, failures, cancelled: !shouldContinue() };
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}
