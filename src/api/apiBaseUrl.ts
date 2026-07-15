const PRODUCTION_API_BASE_URL = "https://nolate.jinuk.dev";

type ResolveApiBaseUrlOptions = {
    explicitLocalUrl?: string;
    configuredUrl?: string;
    isDevelopment: boolean;
    platform: "android" | "ios" | string;
};

/**
 * API 주소 선택 규칙을 네트워크 클라이언트와 분리해 개발/배포 동작을 테스트 가능하게 만든다.
 *
 * 개발 빌드의 iOS Simulator에서 127.0.0.1은 Mac을 가리키며, Android Emulator는
 * 호스트 전용 주소인 10.0.2.2를 사용한다. 실제 휴대폰 개발 빌드는 127.0.0.1로 Mac에
 * 접근할 수 없으므로 EXPO_PUBLIC_LOCAL_API_BASE_URL에 Mac의 LAN IP를 명시해야 한다.
 */
export function resolveApiBaseUrl({
    explicitLocalUrl,
    configuredUrl,
    isDevelopment,
    platform,
}: ResolveApiBaseUrlOptions): string {
    const normalizedLocalUrl = explicitLocalUrl?.trim();
    if (normalizedLocalUrl) return normalizedLocalUrl;

    if (isDevelopment) {
        return platform === "android"
            ? "http://10.0.2.2:5522"
            : "http://127.0.0.1:5522";
    }

    return configuredUrl?.trim() || PRODUCTION_API_BASE_URL;
}
