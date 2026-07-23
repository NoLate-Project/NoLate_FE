import {
    CalendarImportTimeoutError,
    withCalendarImportTimeout,
} from "../src/modules/onboarding/calendarImportReliability";
import { scanSelectedCalendarProviders } from "../src/modules/onboarding/calendarImportScan";
import type { DeviceCalendarImportSummary } from "../src/modules/onboarding/deviceCalendarImport";

const EMPTY_SUMMARY: DeviceCalendarImportSummary = {
    calendarCount: 1,
    calendarSources: [{ id: "calendar-1", title: "개인" }],
    candidates: [],
};

describe("calendar import reliability", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test("응답한 작업은 제한 시간 전에 그대로 반환한다", async () => {
        await expect(
            withCalendarImportTimeout(Promise.resolve("ready"), {
                timeoutMs: 1_000,
                operationName: "일정 확인",
            })
        ).resolves.toBe("ready");
    });

    test("응답하지 않는 작업을 시간 초과로 종료하고 정리 함수를 실행한다", async () => {
        jest.useFakeTimers();
        const onTimeout = jest.fn();
        const operation = withCalendarImportTimeout(
            new Promise<string>(() => {}),
            {
                timeoutMs: 1_000,
                operationName: "다가오는 일정 확인",
                onTimeout,
            }
        );
        const rejection = operation.catch((error: unknown) => error);

        jest.advanceTimersByTime(1_000);

        await expect(rejection).resolves.toEqual(
            expect.objectContaining({
                name: "CalendarImportTimeoutError",
                operation: "다가오는 일정 확인",
            })
        );
        expect(onTimeout).toHaveBeenCalledTimes(1);
        expect(new CalendarImportTimeoutError("테스트").message).toContain("다시 시도");
    });

    test("Google 조회가 실패해도 성공한 기기 캘린더 결과를 보존한다", async () => {
        const outcome = await scanSelectedCalendarProviders({
            selectedProviderIds: new Set(["device", "google"]),
            deviceProvider: "APPLE_DEVICE",
            deviceProviderLabel: "Apple 캘린더",
            requestDevicePermission: async () => true,
            loadDeviceSummary: async () => EMPTY_SUMMARY,
            requestGoogleAccessToken: async () => "token",
            loadGoogleSummary: async () => {
                throw new Error("Google 요청 실패");
            },
        });

        expect(outcome.cancelled).toBe(false);
        expect(outcome.scans).toEqual([
            expect.objectContaining({
                provider: "APPLE_DEVICE",
                providerLabel: "Apple 캘린더",
                summary: EMPTY_SUMMARY,
            }),
        ]);
        expect(outcome.failures).toEqual([
            expect.objectContaining({
                providerId: "google",
                message: "Google 요청 실패",
            }),
        ]);
    });

    test("화면을 벗어나면 다음 공급자 스캔을 시작하지 않는다", async () => {
        let active = true;
        const loadDeviceSummary = jest.fn(async () => EMPTY_SUMMARY);
        const requestGoogleAccessToken = jest.fn(async () => "token");

        const outcome = await scanSelectedCalendarProviders({
            selectedProviderIds: new Set(["device", "google"]),
            deviceProvider: "APPLE_DEVICE",
            deviceProviderLabel: "Apple 캘린더",
            requestDevicePermission: async () => {
                active = false;
                return true;
            },
            loadDeviceSummary,
            requestGoogleAccessToken,
            loadGoogleSummary: async () => EMPTY_SUMMARY,
            shouldContinue: () => active,
        });

        expect(outcome.cancelled).toBe(true);
        expect(loadDeviceSummary).not.toHaveBeenCalled();
        expect(requestGoogleAccessToken).not.toHaveBeenCalled();
    });
});
