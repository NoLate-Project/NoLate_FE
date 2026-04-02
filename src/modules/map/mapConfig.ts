import { getEnv } from "../../api/env";

export type MapProvider = "APPLE" | "GOOGLE" | "NAVER" | "KAKAO" | "TMAP";
const NAVER_MAP_DEFAULT_CLIENT_ID = "q25m6dcvfx";

export type MapConfig = {
    defaultProvider: MapProvider;
    naverMapClientId?: string;
    kakaoMapAppKey?: string;
    googleMapsApiKey?: string;
};

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
