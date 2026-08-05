import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
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

type SaveDefaultOriginPayload = SaveFavoritePlacePayload;

type CreateFavoritePlaceCategoryPayload = {
    name: string;
    color?: string;
    iconKey?: string;
};

export type FavoritePlaceCategoryUpdates = {
    name?: string;
    color?: string;
    iconKey?: string;
    sortOrder?: number;
};

export type FavoritePlaceUpdates = {
    categoryId?: string | null;
    clearCategory?: boolean;
    label?: string;
    placeName?: string;
    address?: string;
    lat?: number;
    lng?: number;
    provider?: string;
    providerPlaceId?: string;
    defaultOrigin?: boolean;
    sortOrder?: number;
};

export type FavoritePlaceReorderItem = {
    id: string;
    sortOrder: number;
};

type UpdateFavoritePlacePayload = Omit<FavoritePlaceUpdates, "categoryId"> & {
    categoryId?: number;
};

type FavoritePlaceReorderPayload = {
    items: Array<{
        id: number;
        sortOrder: number;
    }>;
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

export async function getDefaultOriginFromApi(): Promise<FavoritePlace | null> {
    const response = await apiGet<ApiEnvelope<FavoritePlaceDto | null>>("/api/favorite-places/default-origin");
    if (!response.success) {
        throw new Error(response.errorMessage ?? "기본 출발지를 불러오지 못했습니다.");
    }
    return response.data ? normalizeFavoritePlace(response.data) : null;
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

export async function updateFavoritePlaceCategoryToApi(
    categoryId: string,
    updates: FavoritePlaceCategoryUpdates
): Promise<FavoritePlaceCategory> {
    const payload: FavoritePlaceCategoryUpdates = {
        ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
        ...(updates.color !== undefined ? { color: updates.color.trim() } : {}),
        ...(updates.iconKey !== undefined ? { iconKey: updates.iconKey.trim() } : {}),
        ...(updates.sortOrder !== undefined ? { sortOrder: updates.sortOrder } : {}),
    };
    const response = await apiPatch<ApiEnvelope<FavoritePlaceCategoryDto>, FavoritePlaceCategoryUpdates>(
        `/api/favorite-place-categories/${categoryId}`,
        payload
    );
    return normalizeFavoritePlaceCategory(unwrapApiResponse(response));
}

export async function deleteFavoritePlaceCategoryFromApi(categoryId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/favorite-place-categories/${categoryId}`);
    assertApiSuccess(response);
}

export async function reorderFavoritePlaceCategoriesToApi(
    items: FavoritePlaceReorderItem[]
): Promise<FavoritePlaceCategory[]> {
    const payload: FavoritePlaceReorderPayload = {
        items: items.map((item) => ({
            id: Number(item.id),
            sortOrder: item.sortOrder,
        })),
    };
    const response = await apiPatch<ApiEnvelope<FavoritePlaceCategoryDto[]>, FavoritePlaceReorderPayload>(
        "/api/favorite-place-categories/reorder",
        payload
    );
    return unwrapApiResponse(response).map(normalizeFavoritePlaceCategory);
}

export async function saveFavoritePlaceToApi(
    place: Place,
    options: SaveFavoritePlaceOptions = {}
): Promise<FavoritePlace> {
    if (typeof place.lat !== "number" || typeof place.lng !== "number") {
        throw new Error("이 장소의 위치를 확인하지 못해 즐겨찾기에 저장할 수 없어요.");
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

export async function updateFavoritePlaceToApi(
    placeId: string,
    updates: FavoritePlaceUpdates
): Promise<FavoritePlace> {
    const numericCategoryId = updates.categoryId === undefined || updates.categoryId === null
        ? undefined
        : Number(updates.categoryId);
    const payload: UpdateFavoritePlacePayload = {
        ...(typeof numericCategoryId === "number" && Number.isFinite(numericCategoryId)
            ? { categoryId: numericCategoryId }
            : {}),
        ...(updates.categoryId === null ? { clearCategory: true } : {}),
        ...(updates.clearCategory !== undefined ? { clearCategory: updates.clearCategory } : {}),
        ...(updates.label !== undefined ? { label: updates.label.trim() } : {}),
        ...(updates.placeName !== undefined ? { placeName: updates.placeName.trim() } : {}),
        ...(updates.address !== undefined ? { address: updates.address.trim() } : {}),
        ...(updates.lat !== undefined ? { lat: updates.lat } : {}),
        ...(updates.lng !== undefined ? { lng: updates.lng } : {}),
        ...(updates.provider !== undefined ? { provider: updates.provider.trim() } : {}),
        ...(updates.providerPlaceId !== undefined ? { providerPlaceId: updates.providerPlaceId.trim() } : {}),
        ...(updates.defaultOrigin !== undefined ? { defaultOrigin: updates.defaultOrigin } : {}),
        ...(updates.sortOrder !== undefined ? { sortOrder: updates.sortOrder } : {}),
    };
    const response = await apiPatch<ApiEnvelope<FavoritePlaceDto>, UpdateFavoritePlacePayload>(
        `/api/favorite-places/${placeId}`,
        payload
    );
    return normalizeFavoritePlace(unwrapApiResponse(response));
}

export async function deleteFavoritePlaceFromApi(placeId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/favorite-places/${placeId}`);
    assertApiSuccess(response);
}

export async function setFavoritePlaceAsDefaultOriginToApi(placeId: string): Promise<FavoritePlace> {
    const response = await apiPatch<ApiEnvelope<FavoritePlaceDto>>(
        `/api/favorite-places/${placeId}/default-origin`
    );
    return normalizeFavoritePlace(unwrapApiResponse(response));
}

export async function reorderFavoritePlacesToApi(items: FavoritePlaceReorderItem[]): Promise<FavoritePlace[]> {
    const payload: FavoritePlaceReorderPayload = {
        items: items.map((item) => ({
            id: Number(item.id),
            sortOrder: item.sortOrder,
        })),
    };
    const response = await apiPatch<ApiEnvelope<FavoritePlaceDto[]>, FavoritePlaceReorderPayload>(
        "/api/favorite-places/reorder",
        payload
    );
    return unwrapApiResponse(response).map(normalizeFavoritePlace);
}

export async function saveDefaultOriginToApi(place: Place): Promise<FavoritePlace> {
    if (typeof place.lat !== "number" || typeof place.lng !== "number") {
        throw new Error("이 장소의 위치를 확인하지 못해 기본 출발지로 저장할 수 없어요.");
    }

    const label = place.name?.trim() || place.address?.trim() || "기본 출발지";
    const payload: SaveDefaultOriginPayload = {
        label,
        placeName: place.name?.trim() || undefined,
        address: place.address?.trim() || undefined,
        lat: place.lat,
        lng: place.lng,
        provider: place.provider?.trim() || undefined,
        providerPlaceId: place.providerPlaceId?.trim() || undefined,
    };
    const response = await apiPut<ApiEnvelope<FavoritePlaceDto>, SaveDefaultOriginPayload>(
        "/api/favorite-places/default-origin",
        payload
    );
    return normalizeFavoritePlace(unwrapApiResponse(response));
}

export async function clearDefaultOriginFromApi(): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>("/api/favorite-places/default-origin");
    assertApiSuccess(response);
}
