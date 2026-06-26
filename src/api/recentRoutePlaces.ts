import { apiDelete, apiGet, apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type { Place } from "../modules/schedule/types";

export type RecentRoutePlace = Place & {
    id?: string;
    provider?: string;
    providerPlaceId?: string;
    lastUsedAt?: string;
    updatedAt?: string;
};

type RecentRoutePlaceDto = {
    id?: number | string | null;
    label?: string | null;
    placeName?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    provider?: string | null;
    providerPlaceId?: string | null;
    lastUsedAt?: string | null;
    updatedAt?: string | null;
};

type SaveRecentRoutePlacePayload = {
    label?: string;
    placeName?: string;
    address?: string;
    lat: number;
    lng: number;
    provider?: string;
    providerPlaceId?: string;
};

function normalizeRecentRoutePlace(dto: RecentRoutePlaceDto): RecentRoutePlace {
    return {
        id: dto.id === undefined || dto.id === null ? undefined : String(dto.id),
        name: dto.label?.trim() || dto.placeName?.trim() || dto.address?.trim() || "최근 검색 장소",
        address: dto.address?.trim() || undefined,
        lat: typeof dto.lat === "number" ? dto.lat : undefined,
        lng: typeof dto.lng === "number" ? dto.lng : undefined,
        provider: dto.provider?.trim() || undefined,
        providerPlaceId: dto.providerPlaceId?.trim() || undefined,
        lastUsedAt: dto.lastUsedAt ?? undefined,
        updatedAt: dto.updatedAt ?? undefined,
    };
}

export async function getRecentRoutePlacesFromApi(limit = 20): Promise<RecentRoutePlace[]> {
    const response = await apiGet<ApiEnvelope<RecentRoutePlaceDto[]>>("/api/recent-route-places", {
        params: { limit },
    });
    return unwrapApiResponse(response).map(normalizeRecentRoutePlace);
}

export async function saveRecentRoutePlaceToApi(place: Place): Promise<RecentRoutePlace> {
    if (typeof place.lat !== "number" || typeof place.lng !== "number") {
        throw new Error("최근 검색 장소 저장에는 좌표가 필요합니다.");
    }

    const label = place.name?.trim() || place.address?.trim() || "최근 검색 장소";
    const payload: SaveRecentRoutePlacePayload = {
        label,
        placeName: place.name?.trim() || undefined,
        address: place.address?.trim() || undefined,
        lat: place.lat,
        lng: place.lng,
    };
    const response = await apiPost<ApiEnvelope<RecentRoutePlaceDto>, SaveRecentRoutePlacePayload>(
        "/api/recent-route-places",
        payload
    );
    return normalizeRecentRoutePlace(unwrapApiResponse(response));
}

export async function deleteRecentRoutePlaceFromApi(recentPlaceId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/recent-route-places/${recentPlaceId}`);
    assertApiSuccess(response);
}
