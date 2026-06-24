import * as SecureStore from "expo-secure-store";

import type { Place } from "./types";

const FAVORITE_DEPARTURE_PLACE_KEY = "nolate_favorite_departure_place_v1";
const FAVORITE_DEPARTURE_PLACES_KEY = "nolate_favorite_departure_places_v1";
const MAX_FAVORITE_DEPARTURE_PLACES = 8;

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

function getPlaceKey(place: Place): string {
    if (typeof place.lat === "number" && typeof place.lng === "number") {
        return `${place.lat.toFixed(6)}:${place.lng.toFixed(6)}`;
    }

    return `${place.name ?? ""}:${place.address ?? ""}`.trim().toLowerCase();
}

function normalizePlaces(places: Place[] | null | undefined): Place[] {
    const result: Place[] = [];
    const seen = new Set<string>();

    places?.forEach((place) => {
        const normalized = normalizePlace(place);
        if (!normalized) return;

        const key = getPlaceKey(normalized);
        if (!key || seen.has(key)) return;

        seen.add(key);
        result.push(normalized);
    });

    return result.slice(0, MAX_FAVORITE_DEPARTURE_PLACES);
}

export function hasFavoriteDepartureCoords(place: Place | null | undefined): place is Place & { lat: number; lng: number } {
    return typeof place?.lat === "number" && Number.isFinite(place.lat) &&
        typeof place.lng === "number" && Number.isFinite(place.lng);
}

export async function getFavoriteDeparturePlaces(): Promise<Place[]> {
    const listRaw = await SecureStore.getItemAsync(FAVORITE_DEPARTURE_PLACES_KEY);
    if (listRaw) {
        try {
            return normalizePlaces(JSON.parse(listRaw) as Place[]);
        } catch {
            await SecureStore.deleteItemAsync(FAVORITE_DEPARTURE_PLACES_KEY);
        }
    }

    const legacyRaw = await SecureStore.getItemAsync(FAVORITE_DEPARTURE_PLACE_KEY);
    if (!legacyRaw) return [];

    try {
        const legacyPlace = normalizePlace(JSON.parse(legacyRaw) as Place);
        const places = normalizePlaces(legacyPlace ? [legacyPlace] : []);
        if (places.length) {
            await SecureStore.setItemAsync(FAVORITE_DEPARTURE_PLACES_KEY, JSON.stringify(places));
        }
        return places;
    } catch {
        await SecureStore.deleteItemAsync(FAVORITE_DEPARTURE_PLACE_KEY);
        return [];
    }
}

export async function getFavoriteDeparturePlace(): Promise<Place | null> {
    const places = await getFavoriteDeparturePlaces();
    return places[0] ?? null;
}

export async function saveFavoriteDeparturePlace(place: Place): Promise<Place | null> {
    const normalized = normalizePlace(place);
    if (!normalized) {
        return null;
    }

    const current = await getFavoriteDeparturePlaces();
    const next = normalizePlaces([
        normalized,
        ...current.filter((item) => getPlaceKey(item) !== getPlaceKey(normalized)),
    ]);

    await SecureStore.setItemAsync(FAVORITE_DEPARTURE_PLACES_KEY, JSON.stringify(next));
    return normalized;
}

export async function removeFavoriteDeparturePlace(place: Place): Promise<Place[]> {
    const targetKey = getPlaceKey(place);
    const current = await getFavoriteDeparturePlaces();
    const next = current.filter((item) => getPlaceKey(item) !== targetKey);

    await SecureStore.setItemAsync(FAVORITE_DEPARTURE_PLACES_KEY, JSON.stringify(next));
    return next;
}
