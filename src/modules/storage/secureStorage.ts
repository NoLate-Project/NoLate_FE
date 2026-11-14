import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import { Platform } from "react-native";

// Xcode의 iOS 시뮬레이터 Release 서명은 Keychain entitlement가 비어 있을 수 있다.
// 로컬 격리 서버를 가리키는 시뮬레이터 시험 빌드에서만 저장소를 대체한다.
// 실기기와 운영 API 빌드는 항상 SecureStore/Keychain을 사용한다.
const isolatedSimulatorBuild =
    !Device.isDevice &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/i.test(
        process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL ?? ""
    );
const canUseDevelopmentFallback =
    Platform.OS === "ios" && !Device.isDevice && process.env.NODE_ENV !== "test" &&
    (__DEV__ || isolatedSimulatorBuild);

let didWarnAboutFallback = false;

async function getSimulatorStorage() {
    const module = require("@react-native-async-storage/async-storage") as
        typeof import("@react-native-async-storage/async-storage");
    return module.default;
}

function warnAboutFallback(error: unknown) {
    if (didWarnAboutFallback) return;
    didWarnAboutFallback = true;
    console.warn(
        "[auth] iOS Keychain을 사용할 수 없어 시뮬레이터 시험 저장소로 대체합니다. " +
        "앱과 공유 확장을 정상 서명했는지 확인해 주세요.",
        error
    );
}

export async function getItemAsync(key: string): Promise<string | null> {
    try {
        const secureValue = await SecureStore.getItemAsync(key);
        if (secureValue || !canUseDevelopmentFallback) return secureValue;

        // 이전 unsigned QA 빌드가 남긴 값을 정상 서명된 Keychain으로 1회 이관한다.
        const simulatorStorage = await getSimulatorStorage();
        const legacyValue = await simulatorStorage.getItem(key);
        if (legacyValue) {
            await SecureStore.setItemAsync(key, legacyValue);
            await simulatorStorage.removeItem(key);
        }
        return legacyValue;
    } catch (error) {
        if (!canUseDevelopmentFallback) throw error;
        warnAboutFallback(error);
        return (await getSimulatorStorage()).getItem(key);
    }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
    try {
        await SecureStore.setItemAsync(key, value);
        if (canUseDevelopmentFallback) {
            await (await getSimulatorStorage()).removeItem(key);
        }
    } catch (error) {
        if (!canUseDevelopmentFallback) throw error;
        warnAboutFallback(error);
        await (await getSimulatorStorage()).setItem(key, value);
    }
}

export async function deleteItemAsync(key: string): Promise<void> {
    try {
        await SecureStore.deleteItemAsync(key);
    } catch (error) {
        if (!canUseDevelopmentFallback) throw error;
        warnAboutFallback(error);
    } finally {
        if (canUseDevelopmentFallback) {
            // 로그아웃 뒤 예전 토큰이 다시 이관되지 않도록 양쪽을 모두 지운다.
            await (await getSimulatorStorage()).removeItem(key);
        }
    }
}
