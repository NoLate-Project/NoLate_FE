import { apiGet, apiPost } from "./api";
import { type ApiEnvelope, unwrapApiResponse } from "./response";
import type { Place } from "../modules/schedule/types";

export type FavoritePlace = Place & {
    id?: string;
    categoryId?: string;
    categoryName?: string;
    provider?: string;
    providerPlaceId?: string;
    defaultOrigin?: boolean;
    sortOrder?: number;
    updatedAt?: string;
};

export type FavoritePlaceCategory = {
    id?: string;
    name: string;
    color: string;
    iconKey?: string;
    sortOrder?: number;
    updatedAt?: string;
};

type FavoritePlaceDto = {
    id?: number | string | null;
    categoryId?: number | string | null;
    category?: {
        id?: number | string | null;
        name?: string | null;
    } | null;
    label?: string | null;
    placeName?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    provider?: string | null;
    providerPlaceId?: string | null;
    defaultOrigin?: boolean | null;
    sortOrder?: number | null;
    updatedAt?: string | null;
};

type FavoritePlaceCategoryDto = {
    id?: number | string | null;
    name?: string | null;
    color?: string | null;
    iconKey?: string | null;
    sortOrder?: number | null;
    updatedAt?: string | null;
};

type SaveFavoritePlacePayload = {
    categoryId?: number;
    label?: string;
    placeName?: string;
    address?: string;
    lat: number;
    lng: number;
    provider?: string;
    providerPlaceId?: string;
};

type CreateFavoritePlaceCategoryPayload = {
    name: string;
    color?: string;
    iconKey?: string;
};

type SaveFavoritePlaceOptions = {
    categoryId?: string;
};

function normalizeFavoritePlace(dto: FavoritePlaceDto): FavoritePlace {
    return {
        id: dto.id === undefined || dto.id === null ? undefined : String(dto.id),
        categoryId: dto.categoryId === undefined || dto.categoryId === null ? undefined : String(dto.categoryId),
        categoryName: dto.category?.name?.trim() || undefined,
        name: dto.label?.trim() || dto.placeName?.trim() || dto.address?.trim() || "즐겨찾기 장소",
        address: dto.address?.trim() || undefined,
        lat: typeof dto.lat === "number" ? dto.lat : undefined,
        lng: typeof dto.lng === "number" ? dto.lng : undefined,
        provider: dto.provider?.trim() || undefined,
        providerPlaceId: dto.providerPlaceId?.trim() || undefined,
        defaultOrigin: dto.defaultOrigin ?? undefined,
        sortOrder: typeof dto.sortOrder === "number" ? dto.sortOrder : undefined,
        updatedAt: dto.updatedAt ?? undefined,
    };
}

function normalizeFavoritePlaceCategory(dto: FavoritePlaceCategoryDto): FavoritePlaceCategory {
    return {
        id: dto.id === undefined || dto.id === null ? undefined : String(dto.id),
        name: dto.name?.trim() || "카테고리",
        color: dto.color?.trim() || "#5A96FF",
        iconKey: dto.iconKey?.trim() || undefined,
        sortOrder: typeof dto.sortOrder === "number" ? dto.sortOrder : undefined,
        updatedAt: dto.updatedAt ?? undefined,
    };
}

export async function getFavoritePlacesFromApi(): Promise<FavoritePlace[]> {
    const response = await apiGet<ApiEnvelope<FavoritePlaceDto[]>>("/api/favorite-places");
    return unwrapApiResponse(response).map(normalizeFavoritePlace);
}

export async function getFavoritePlaceCategoriesFromApi(): Promise<FavoritePlaceCategory[]> {
    const response = await apiGet<ApiEnvelope<FavoritePlaceCategoryDto[]>>("/api/favorite-place-categories");
    return unwrapApiResponse(response).map(normalizeFavoritePlaceCategory);
}

export async function createFavoritePlaceCategoryToApi(
    name: string,
    color: string,
    iconKey?: string
): Promise<FavoritePlaceCategory> {
    const payload: CreateFavoritePlaceCategoryPayload = {
        name: name.trim(),
        color,
        iconKey: iconKey?.trim() || undefined,
    };
    const response = await apiPost<ApiEnvelope<FavoritePlaceCategoryDto>, CreateFavoritePlaceCategoryPayload>(
        "/api/favorite-place-categories",
        payload
    );
    return normalizeFavoritePlaceCategory(unwrapApiResponse(response));
}

export async function saveFavoritePlaceToApi(
    place: Place,
    options: SaveFavoritePlaceOptions = {}
): Promise<FavoritePlace> {
    if (typeof place.lat !== "number" || typeof place.lng !== "number") {
        throw new Error("즐겨찾기 저장에는 좌표가 필요합니다.");
    }

    const label = place.name?.trim() || place.address?.trim() || "즐겨찾기 장소";
    const categoryId = options.categoryId ? Number(options.categoryId) : undefined;
    const payload: SaveFavoritePlacePayload = {
        ...(typeof categoryId === "number" && Number.isFinite(categoryId) ? { categoryId } : {}),
        label,
        placeName: place.name?.trim() || undefined,
        address: place.address?.trim() || undefined,
        lat: place.lat,
        lng: place.lng,
        provider: place.provider?.trim() || undefined,
        providerPlaceId: place.providerPlaceId?.trim() || undefined,
    };
    const response = await apiPost<ApiEnvelope<FavoritePlaceDto>, SaveFavoritePlacePayload>(
        "/api/favorite-places",
        payload
    );
    return normalizeFavoritePlace(unwrapApiResponse(response));
}
