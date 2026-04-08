import { Linking, Platform } from "react-native";
import { getMapConfig } from "./mapConfig";

// 앱 내부 지도 대신 외부 지도 앱으로 넘길 때 사용하는 입력 형식.
type OpenMapInput = {
    name?: string;
    lat?: number;
    lng?: number;
};

function encode(value: string): string {
    return encodeURIComponent(value);
}

// 기본 공급자 설정에 맞춰 외부 지도 앱 deep link를 만든다.
// 좌표가 있으면 바로 장소/경로 화면으로, 없으면 검색 화면으로 보낸다.
function buildMapUrl({ name, lat, lng }: OpenMapInput): string | null {
    const { defaultProvider } = getMapConfig();

    if (defaultProvider === "TMAP") {
        if (typeof lat === "number" && typeof lng === "number") {
            return `tmap://route?goalx=${lng}&goaly=${lat}&goalname=${encode(name ?? "목적지")}`;
        }
        const query = name?.trim();
        if (!query) return null;
        return `tmap://search?name=${encode(query)}`;
    }

    if (defaultProvider === "NAVER") {
        if (typeof lat === "number" && typeof lng === "number") {
            return `nmap://place?lat=${lat}&lng=${lng}&name=${encode(name ?? "목적지")}`;
        }
        const query = name?.trim();
        if (!query) return null;
        return `nmap://search?query=${encode(query)}`;
    }

    if (defaultProvider === "KAKAO") {
        if (typeof lat === "number" && typeof lng === "number") {
            return `kakaomap://look?p=${lat},${lng}`;
        }
        const query = name?.trim();
        if (!query) return null;
        return `kakaomap://search?q=${encode(query)}`;
    }

    if (defaultProvider === "GOOGLE") {
        if (typeof lat === "number" && typeof lng === "number") {
            if (Platform.OS === "ios") {
                return `comgooglemaps://?q=${lat},${lng}`;
            }
            return `geo:${lat},${lng}?q=${lat},${lng}`;
        }
        const query = name?.trim();
        if (!query) return null;
        if (Platform.OS === "ios") {
            return `comgooglemaps://?q=${encode(query)}`;
        }
        return `geo:0,0?q=${encode(query)}`;
    }

    if (typeof lat === "number" && typeof lng === "number") {
        if (Platform.OS === "ios") {
            return `http://maps.apple.com/?ll=${lat},${lng}&q=${encode(name ?? "목적지")}`;
        }
        return `geo:${lat},${lng}?q=${lat},${lng}(${encode(name ?? "목적지")})`;
    }

    const query = name?.trim();
    if (!query) return null;

    if (Platform.OS === "ios") {
        return `http://maps.apple.com/?q=${encode(query)}`;
    }
    return `geo:0,0?q=${encode(query)}`;
}

// 전용 앱 deep link가 실패하면 웹 Google Maps 검색으로 한 번 더 fallback 한다.
export async function openExternalMap(input: OpenMapInput): Promise<void> {
    const url = buildMapUrl(input);
    if (!url) {
        throw new Error("지도로 열 위치 정보가 없습니다.");
    }

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
        await Linking.openURL(url);
        return;
    }

    const fallbackQuery = encode(input.name?.trim() || "목적지");
    const fallback = `https://www.google.com/maps/search/?api=1&query=${fallbackQuery}`;
    const canOpenFallback = await Linking.canOpenURL(fallback);
    if (canOpenFallback) {
        await Linking.openURL(fallback);
        return;
    }

    throw new Error("지도 앱을 열 수 없습니다.");
}
