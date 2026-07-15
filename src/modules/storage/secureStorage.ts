import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// 현재 iOS 개발 런타임은 서명된 Keychain entitlement를 노출하지 않아
// SecureStore가 errSecMissingEntitlement로 실패한다. 배포 빌드는 항상 Keychain을 쓴다.
const useDevelopmentFallback =
    __DEV__ && Platform.OS === "ios" && process.env.NODE_ENV !== "test";

async function getSimulatorStorage() {
    const module = await import("@react-native-async-storage/async-storage");
    return module.default;
}

export async function getItemAsync(key: string): Promise<string | null> {
    if (useDevelopmentFallback) {
        return (await getSimulatorStorage()).getItem(key);
    }

    return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
    if (useDevelopmentFallback) {
        await (await getSimulatorStorage()).setItem(key, value);
        return;
    }

    await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
    if (useDevelopmentFallback) {
        await (await getSimulatorStorage()).removeItem(key);
        return;
    }

    await SecureStore.deleteItemAsync(key);
}
