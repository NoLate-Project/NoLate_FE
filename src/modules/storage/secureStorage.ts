import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// 예전에 CODE_SIGNING_ALLOWED=NO로 만든 iOS QA 빌드는 Keychain entitlement가 없어
// AsyncStorage로 우회했다. 정상 서명된 개발 빌드는 SecureStore를 우선 사용하고,
// 기존 QA 빌드의 값은 한 번 읽어 Keychain으로 이관한다.
const canUseDevelopmentFallback =
    __DEV__ && Platform.OS === "ios" && process.env.NODE_ENV !== "test";

let didWarnAboutFallback = false;

async function getSimulatorStorage() {
    const module = await import("@react-native-async-storage/async-storage");
    return module.default;
}

function warnAboutFallback(error: unknown) {
    if (didWarnAboutFallback) return;
    didWarnAboutFallback = true;
    console.warn(
        "[auth] iOS Keychain을 사용할 수 없어 개발용 저장소로 대체합니다. " +
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
