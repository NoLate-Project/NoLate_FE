import React from "react";
import { AppState, Linking } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import NotificationSettingsCard from "../src/modules/schedule/components/form/NotificationSettingsCard";

const mockGetCapabilities = jest.fn();
const mockOpenExactAlarmSettings = jest.fn();
const mockOpenFullScreenAlarmSettings = jest.fn();
const mockScheduleTestAlarm = jest.fn();

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

jest.mock("../src/modules/notification/departureAlarm", () => ({
    getDepartureAlarmCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
    openExactAlarmSettings: (...args: unknown[]) => mockOpenExactAlarmSettings(...args),
    openFullScreenAlarmSettings: (...args: unknown[]) => mockOpenFullScreenAlarmSettings(...args),
    scheduleDepartureTestAlarm: (...args: unknown[]) => mockScheduleTestAlarm(...args),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            border: "#DDDDDD",
            inputBorder: "#CCCCCC",
            inputBackground: "#FFFFFF",
            textPrimary: "#111111",
            textSecondary: "#666666",
        },
    }),
}));

const policy = {
    plan: "FREE" as const,
    maxSmartSchedulesPerMonth: 5,
    usedSmartSchedulesThisMonth: 0,
    maxNotificationLeadMinutes: 60,
    minNotificationIntervalMinutes: 30,
    minEtaRefreshIntervalMinutes: 20,
};

