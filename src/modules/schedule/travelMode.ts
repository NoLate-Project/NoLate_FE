import type { Place, TravelMode } from "./types";

const EARTH_RADIUS_KM = 6371;

export const TRAVEL_MODE_META: Record<TravelMode, { label: string; speedKmh: number }> = {
    CAR: { label: "자차", speedKmh: 35 },
    TRANSIT: { label: "대중교통", speedKmh: 24 },
    WALK: { label: "도보", speedKmh: 4.5 },
    BIKE: { label: "자전거", speedKmh: 16 },
    ETC: { label: "기타", speedKmh: 18 },
};

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function hasCoords(place?: Place): place is Place & { lat: number; lng: number } {
    return !!place && typeof place.lat === "number" && typeof place.lng === "number";
}

function haversineDistanceKm(from: Place, to: Place): number | undefined {
    if (!hasCoords(from) || !hasCoords(to)) return undefined;

    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
}

export function getTravelModeLabel(mode?: TravelMode): string {
    if (!mode) return "이동수단 미지정";
    return TRAVEL_MODE_META[mode]?.label ?? "이동수단 미지정";
}

export function estimateTravelMinutesByStraightDistance(
    origin?: Place,
    destination?: Place,
    mode: TravelMode = "CAR"
): number | undefined {
    const distanceKm = haversineDistanceKm(origin ?? {}, destination ?? {});
    if (typeof distanceKm !== "number") return undefined;
    const speedKmh = TRAVEL_MODE_META[mode]?.speedKmh ?? TRAVEL_MODE_META.CAR.speedKmh;
    if (speedKmh <= 0) return undefined;
    return Math.max(1, Math.ceil((distanceKm / speedKmh) * 60));
}
