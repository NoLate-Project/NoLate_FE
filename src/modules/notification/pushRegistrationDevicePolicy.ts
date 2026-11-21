import type { PlatformOSType } from "react-native";

/**
 * Modern ARM64 iOS Simulators support real sandbox APNs; older hosts remain excluded.
 * Android emulator는 FCM token 발급과 수신 검증이 가능하므로 제외하지 않는다.
 */
export function shouldRegisterRemotePush(
    platform: PlatformOSType,
    isPhysicalDevice: boolean,
    supportedSimulator = false,
): boolean {
    return platform !== "ios" || isPhysicalDevice || supportedSimulator;
}

export function supportsIosSimulatorPush(version: number | string, architectures: readonly string[] | null | undefined): boolean {
    const major = Number.parseInt(String(version), 10);
    return Number.isFinite(major) && major >= 16 && architectures?.some(value => /^arm64e?(?:\s|$|-)/i.test(value)) === true;
}