describe("NotificationSettingsCard alarm mode", () => {
    let renderer: ReactTestRenderer | undefined;
    let appStateHandler: ((state: string) => void) | undefined;
    let appStateSpy: jest.SpyInstance;
    let linkingSpy: jest.SpyInstance;
    const onAlertModeChange = jest.fn();

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        appStateHandler = undefined;
        onAlertModeChange.mockReset();
        mockGetCapabilities.mockReset();
        mockOpenExactAlarmSettings.mockReset();
        mockOpenFullScreenAlarmSettings.mockReset();
        mockScheduleTestAlarm.mockReset();
        mockOpenExactAlarmSettings.mockResolvedValue(true);
        mockOpenFullScreenAlarmSettings.mockResolvedValue(true);
        mockScheduleTestAlarm.mockResolvedValue({ applied: true, scheduled: true });
        appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(
            (_event, handler) => {
                appStateHandler = handler as (state: string) => void;
                return { remove: jest.fn() };
            },
        );
        linkingSpy = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        appStateSpy.mockRestore();
        linkingSpy.mockRestore();
    });

    async function renderCard(alertMode: "STANDARD" | "ALARM") {
        await act(async () => {
            renderer = TestRenderer.create(
                <NotificationSettingsCard
                    routeReady
                    enabled
                    alertMode={alertMode}
                    leadMinutes={60}
                    intervalMinutes={20}
                    startAt={new Date("2026-07-29T03:00:00Z")}
                    policy={policy}
                    onEnabledChange={jest.fn()}
                    onAlertModeChange={onAlertModeChange}
                    onLeadMinutesChange={jest.fn()}
                    onIntervalMinutesChange={jest.fn()}
                />,
            );
            await Promise.resolve();
        });
    }

    test("일반 알림과 강력한 알람 선택을 상위 폼에 전달한다", async () => {
        await renderCard("STANDARD");

        expect(mockGetCapabilities).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "출발 알림 방식",
        }).props.accessibilityRole).toBe("radiogroup");
        expect(renderer!.root.findByProps({
            accessibilityLabel: "일반 알림 모드",
        }).props).toMatchObject({
            accessibilityRole: "radio",
            accessibilityState: { checked: true },
        });
        expect(renderer!.root.findByProps({
            accessibilityLabel: "강력한 알람 모드",
        }).props).toMatchObject({
            accessibilityRole: "radio",
            accessibilityState: { checked: false },
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "강력한 알람 모드" }).props.onPress();
            renderer!.root.findByProps({ accessibilityLabel: "일반 알림 모드" }).props.onPress();
        });

        expect(onAlertModeChange.mock.calls).toEqual([["ALARM"], ["STANDARD"]]);
    });

    test("Android 권한 설정 복귀 시 상태를 갱신하고 10초 테스트 결과를 안내한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "android",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: true,
            reason: "EXACT_ALARM_PERMISSION_REQUIRED",
        });
        await renderCard("ALARM");

        expect(mockGetCapabilities).toHaveBeenCalledTimes(1);
        expect(
            renderer!.root.findAllByProps({ children: "설정 필요" }).length,
        ).toBeGreaterThanOrEqual(2);

        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "정확한 알람 설정 열기" })
                .props.onPress();
        });
        expect(mockOpenExactAlarmSettings).toHaveBeenCalledTimes(1);

        await act(async () => {
            appStateHandler?.("active");
            await Promise.resolve();
        });
        expect(mockGetCapabilities).toHaveBeenCalledTimes(2);

        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "10초 뒤 테스트 알람" })
                .props.onPress();
        });
        expect(mockScheduleTestAlarm).toHaveBeenCalledWith(10);
        expect(
            renderer!.root.findByProps({
                children: "테스트 알람을 예약했어요. 10초 뒤 벨소리를 확인해 주세요.",
            }),
        ).toBeTruthy();
    });

    test("네이티브 모듈이 없는 빌드는 일반 푸시 fallback을 명확히 표시한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: false,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "이 기기에서는 일반 알림으로 동작해요",
        })).toBeTruthy();
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "10초 뒤 테스트 알람" })
                .props.disabled,
        ).toBe(true);
    });

    test("알림 권한이 없으면 운영체제 앱 알림 설정으로 이동할 수 있다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "android",
            exactAlarmAuthorized: true,
            fullScreenAuthorized: true,
            notificationAuthorized: false,
            reason: "NOTIFICATION_PERMISSION_REQUIRED",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "Android 알림 권한이 필요해요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            children: "알림 권한이 꺼져 있어 알람과 일반 푸시가 표시되지 않을 수 있어요. 앱 알림 설정을 켜 주세요.",
        })).toBeTruthy();
        expect(renderer!.root.findAllByProps({
            children: "설정 전에도 일반 푸시 알림은 계속 도착하며, 권한을 켜면 더 강하게 알려드려요.",
        })).toHaveLength(0);
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "앱 알림 설정 열기" })
                .props.onPress();
        });

        expect(linkingSpy).toHaveBeenCalledTimes(1);
    });

    test("iOS AlarmKit 권한은 일반 알림 권한과 별개로 준비 완료를 표시한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: true,
            fullScreenAuthorized: true,
            notificationAuthorized: false,
            deliveryMode: "alarmKit",
            alarmKitAuthorization: "authorized",
            notificationAuthorization: "denied",
            timeSensitiveAuthorization: "disabled",
            soundAuthorization: "disabled",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "강력한 알람 준비 완료",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            children: "iOS 시스템 알람 권한이 준비됐어요. 일반 알림 권한과 별개로 알람이 동작해요.",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "iOS 시스템 알람 권한: 준비됨",
        })).toBeTruthy();
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "일반 푸시 알림: 설정 필요",
        })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "앱 알림 설정 열기",
        })).toHaveLength(0);
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "10초 뒤 테스트 알람" })
                .props.disabled,
        ).toBe(false);
    });

    test("AlarmKit 거부지만 일반 알림 권한이 있으면 푸시 fallback을 구분해 표시한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: true,
            deliveryMode: "alarmKit",
            alarmKitAuthorization: "denied",
            notificationAuthorization: "authorized",
            timeSensitiveAuthorization: "enabled",
            soundAuthorization: "enabled",
            reason: "ALARM_AUTHORIZATION_DENIED",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "시스템 알람 권한을 켜기 전에는 허용된 일반 푸시 알림으로 대신 알려드려요.",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "iOS 시스템 알람 권한: 설정 필요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "일반 푸시 알림: 준비됨",
        })).toBeTruthy();
    });

    test("AlarmKit과 일반 알림 권한이 모두 꺼지면 푸시 fallback을 보장하지 않는다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: false,
            deliveryMode: "alarmKit",
            alarmKitAuthorization: "denied",
            notificationAuthorization: "denied",
            timeSensitiveAuthorization: "disabled",
            soundAuthorization: "disabled",
            reason: "ALARM_AUTHORIZATION_DENIED",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "iOS 알람 권한이 모두 꺼져 있어요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            children: "시스템 알람과 일반 알림 권한이 모두 꺼져 있어 출발 알림이 표시되지 않을 수 있어요.",
        })).toBeTruthy();
        expect(renderer!.root.findAllByProps({
            children: "시스템 알람 권한을 켜기 전에는 허용된 일반 푸시 알림으로 대신 알려드려요.",
        })).toHaveLength(0);
        expect(renderer!.root.findByProps({
            accessibilityLabel: "iOS 시스템 알람 권한: 설정 필요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "일반 푸시 알림: 설정 필요",
        })).toBeTruthy();
    });

    test("늦게 끝난 이전 capability 응답은 최신 권한 상태를 덮어쓰지 않는다", async () => {
        const stale = deferred<{
            supported: boolean;
            platform: "android";
            exactAlarmAuthorized: boolean;
            fullScreenAuthorized: boolean;
            notificationAuthorized: boolean;
        }>();
        mockGetCapabilities
            .mockReturnValueOnce(stale.promise)
            .mockResolvedValueOnce({
                supported: true,
                platform: "android",
                exactAlarmAuthorized: true,
                fullScreenAuthorized: true,
                notificationAuthorized: true,
            });
        await renderCard("ALARM");

        await act(async () => {
            appStateHandler?.("active");
            await Promise.resolve();
        });
        expect(renderer!.root.findByProps({
            children: "강력한 알람 준비 완료",
        })).toBeTruthy();

        await act(async () => {
            stale.resolve({
                supported: false,
                platform: "android",
                exactAlarmAuthorized: false,
                fullScreenAuthorized: false,
                notificationAuthorized: false,
            });
            await stale.promise;
        });
        expect(renderer!.root.findByProps({
            children: "강력한 알람 준비 완료",
        })).toBeTruthy();
    });

    test("테스트 알람 실패 이유를 live region으로 안내한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "android",
            exactAlarmAuthorized: true,
            fullScreenAuthorized: true,
            notificationAuthorized: false,
            reason: "NOTIFICATION_PERMISSION_REQUIRED",
        });
        mockScheduleTestAlarm.mockResolvedValue({
            applied: true,
            scheduled: false,
            reason: "NOTIFICATION_PERMISSION_REQUIRED",
        });
        await renderCard("ALARM");

        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "10초 뒤 테스트 알람" })
                .props.onPress();
        });

        expect(
            renderer!.root.findByProps({ accessibilityLiveRegion: "polite" }).props.children,
        ).toBe("알림 권한이 꺼져 있어 테스트 알람을 예약하지 못했어요.");
    });

    test("iOS 시스템 알람 권한 미결정을 사운드 fallback으로 오표시하지 않는다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: true,
            reason: "ALARM_AUTHORIZATION_NOT_DETERMINED",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "시스템 알람 권한을 확인해 주세요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            children: "10초 테스트 알람을 실행하면 iOS 시스템 알람 권한을 요청해요.",
        })).toBeTruthy();
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "10초 뒤 테스트 알람" })
                .props.disabled,
        ).toBe(false);
        expect(renderer!.root.findAllByProps({
            children: "iOS 사운드 알림으로 동작해요",
        })).toHaveLength(0);
        expect(renderer!.root.findByProps({
            accessibilityLabel: "iOS 시스템 알람 권한: 설정 필요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "일반 푸시 알림: 준비됨",
        })).toBeTruthy();
    });

    test.each([
        [
            "TIME_SENSITIVE_DISABLED",
            "iOS 시간 지정 알림이 꺼져 있어요",
            "시간 지정 알림: 설정 필요",
            "알림 사운드: 설정 필요",
        ],
        [
            "SOUND_DISABLED",
            "iOS 알림 사운드가 꺼져 있어요",
            "시간 지정 알림: 준비됨",
            "알림 사운드: 설정 필요",
        ],
    ])(
        "optional 세부 필드가 없는 iOS %s 상태도 보수적으로 안내한다",
        async (reason, title, timeStatus, soundStatus) => {
            mockGetCapabilities.mockResolvedValue({
                supported: true,
                platform: "ios",
                exactAlarmAuthorized: false,
                fullScreenAuthorized: false,
                notificationAuthorized: true,
                reason,
            });
            await renderCard("ALARM");

            expect(renderer!.root.findByProps({ children: title })).toBeTruthy();
            expect(renderer!.root.findByProps({
                accessibilityLabel: "앱 알림 설정 열기",
            })).toBeTruthy();
            expect(renderer!.root.findByProps({
                accessibilityLabel: "알림 표시: 준비됨",
            })).toBeTruthy();
            expect(renderer!.root.findByProps({
                accessibilityLabel: timeStatus,
            })).toBeTruthy();
            expect(renderer!.root.findByProps({
                accessibilityLabel: soundStatus,
            })).toBeTruthy();
        },
    );

    test("iOS fallback의 알림 표시 비활성은 다른 세부 권한과 분리해 표시한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: false,
            deliveryMode: "timeSensitive",
            alarmKitAuthorization: "notSupported",
            notificationAuthorization: "authorized",
            timeSensitiveAuthorization: "enabled",
            soundAuthorization: "enabled",
            reason: "NOTIFICATION_ALERTS_DISABLED",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "iOS 앱 알림 표시가 꺼져 있어요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "알림 표시: 설정 필요",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "시간 지정 알림: 준비됨",
        })).toBeTruthy();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "알림 사운드: 준비됨",
        })).toBeTruthy();
    });

    test("iOS time-sensitive fallback 준비 상태는 세 권한을 모두 준비됨으로 표시한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: true,
            deliveryMode: "timeSensitive",
            alarmKitAuthorization: "notSupported",
            notificationAuthorization: "authorized",
            timeSensitiveAuthorization: "enabled",
            soundAuthorization: "enabled",
            reason: "TIME_SENSITIVE_FALLBACK",
        });
        await renderCard("ALARM");

        expect(renderer!.root.findByProps({
            children: "iOS 사운드 알림으로 동작해요",
        })).toBeTruthy();
        [
            "알림 표시: 준비됨",
            "시간 지정 알림: 준비됨",
            "알림 사운드: 준비됨",
        ].forEach((accessibilityLabel) => {
            expect(renderer!.root.findByProps({ accessibilityLabel })).toBeTruthy();
        });
    });
});
