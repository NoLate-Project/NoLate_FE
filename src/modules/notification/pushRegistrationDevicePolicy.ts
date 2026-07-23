import type { PlatformOSType } from "react-native";

/**
 * iOS Simulator는 APNs device token을 발급하지 못하므로 원격 푸시 등록을 건너뛴다.
 * Android emulator는 FCM token 발급과 수신 검증이 가능하므로 제외하지 않는다.
 */
export function shouldRegisterRemotePush(
    platform: PlatformOSType,
    isPhysicalDevice: boolean,
): boolean {
    return platform !== "ios" || isPhysicalDevice;
}
