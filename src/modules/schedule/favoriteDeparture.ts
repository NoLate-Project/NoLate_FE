import * as SecureStore from "expo-secure-store";

import {
    deleteRecentRoutePlaceFromApi,
    getRecentRoutePlacesFromApi,
    saveRecentRoutePlaceToApi,
    type RecentRoutePlace,
} from "../../api/recentRoutePlaces";
import type { Place } from "./types";

const FAVORITE_DEPARTURE_PLACE_KEY = "nolate_favorite_departure_place_v1";
const FAVORITE_DEPARTURE_PLACES_KEY = "nolate_favorite_departure_places_v1";
const RECENT_ROUTE_PLACES_KEY = "nolate_recent_route_places_v1";
const MAX_FAVORITE_DEPARTURE_PLACES = 8;
const MAX_RECENT_ROUTE_PLACES = 12;

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePlace(place: (Place | RecentRoutePlace) | null | undefined): RecentRoutePlace | null {
    if (!place) return null;

    const name = place.name?.trim();
    const address = place.address?.trim();
    const lat = finiteNumber(place.lat);
    const lng = finiteNumber(place.lng);
    const recentPlace = place as RecentRoutePlace;
    const id = recentPlace.id?.trim();
    const provider = recentPlace.provider?.trim();
    const providerPlaceId = recentPlace.providerPlaceId?.trim();
    const lastUsedAt = recentPlace.lastUsedAt?.trim();
    const updatedAt = recentPlace.updatedAt?.trim();

    if (!name && !address && typeof lat !== "number" && typeof lng !== "number") {
        return null;
    }

    return {
        id: id || undefined,
        name: name || address || "출발지",
        address: address || undefined,
        lat,
        lng,
        provider: provider || undefined,
        providerPlaceId: providerPlaceId || undefined,
        lastUsedAt: lastUsedAt || undefined,
        updatedAt: updatedAt || undefined,
    };
}

function getPlaceKey(place: Place): string {
    if (typeof place.lat === "number" && typeof place.lng === "number") {
        return `${place.lat.toFixed(6)}:${place.lng.toFixed(6)}`;
    }

    return `${place.name ?? ""}:${place.address ?? ""}`.trim().toLowerCase();
}

function normalizePlaces(places: Place[] | null | undefined): Place[] {
    return normalizePlaceList(places, MAX_FAVORITE_DEPARTURE_PLACES);
}

function normalizeRecentPlaces(places: Place[] | null | undefined): Place[] {
    return normalizePlaceList(places, MAX_RECENT_ROUTE_PLACES);
}

function normalizePlaceList(places: Place[] | null | undefined, maxCount: number): RecentRoutePlace[] {
    const result: RecentRoutePlace[] = [];
    const seen = new Set<string>();

    places?.forEach((place) => {
        const normalized = normalizePlace(place);
        if (!normalized) return;

        const key = getPlaceKey(normalized);
        if (!key || seen.has(key)) return;

        seen.add(key);
        result.push(normalized);
    });

    return result.slice(0, maxCount);
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

async function getRecentRoutePlacesLocal(): Promise<RecentRoutePlace[]> {
    const raw = await SecureStore.getItemAsync(RECENT_ROUTE_PLACES_KEY);
    if (!raw) return [];

    try {
        return normalizeRecentPlaces(JSON.parse(raw) as Place[]);
    } catch {
        await SecureStore.deleteItemAsync(RECENT_ROUTE_PLACES_KEY);
        return [];
    }
}

async function setRecentRoutePlacesLocal(places: Place[]): Promise<RecentRoutePlace[]> {
    const normalized = normalizeRecentPlaces(places);
    await SecureStore.setItemAsync(RECENT_ROUTE_PLACES_KEY, JSON.stringify(normalized));
    return normalized;
}

async function saveRecentRoutePlaceLocal(place: Place): Promise<RecentRoutePlace[]> {
    const normalized = normalizePlace(place);
    if (!normalized) {
        return getRecentRoutePlacesLocal();
    }

    const current = await getRecentRoutePlacesLocal();
    const next = normalizeRecentPlaces([
        normalized,
        ...current.filter((item) => getPlaceKey(item) !== getPlaceKey(normalized)),
    ]);

    return setRecentRoutePlacesLocal(next);
}

async function removeRecentRoutePlaceLocal(place: Place): Promise<RecentRoutePlace[]> {
    const targetKey = getPlaceKey(place);
    const current = await getRecentRoutePlacesLocal();
    const next = current.filter((item) => getPlaceKey(item) !== targetKey);

    return setRecentRoutePlacesLocal(next);
}

export async function getRecentRoutePlaces(): Promise<RecentRoutePlace[]> {
    try {
        const remotePlaces = await getRecentRoutePlacesFromApi(MAX_RECENT_ROUTE_PLACES);
        return setRecentRoutePlacesLocal(remotePlaces);
    } catch {
        return getRecentRoutePlacesLocal();
    }
}

export async function saveRecentRoutePlace(place: Place): Promise<RecentRoutePlace[]> {
    const localPlaces = await saveRecentRoutePlaceLocal(place);

    try {
        await saveRecentRoutePlaceToApi(place);
        const remotePlaces = await getRecentRoutePlacesFromApi(MAX_RECENT_ROUTE_PLACES);
        return setRecentRoutePlacesLocal(remotePlaces);
    } catch {
        return localPlaces;
    }
}

export async function removeRecentRoutePlace(place: Place): Promise<RecentRoutePlace[]> {
    const recentPlaceId = (place as RecentRoutePlace).id?.trim();

    if (recentPlaceId) {
        try {
            await deleteRecentRoutePlaceFromApi(recentPlaceId);
            const remotePlaces = await getRecentRoutePlacesFromApi(MAX_RECENT_ROUTE_PLACES);
            return setRecentRoutePlacesLocal(remotePlaces);
        } catch {
            // Local deletion below keeps the UI responsive even when the server is unreachable.
        }
    }

    return removeRecentRoutePlaceLocal(place);
}
