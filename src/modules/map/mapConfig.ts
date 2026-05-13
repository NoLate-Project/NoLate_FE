import { getEnv } from "../../api/env";

// 지도 공급자 선택과 API 키를 읽어 오는 공용 설정 모듈.
export type MapProvider = "APPLE" | "GOOGLE" | "NAVER" | "KAKAO" | "TMAP";
const NAVER_MAP_DEFAULT_CLIENT_ID = "q25m6dcvfx";

export type MapConfig = {
    defaultProvider: MapProvider;
    naverMapClientId?: string;
    kakaoMapAppKey?: string;
    googleMapsApiKey?: string;
};

// 환경변수를 안전한 기본값과 함께 정규화해 반환한다.
export function getMapConfig(): MapConfig {
    const provider = (getEnv("EXPO_PUBLIC_MAP_PROVIDER") ?? "TMAP").toUpperCase();
    // 지원하지 않는 값은 APPLE로 fallback 한다.
    const defaultProvider: MapProvider =
        provider === "GOOGLE" || provider === "NAVER" || provider === "KAKAO" || provider === "TMAP"
            ? provider
            : "APPLE";

    return {
        defaultProvider,
        naverMapClientId: getEnv("EXPO_PUBLIC_NAVER_MAP_CLIENT_ID") ?? NAVER_MAP_DEFAULT_CLIENT_ID,
        kakaoMapAppKey: getEnv("EXPO_PUBLIC_KAKAO_MAP_APP_KEY"),
        googleMapsApiKey: getEnv("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"),
    };
}
