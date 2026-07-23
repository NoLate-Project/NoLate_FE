import type {
    FavoritePlace,
    FavoritePlaceCategory,
} from "../../api/favoritePlaces";
import type { Place } from "./types";

const COORDINATE_MATCH_EPSILON = 0.00001;

export const DEFAULT_ADDRESS_FAVORITE_TAB_ID = "system:default-address";
export const UNCATEGORIZED_FAVORITE_TAB_ID = "system:uncategorized";
const RESERVED_FAVORITE_CATEGORY_NAMES = new Set(["기본주소", "미분류"]);

export type FavoritePlaceTab = {
    id: string;
    name: string;
    kind: "default-address" | "category" | "uncategorized";
    color?: string;
    count: number;
};

function normalizeText(value: string | null | undefined) {
    return value?.trim().toLowerCase() || undefined;
}

export function isReservedFavoritePlaceCategoryName(value: string) {
    return RESERVED_FAVORITE_CATEGORY_NAMES.has(value.trim().toLocaleLowerCase());
}

export function getFavoritePlaceCategoryDisplayName(value: string) {
    return isReservedFavoritePlaceCategoryName(value)
        ? `${value} (사용자 카테고리)`
        : value;
}

function hasFiniteCoordinates(place: Place) {
    return typeof place.lat === "number"
        && Number.isFinite(place.lat)
        && typeof place.lng === "number"
        && Number.isFinite(place.lng);
}

export function favoritePlaceMatches(place: Place, favorite: FavoritePlace) {
    const provider = normalizeText(place.provider);
    const favoriteProvider = normalizeText(favorite.provider);
    const providerPlaceId = normalizeText(place.providerPlaceId);
    const favoriteProviderPlaceId = normalizeText(favorite.providerPlaceId);
    if (
        provider
        && providerPlaceId
        && provider === favoriteProvider
        && providerPlaceId === favoriteProviderPlaceId
    ) {
        return true;
    }

    if (hasFiniteCoordinates(place) && hasFiniteCoordinates(favorite)) {
        const coordinatesMatch = Math.abs(place.lat! - favorite.lat!) <= COORDINATE_MATCH_EPSILON
            && Math.abs(place.lng! - favorite.lng!) <= COORDINATE_MATCH_EPSILON;
        if (coordinatesMatch) {
            return true;
        }
    }

    const address = normalizeText(place.address);
    if (!address || address !== normalizeText(favorite.address)) {
        return false;
    }

    if (hasFiniteCoordinates(place) && hasFiniteCoordinates(favorite)) {
        // 검색/즐겨찾기 API가 같은 장소에 서로 다른 대표 좌표를 줄 수 있다.
        // 다만 한 건물의 서로 다른 장소를 합치지 않도록 이름까지 같을 때만 보조 키로 쓴다.
        const name = normalizeText(place.name);
        return !!name && name === normalizeText(favorite.name);
    }

    return true;
}

/** 삭제·레코드 병합처럼 되돌리기 어려운 작업에 사용하는 강한 동일성 판정이다. */
export function favoritePlaceRecordsMatch(place: Place, favorite: FavoritePlace) {
    const placeId = (place as FavoritePlace).id;
    if (placeId && favorite.id && placeId === favorite.id) {
        return true;
    }

    const provider = normalizeText(place.provider);
    const favoriteProvider = normalizeText(favorite.provider);
    const providerPlaceId = normalizeText(place.providerPlaceId);
    const favoriteProviderPlaceId = normalizeText(favorite.providerPlaceId);
    if (
        provider
        && providerPlaceId
        && provider === favoriteProvider
        && providerPlaceId === favoriteProviderPlaceId
    ) {
        return true;
    }

    const name = normalizeText(place.name);
    const address = normalizeText(place.address);
    return !!name
        && !!address
        && name === normalizeText(favorite.name)
        && address === normalizeText(favorite.address);
}

export function findMatchingFavoritePlace(
    place: Place,
    favorites: FavoritePlace[]
) {
    return favorites.find((favorite) => favoritePlaceMatches(place, favorite));
}

export function findMatchingFavoritePlaces(
    place: Place,
    favorites: FavoritePlace[]
) {
    return favorites.filter((favorite) => favoritePlaceRecordsMatch(place, favorite));
}

export function upsertFavoritePlace(
    favorites: FavoritePlace[],
    saved: FavoritePlace
) {
    return [
        saved,
        ...favorites.filter((favorite) => (
            favorite.id !== saved.id && !favoritePlaceRecordsMatch(saved, favorite)
        )),
    ];
}

/** 서버에서 삭제된 즐겨찾기를 id 우선, 장소 일치 보조 기준으로 목록에서 제거한다. */
export function removeFavoritePlaceFromList(
    favorites: FavoritePlace[],
    removed: FavoritePlace
) {
    return favorites.filter((favorite) => (
        removed.id
            ? favorite.id !== removed.id
            : !favoritePlaceMatches(favorite, removed)
    ));
}

export function dedupeFavoritePlaces(favorites: FavoritePlace[]) {
    return favorites.reduce<FavoritePlace[]>((result, favorite) => {
        const matchingIndex = result.findIndex((item) => favoritePlaceRecordsMatch(favorite, item));
        if (matchingIndex >= 0) {
            if (!result[matchingIndex].defaultOrigin && favorite.defaultOrigin) {
                const next = [...result];
                next[matchingIndex] = favorite;
                return next;
            }
            if (
                !result[matchingIndex].defaultOrigin
                && !favorite.defaultOrigin
                && !result[matchingIndex].categoryId
                && favorite.categoryId
            ) {
                const next = [...result];
                next[matchingIndex] = favorite;
                return next;
            }
            return result;
        }
        return [...result, favorite];
    }, []);
}

