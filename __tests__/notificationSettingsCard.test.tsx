import React from "react";
import { AppState, Linking, Modal, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import NotificationSettingsCard from "../src/modules/schedule/components/form/NotificationSettingsCard";
import type { DepartureAlarmCapabilities } from "../src/modules/notification/departureAlarm";

const mockGetCapabilities = jest.fn();
const mockOpenExactAlarmSettings = jest.fn();
const mockOpenFullScreenAlarmSettings = jest.fn();
const mockRequestPushNotificationPermission = jest.fn();
const mockStartAlarmAudio = jest.fn();
const mockStopAlarmAudio = jest.fn();
const mockGetNativeAlarmSound = jest.fn();
const mockSetNativeAlarmSound = jest.fn();
const mockGetLocalAlarmSound = jest.fn();
const mockSetLocalAlarmSound = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    getDepartureAlarmCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
    getNativeNoLateAlarmSoundPreference: (...args: unknown[]) => mockGetNativeAlarmSound(...args),
    openExactAlarmSettings: (...args: unknown[]) => mockOpenExactAlarmSettings(...args),
    openFullScreenAlarmSettings: (...args: unknown[]) => mockOpenFullScreenAlarmSettings(...args),
    setNativeNoLateAlarmSoundPreference: (...args: unknown[]) => mockSetNativeAlarmSound(...args),
}));
jest.mock("../src/modules/notification/customAlarmAudio", () => ({
    startNoLateCustomAlarmAudio: (...args: unknown[]) => mockStartAlarmAudio(...args),
}));
jest.mock("../src/modules/notification/customAlarmSounds", () => {
    const sounds = [
        { id: "CHIME", label: "차임" },
        { id: "BELL", label: "벨" },
        { id: "BEEP", label: "비프" },
    ];
    return {
        NOLATE_ALARM_SOUNDS: sounds,
        DEFAULT_NOLATE_ALARM_SOUND_ID: "CHIME",
        getNoLateAlarmSound: (soundId: string) => sounds.find(sound => sound.id === soundId) ?? sounds[0],
        getNoLateAlarmSoundPreference: (...args: unknown[]) => mockGetLocalAlarmSound(...args),
        setNoLateAlarmSoundPreference: (...args: unknown[]) => mockSetLocalAlarmSound(...args),
    };
});
jest.mock("../src/modules/notification/pushPermission", () => ({
    requestPushNotificationPermission: (...args: unknown[]) => mockRequestPushNotificationPermission(...args),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            background: "#FFFFFF",
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

const iosReady: DepartureAlarmCapabilities = {
    supported: true,
    platform: "ios" as const,
    exactAlarmAuthorized: false,
    fullScreenAuthorized: false,
    notificationAuthorized: true,
    deliveryMode: "timeSensitive" as const,
    alarmKitAuthorization: "notSupported" as const,
    notificationAuthorization: "authorized" as const,
    timeSensitiveAuthorization: "enabled" as const,
    soundAuthorization: "enabled" as const,
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

describe("NotificationSettingsCard NoLate custom alarm", () => {
    let renderer: ReactTestRenderer | undefined;
    let appStateHandler: ((state: string) => void) | undefined;
    let appStateSpy: jest.SpyInstance;
    let linkingSpy: jest.SpyInstance;
    const onAlertModeChange = jest.fn();

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        appStateHandler = undefined;
        onAlertModeChange.mockReset();
        mockGetCapabilities.mockReset().mockResolvedValue(iosReady);
        mockOpenExactAlarmSettings.mockReset().mockResolvedValue(true);
        mockOpenFullScreenAlarmSettings.mockReset().mockResolvedValue(true);
        mockStopAlarmAudio.mockReset().mockResolvedValue(undefined);
        mockStartAlarmAudio.mockReset().mockResolvedValue({
            setMuted: jest.fn().mockResolvedValue(undefined),
            stop: mockStopAlarmAudio,
        });
        mockGetNativeAlarmSound.mockReset().mockResolvedValue("CHIME");
        mockSetNativeAlarmSound.mockReset().mockResolvedValue(true);
        mockGetLocalAlarmSound.mockReset().mockResolvedValue("CHIME");
        mockSetLocalAlarmSound.mockReset().mockResolvedValue(undefined);
        mockRequestPushNotificationPermission.mockReset().mockResolvedValue(true);
        appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, handler) => {
            appStateHandler = handler as (state: string) => void;
            return { remove: jest.fn() };
        });
        linkingSpy = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        appStateSpy.mockRestore();
        linkingSpy.mockRestore();
    });

    async function renderCard(alertMode: "STANDARD" | "ALARM", variant: "card" | "flat" = "card") {
        await act(async () => {
            renderer = TestRenderer.create(
                <NotificationSettingsCard
                    variant={variant}
                    routeReady
                    enabled
                    alertMode={alertMode}
                    scheduleId="42"
                    leadMinutes={60}
                    intervalMinutes={20}
                    routeInfo={{
                        id: "route-42",
                        originName: "서울역",
                        destinationName: "강남역",
                        totalDurationMinutes: 36,
                        departureTime: "2026-07-29T02:24:00Z",
                        arrivalTime: "2026-07-29T03:00:00Z",
                        timeBasis: "estimated",
                        steps: [],
                    }}
                    startAt={new Date("2026-07-29T03:00:00Z")}
                    policy={policy}
                    onEnabledChange={jest.fn()}
                    onAlertModeChange={onAlertModeChange}
                    onLeadMinutesChange={jest.fn()}
                    onIntervalMinutesChange={jest.fn()}
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    test("푸시 알림과 출발 알람을 한 목록에서 바로 비교하고 선택한다", async () => {
        await renderCard("STANDARD", "flat");

        expect(mockGetCapabilities).not.toHaveBeenCalled();
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "출발 알림 방식",
            }).props.accessibilityRole,
        ).toBe("radiogroup");
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "푸시 알림 선택",
            }).props.accessibilityState,
        ).toEqual({ checked: true });
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "출발 알람 선택",
            }).props.accessibilityState,
        ).toEqual({ checked: false });
        expect(
            renderer!.root.findAllByProps({
                testID: "notification-alert-mode-disclosure",
            }),
        ).toHaveLength(0);

        await act(async () => {
            renderer!.root
                .findByProps({
                    accessibilityLabel: "출발 알람 선택",
                })
                .props.onPress();
            renderer!.root
                .findByProps({
                    accessibilityLabel: "푸시 알림 선택",
                })
                .props.onPress();
        });

        expect(onAlertModeChange.mock.calls).toEqual([["ALARM"], ["STANDARD"]]);
    });

    test("flat UI는 추천 출발 요약과 알림 방식을 한 카드에 모으고 내부 권한 표는 숨긴다", async () => {
        await renderCard("ALARM", "flat");

        expect(
            StyleSheet.flatten(renderer!.root.findByProps({ testID: "notification-settings-flat" }).props.style),
        ).toMatchObject({
            borderWidth: 0,
            borderRadius: 0,
            padding: 0,
            backgroundColor: "transparent",
        });
        expect(
            StyleSheet.flatten(renderer!.root.findByProps({ testID: "notification-settings-toggle-row" }).props.style),
        ).toMatchObject({
            borderBottomWidth: 0,
            paddingHorizontal: 0,
        });
        expect(renderer!.root.findByProps({ testID: "notification-flat-summary" })).toBeTruthy();
        const rendered = JSON.stringify(renderer!.toJSON());
        expect(rendered).toContain("교통 상황 반영");
        expect(rendered).toContain("추천 출발 시간");
        expect(rendered).toContain("36분 소요");
        expect(rendered).toContain("오후 12:00 도착 예정");
        expect(rendered).toContain("알림음");
        expect(rendered).not.toContain("권장값 적용");
        expect(rendered).toContain("차임");
        expect(rendered).not.toContain("NoLate가 직접 만든 알람 화면");
        expect(rendered).not.toContain("지원 기기");
        expect(rendered).not.toContain("AlarmKit");
        expect(rendered).not.toContain("NoLate 벨소리 알람 권한");
        expect(rendered).not.toContain("설정 필요");
    });

    test("여러 알람음 중 하나를 선택하고 즉시 미리 듣는다", async () => {
        await renderCard("ALARM", "flat");

        const soundRow = renderer!.root.findByProps({
            accessibilityLabel: "알림음, 현재 차임",
        });
        expect(soundRow.props.disabled).toBe(false);

        await act(async () => {
            soundRow.props.onPress();
            await Promise.resolve();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "알람음 목록" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "차임 알람음" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "비프 알람음" })).toBeTruthy();
        expect(renderer!.root.findByProps({ children: "모든 출발 알람에 적용" })).toBeTruthy();
        expect(
            StyleSheet.flatten(renderer!.root.findByProps({ testID: "alarm-sound-picker-sheet" }).props.style),
        ).toMatchObject({ backgroundColor: "#FFFFFF" });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockSetNativeAlarmSound).toHaveBeenCalledWith("BELL");
        expect(mockSetLocalAlarmSound).toHaveBeenCalledWith("BELL");
        expect(mockStartAlarmAudio).toHaveBeenCalledWith("BELL");
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" }).props.accessibilityState,
        ).toEqual({ checked: true, disabled: false });
        expect(renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" }).props.accessibilityHint).toBe(
            "미리 듣기를 중지합니다",
        );

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockStopAlarmAudio).toHaveBeenCalledTimes(1);
        expect(mockSetNativeAlarmSound).toHaveBeenCalledTimes(1);
        expect(mockSetLocalAlarmSound).toHaveBeenCalledTimes(1);
    });

    test("선택 시트가 닫힌 동안 늦게 저장된 알람음을 재생하지 않는다", async () => {
        const nativeSave = deferred<boolean>();
        mockSetNativeAlarmSound.mockReturnValueOnce(nativeSave.promise);
        await renderCard("ALARM", "flat");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 차임" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockSetNativeAlarmSound).toHaveBeenCalledWith("BELL");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알람음 선택 완료" }).props.onPress();
            await Promise.resolve();
        });
        expect(renderer!.root.findByType(Modal).props.visible).toBe(false);

        await act(async () => {
            nativeSave.resolve(true);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockSetLocalAlarmSound).toHaveBeenCalledWith("BELL");
        expect(mockStartAlarmAudio).not.toHaveBeenCalled();
        expect(
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 벨" }).props.disabled,
        ).toBe(false);
    });

    test("앱이 백그라운드로 간 동안 저장이 끝나도 미리 듣기를 시작하지 않는다", async () => {
        const nativeSave = deferred<boolean>();
        mockSetNativeAlarmSound.mockReturnValueOnce(nativeSave.promise);
        await renderCard("ALARM", "flat");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 차임" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "비프 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            appStateHandler?.("background");
            await Promise.resolve();
        });
        await act(async () => {
            nativeSave.resolve(true);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockSetLocalAlarmSound).toHaveBeenCalledWith("BEEP");
        expect(mockStartAlarmAudio).not.toHaveBeenCalled();
    });

    test("네이티브 저장 실패 시 기존 알람음으로 되돌리고 재생하지 않는다", async () => {
        mockSetNativeAlarmSound.mockResolvedValueOnce(false);
        await renderCard("ALARM", "flat");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 차임" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "벨 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockSetLocalAlarmSound).not.toHaveBeenCalled();
        expect(mockStartAlarmAudio).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "차임 알람음" }).props.accessibilityState).toEqual({
            checked: true,
            disabled: false,
        });
        expect(renderer!.root.findByProps({ children: "알람음을 바꾸지 못했어요." })).toBeTruthy();
    });

    test("로컬 캐시 저장 실패는 네이티브에서 바뀐 알람음과 미리 듣기를 되돌리지 않는다", async () => {
        mockSetLocalAlarmSound.mockRejectedValueOnce(new Error("storage unavailable"));
        await renderCard("ALARM", "flat");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 차임" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "비프 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockSetNativeAlarmSound).toHaveBeenCalledWith("BEEP");
        expect(mockStartAlarmAudio).toHaveBeenCalledWith("BEEP");
        expect(renderer!.root.findByProps({ accessibilityLabel: "비프 알람음" }).props.accessibilityState).toEqual({
            checked: true,
            disabled: false,
        });
        expect(renderer!.root.findAllByProps({ children: "알람음을 바꾸지 못했어요." })).toHaveLength(0);
    });

    test("최초 iOS 알림 요청은 앱 안의 알림 켜기 버튼으로 시작한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            ...iosReady,
            notificationAuthorized: false,
            notificationAuthorization: "notDetermined",
            reason: "NOTIFICATION_PERMISSION_NOT_DETERMINED",
        });
        await renderCard("ALARM", "flat");

        expect(renderer!.root.findByProps({ children: "알림을 켜 주세요" })).toBeTruthy();
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "알림음, 현재 차임",
            }).props.disabled,
        ).toBe(false);

        await act(async () => {
            await renderer!.root
                .findByProps({
                    accessibilityLabel: "알림을 켜 주세요, 알림 켜기",
                })
                .props.onPress();
        });

        expect(mockRequestPushNotificationPermission).toHaveBeenCalledTimes(1);
        expect(linkingSpy).not.toHaveBeenCalled();
    });

    test("거부된 iOS 알림은 설정 화면 하나만 제안한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            ...iosReady,
            notificationAuthorized: false,
            notificationAuthorization: "denied",
            reason: "NOTIFICATION_PERMISSION_REQUIRED",
        });
        await renderCard("ALARM", "flat");

        expect(renderer!.root.findByProps({ children: "알림이 꺼져 있어요" })).toBeTruthy();
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "알림이 꺼져 있어요, 설정 열기",
            }),
        ).toBeTruthy();

        await act(async () => {
            await renderer!.root
                .findByProps({
                    accessibilityLabel: "알림이 꺼져 있어요, 설정 열기",
                })
                .props.onPress();
        });

        expect(linkingSpy).toHaveBeenCalledTimes(1);
        expect(mockRequestPushNotificationPermission).not.toHaveBeenCalled();
    });

    test("알림 사운드가 꺼진 경우에만 필요한 소비자 안내를 표시한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            ...iosReady,
            soundAuthorization: "disabled",
            reason: "SOUND_DISABLED",
        });
        await renderCard("ALARM", "flat");

        expect(
            renderer!.root.findByProps({
                children: "알림 소리가 꺼져 있어요",
            }),
        ).toBeTruthy();
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "알림음, 현재 차임",
            }).props.disabled,
        ).toBe(false);
    });

    test("자체 알람 미지원 빌드는 설정 표 대신 NoLate 푸시 전환만 제안한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            ...iosReady,
            supported: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        });
        await renderCard("ALARM", "flat");

        expect(renderer!.root.findByProps({ children: "출발 알람을 사용할 수 없어요" })).toBeTruthy();
        expect(
            renderer!.root.findAllByProps({
                testID: "notification-alarm-sound-row",
            }),
        ).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "설정 열기" })).toHaveLength(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "푸시 알림으로 전환" }).props.onPress();
        });
        expect(onAlertModeChange).toHaveBeenCalledWith("STANDARD");
    });

    test("상태 재확인에서 자체 알람 미지원으로 바뀌면 열린 시트와 미리 듣기를 닫는다", async () => {
        mockGetCapabilities
            .mockResolvedValueOnce(iosReady)
            .mockResolvedValueOnce({
                ...iosReady,
                supported: false,
                reason: "NATIVE_MODULE_UNAVAILABLE",
            });
        await renderCard("ALARM", "flat");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 차임" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "차임 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockStartAlarmAudio).toHaveBeenCalledWith("CHIME");

        await act(async () => {
            appStateHandler?.("active");
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(renderer!.root.findByType(Modal).props.visible).toBe(false);
        expect(mockStopAlarmAudio).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findAllByProps({ testID: "notification-alarm-sound-row" })).toHaveLength(0);
    });

    test("Android의 정확한 예약 설정도 권한 표 없이 한 문장으로 안내한다", async () => {
        mockGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "android",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: true,
            notificationAuthorized: true,
            reason: "EXACT_ALARM_PERMISSION_REQUIRED",
        });
        await renderCard("ALARM", "flat");

        expect(renderer!.root.findByProps({ children: "예약 시각 알림을 켜 주세요" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ children: "정확한 알람" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "전체 화면 표시" })).toHaveLength(0);

        await act(async () => {
            await renderer!.root
                .findByProps({
                    accessibilityLabel: "예약 시각 알림을 켜 주세요, 설정 열기",
                })
                .props.onPress();
        });
        expect(mockOpenExactAlarmSettings).toHaveBeenCalledTimes(1);
    });

    test("늦게 끝난 이전 capability 응답이 최신 상태를 덮어쓰지 않는다", async () => {
        const first = deferred<typeof iosReady>();
        mockGetCapabilities.mockReturnValueOnce(first.promise).mockResolvedValueOnce(iosReady);

        await act(async () => {
            renderer = TestRenderer.create(
                <NotificationSettingsCard
                    routeReady
                    enabled
                    alertMode="ALARM"
                    scheduleId="42"
                    leadMinutes={60}
                    intervalMinutes={20}
                    policy={policy}
                    onEnabledChange={jest.fn()}
                    onAlertModeChange={onAlertModeChange}
                    onLeadMinutesChange={jest.fn()}
                    onIntervalMinutesChange={jest.fn()}
                />,
            );
            await Promise.resolve();
        });

        await act(async () => {
            appStateHandler?.("active");
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(
            renderer!.root.findAllByProps({
                testID: "notification-alarm-setting-notice",
            }),
        ).toHaveLength(0);

        await act(async () => {
            first.resolve({
                ...iosReady,
                notificationAuthorized: false,
                notificationAuthorization: "denied",
            });
            await Promise.resolve();
        });
        expect(
            renderer!.root.findAllByProps({
                testID: "notification-alarm-setting-notice",
            }),
        ).toHaveLength(0);
    });

    test("알람음 재생 실패를 live region으로 안내한다", async () => {
        mockStartAlarmAudio.mockRejectedValue(new Error("audio unavailable"));
        await renderCard("ALARM", "flat");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림음, 현재 차임" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "비프 알람음" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findByProps({
                children: "소리를 재생하지 못했어요.",
            }).props.accessibilityLiveRegion,
        ).toBe("polite");
    });
});
