import { Linking, Platform } from "react-native";
import { getMapConfig } from "./mapConfig";

type OpenMapInput = {
    name?: string;
    lat?: number;
    lng?: number;
};

function encode(value: string): string {
    return encodeURIComponent(value);
}

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