/** 느린 최초 조회가 저장 직후의 로컬 반영을 덮어쓰지 않도록 현재 목록을 우선 병합한다. */
export function mergeLoadedFavoritePlaces(
    current: FavoritePlace[],
    loaded: FavoritePlace[]
) {
    return dedupeFavoritePlaces([...current, ...loaded]);
}

/** 기본 출발지는 항상 먼저 보여 주되 서버에서 받은 나머지 정렬 순서는 보존한다. */
export function pinDefaultOriginFirst(favorites: FavoritePlace[]) {
    return [
        ...favorites.filter((favorite) => favorite.defaultOrigin),
        ...favorites.filter((favorite) => !favorite.defaultOrigin),
    ];
}

export function selectFavoritePlacesByCategory(
    favorites: FavoritePlace[],
    categoryId?: string
) {
    const filtered = categoryId
        ? favorites.filter((favorite) => favorite.categoryId === categoryId)
        : favorites;
    return pinDefaultOriginFirst(filtered);
}

/**
 * 기본주소를 서버 카테고리와 별개로 만들지 않고 defaultOrigin 플래그를 사용하는
 * 시스템 탭으로 표현한다. 한 장소가 여러 탭에 중복 노출되지 않도록 기본주소가
 * 사용자 카테고리보다 우선한다.
 */
export function buildFavoritePlaceTabs(
    favorites: FavoritePlace[],
    categories: FavoritePlaceCategory[]
): FavoritePlaceTab[] {
    const uniqueFavorites = dedupeFavoritePlaces(favorites);
    const categoryIds = new Set(categories.flatMap((category) => category.id ? [category.id] : []));
    const tabs: FavoritePlaceTab[] = [{
        id: DEFAULT_ADDRESS_FAVORITE_TAB_ID,
        name: "기본주소",
        kind: "default-address",
        count: uniqueFavorites.filter((favorite) => favorite.defaultOrigin).length,
    }];

    categories.forEach((category) => {
        if (!category.id) return;
        tabs.push({
            id: category.id,
            name: getFavoritePlaceCategoryDisplayName(category.name),
            kind: "category",
            color: category.color,
            count: uniqueFavorites.filter((favorite) => (
                !favorite.defaultOrigin && favorite.categoryId === category.id
            )).length,
        });
    });

    const uncategorizedCount = uniqueFavorites.filter((favorite) => (
        !favorite.defaultOrigin
        && (!favorite.categoryId || !categoryIds.has(favorite.categoryId))
    )).length;
    if (uncategorizedCount > 0) {
        tabs.push({
            id: UNCATEGORIZED_FAVORITE_TAB_ID,
            name: "미분류",
            kind: "uncategorized",
            count: uncategorizedCount,
        });
    }

    return tabs;
}

export function selectFavoritePlacesByTab(
    favorites: FavoritePlace[],
    tabId: string | undefined,
    categories: FavoritePlaceCategory[]
) {
    if (!tabId) return [];
    const uniqueFavorites = dedupeFavoritePlaces(favorites);
    if (tabId === DEFAULT_ADDRESS_FAVORITE_TAB_ID) {
        return uniqueFavorites.filter((favorite) => favorite.defaultOrigin);
    }
    if (tabId === UNCATEGORIZED_FAVORITE_TAB_ID) {
        const categoryIds = new Set(categories.flatMap((category) => category.id ? [category.id] : []));
        return uniqueFavorites.filter((favorite) => (
            !favorite.defaultOrigin
            && (!favorite.categoryId || !categoryIds.has(favorite.categoryId))
        ));
    }
    return uniqueFavorites.filter((favorite) => (
        !favorite.defaultOrigin && favorite.categoryId === tabId
    ));
}

/** 즐겨찾기와 최근 검색에 같은 장소가 두 번 노출되지 않게 한다. */
export function excludeFavoritePlacesFromRecents(
    recents: Place[],
    favorites: FavoritePlace[]
) {
    return recents.filter((place) => !findMatchingFavoritePlace(place, favorites));
}

export function getFavoritePlaceCategoryColor(
    favorite: FavoritePlace,
    categories: FavoritePlaceCategory[]
) {
    if (!favorite.categoryId) return undefined;
    return categories.find((category) => category.id === favorite.categoryId)?.color?.trim() || undefined;
}

export type ManagedDefaultOriginSync =
    | { kind: "unchanged" }
    | { kind: "clear-default-label" }
    | { kind: "replace"; place: FavoritePlace };

/** 내 장소 관리에서 기본 출발지를 바꾼 뒤 현재 경로 입력에 반영할 동작을 결정한다. */
export function resolveManagedDefaultOriginSync(
    currentOrigin: Place | null | undefined,
    originUsesDefault: boolean,
    loadedDefaultOrigin?: FavoritePlace
): ManagedDefaultOriginSync {
    if (!originUsesDefault) return { kind: "unchanged" };
    if (!loadedDefaultOrigin) return { kind: "clear-default-label" };
    if (currentOrigin && favoritePlaceMatches(currentOrigin, loadedDefaultOrigin)) {
        return { kind: "unchanged" };
    }
    return { kind: "replace", place: loadedDefaultOrigin };
}
