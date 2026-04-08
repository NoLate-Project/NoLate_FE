import { getEnv } from "../../api/env";

// 앱에서 어떤 지도 공급자/TMS SDK를 기본으로 쓸지 결정하는 공용 설정 모듈.
export type MapProvider = "APPLE" | "GOOGLE" | "NAVER" | "KAKAO" | "TMAP";
const NAVER_MAP_DEFAULT_CLIENT_ID = "q25m6dcvfx";

export type MapConfig = {
    defaultProvider: MapProvider;
    naverMapClientId?: string;
    kakaoMapAppKey?: string;
    googleMapsApiKey?: string;
};

// 환경변수 값을 앱 내부에서 바로 쓰기 좋은 형태로 정규화한다.
export function getMapConfig(): MapConfig {
    const provider = (getEnv("EXPO_PUBLIC_MAP_PROVIDER") ?? "TMAP").toUpperCase();
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
