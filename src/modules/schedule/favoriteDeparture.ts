import * as SecureStore from "expo-secure-store";

import type { Place } from "./types";

const FAVORITE_DEPARTURE_PLACE_KEY = "nolate_favorite_departure_place_v1";

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePlace(place: Place | null | undefined): Place | null {
    if (!place) return null;

    const name = place.name?.trim();
    const address = place.address?.trim();
    const lat = finiteNumber(place.lat);
    const lng = finiteNumber(place.lng);

    if (!name && !address && typeof lat !== "number" && typeof lng !== "number") {
        return null;
    }

    return {
        name: name || address || "출발지",
        address: address || undefined,
        lat,
        lng,
    };
}

export function hasFavoriteDepartureCoords(place: Place | null | undefined): place is Place & { lat: number; lng: number } {
    return typeof place?.lat === "number" && Number.isFinite(place.lat) &&
        typeof place.lng === "number" && Number.isFinite(place.lng);
}

export async function getFavoriteDeparturePlace(): Promise<Place | null> {
    const raw = await SecureStore.getItemAsync(FAVORITE_DEPARTURE_PLACE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Place;
        return normalizePlace(parsed);
    } catch {
        await SecureStore.deleteItemAsync(FAVORITE_DEPARTURE_PLACE_KEY);
        return null;
    }
}

export async function saveFavoriteDeparturePlace(place: Place): Promise<Place | null> {
    const normalized = normalizePlace(place);
    if (!normalized) {
        await SecureStore.deleteItemAsync(FAVORITE_DEPARTURE_PLACE_KEY);
        return null;
    }

    await SecureStore.setItemAsync(FAVORITE_DEPARTURE_PLACE_KEY, JSON.stringify(normalized));
    return normalized;
}
