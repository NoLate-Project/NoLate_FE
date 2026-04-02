declare const process: {
    env: Record<string, string | undefined>;
};

type RuntimeWithOptionalProcess = {
    process?: {
        env?: Record<string, string | undefined>;
    };
};

const runtime = globalThis as RuntimeWithOptionalProcess;

const expoPublicEnv: Record<string, string | undefined> = {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_MAP_PROVIDER: process.env.EXPO_PUBLIC_MAP_PROVIDER,
    EXPO_PUBLIC_NAVER_MAP_CLIENT_ID: process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID,
    EXPO_PUBLIC_NAVER_MAP_CLIENT_SECRET: process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_SECRET,
    EXPO_PUBLIC_KAKAO_MAP_APP_KEY: process.env.EXPO_PUBLIC_KAKAO_MAP_APP_KEY,
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    EXPO_PUBLIC_NAVER_CONSUMER_KEY: process.env.EXPO_PUBLIC_NAVER_CONSUMER_KEY,
    EXPO_PUBLIC_NAVER_CLIENT_ID: process.env.EXPO_PUBLIC_NAVER_CLIENT_ID,
    EXPO_PUBLIC_NAVER_CONSUMER_SECRET: process.env.EXPO_PUBLIC_NAVER_CONSUMER_SECRET,
    EXPO_PUBLIC_NAVER_APP_NAME: process.env.EXPO_PUBLIC_NAVER_APP_NAME,
    EXPO_PUBLIC_NAVER_SERVICE_URL_SCHEME_IOS: process.env.EXPO_PUBLIC_NAVER_SERVICE_URL_SCHEME_IOS,
    EXPO_PUBLIC_TMAP_APP_KEY: process.env.EXPO_PUBLIC_TMAP_APP_KEY,
    EXPO_PUBLIC_TMAP_API_KEY: process.env.EXPO_PUBLIC_TMAP_API_KEY,
};

export function getEnv(key: string): string | undefined {
    return expoPublicEnv[key] ?? runtime.process?.env?.[key];
}
