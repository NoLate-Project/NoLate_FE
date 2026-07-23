import {
    buildFavoritePlaceTabs,
    DEFAULT_ADDRESS_FAVORITE_TAB_ID,
    dedupeFavoritePlaces,
    excludeFavoritePlacesFromRecents,
    favoritePlaceMatches,
    favoritePlaceRecordsMatch,
    findMatchingFavoritePlace,
    findMatchingFavoritePlaces,
    getFavoritePlaceCategoryDisplayName,
    getFavoritePlaceCategoryColor,
    isReservedFavoritePlaceCategoryName,
    mergeLoadedFavoritePlaces,
    pinDefaultOriginFirst,
    removeFavoritePlaceFromList,
    resolveManagedDefaultOriginSync,
    selectFavoritePlacesByTab,
    selectFavoritePlacesByCategory,
    UNCATEGORIZED_FAVORITE_TAB_ID,
    upsertFavoritePlace,
} from "../src/modules/schedule/favoritePlaceSelection";
import type { FavoritePlace } from "../src/api/favoritePlaces";

const favorite: FavoritePlace = {
    id: "17",
    name: "집",
    address: "서울 영등포구 대림동 1092-4",
    lat: 37.49,
    lng: 126.9,
    provider: "TMAP",
    providerPlaceId: "place-17",
};

describe("favorite place selection", () => {
    test("공급자 장소 ID나 같은 좌표로 이미 저장된 장소를 찾는다", () => {
        expect(favoritePlaceMatches({
            name: "이름이 바뀐 집",
            provider: "tmap",
            providerPlaceId: "PLACE-17",
        }, favorite)).toBe(true);
        expect(findMatchingFavoritePlace({
            name: "대림동",
            lat: 37.490004,
            lng: 126.900004,
        }, [favorite])).toBe(favorite);
    });

    test("레거시 중복 레코드는 즐겨찾기 해제 시 함께 찾는다", () => {
        const duplicate = {
            ...favorite,
            id: "18",
            categoryId: "home",
        };

        expect(findMatchingFavoritePlaces(favorite, [favorite, duplicate]))
            .toEqual([favorite, duplicate]);
    });

    test("대표 좌표만 같은 서로 다른 장소는 삭제·탭 병합 대상으로 보지 않는다", () => {
        const sameCoordinateShop = {
            ...favorite,
            id: "19",
            name: "같은 건물의 다른 매장",
            address: "서울 영등포구 다른 상가 2층",
            providerPlaceId: "other-shop",
        };

        expect(favoritePlaceMatches(sameCoordinateShop, favorite)).toBe(true);
        expect(favoritePlaceRecordsMatch(sameCoordinateShop, favorite)).toBe(false);
        expect(findMatchingFavoritePlaces(favorite, [favorite, sameCoordinateShop]))
            .toEqual([favorite]);
        expect(dedupeFavoritePlaces([favorite, sameCoordinateShop]))
            .toEqual([favorite, sameCoordinateShop]);
    });

    test("저장 응답을 즉시 목록에 반영하고 같은 장소 중복을 제거한다", () => {
        const oldFavorite = { ...favorite, id: "16", name: "이전 집" };
        const anotherFavorite = {
            ...favorite,
            id: "18",
            lat: 37.5,
            name: "회사",
            providerPlaceId: "place-18",
        };
        const next = upsertFavoritePlace([oldFavorite, anotherFavorite], favorite);

        expect(next).toEqual([favorite, anotherFavorite]);
        expect(dedupeFavoritePlaces([anotherFavorite, oldFavorite, favorite])).toHaveLength(2);
    });

    test("같은 장소의 기본 출발지 레코드가 있으면 기본 표시를 보존한다", () => {
        const defaultOrigin = { ...favorite, id: "19", defaultOrigin: true };

        expect(dedupeFavoritePlaces([favorite, defaultOrigin])).toEqual([defaultOrigin]);
    });

    test("채워진 별을 다시 누르면 해당 즐겨찾기만 목록에서 제거한다", () => {
        const office = {
            ...favorite,
            id: "18",
            name: "회사",
            providerPlaceId: "place-18",
        };

        expect(removeFavoritePlaceFromList([favorite, office], favorite)).toEqual([office]);
    });

    test("느린 최초 조회가 먼저 반영된 저장 결과를 덮어쓰지 않는다", () => {
        const newlySaved = { ...favorite, id: "20", name: "방금 저장한 집" };
        const loadedBeforeSave = [{
            ...favorite,
            id: "21",
            name: "회사",
            lat: 37.6,
            providerPlaceId: "place-21",
        }];

        expect(mergeLoadedFavoritePlaces([newlySaved], loadedBeforeSave))
            .toEqual([newlySaved, ...loadedBeforeSave]);
        expect(mergeLoadedFavoritePlaces([newlySaved], []))
            .toEqual([newlySaved]);
    });

    test("기본 출발지를 즐겨찾기 최상단에 고정하고 나머지 순서를 보존한다", () => {
        const office = { ...favorite, id: "21", name: "회사", providerPlaceId: "office" };
        const gym = { ...favorite, id: "22", name: "헬스장", providerPlaceId: "gym" };
        const home = {
            ...favorite,
            id: "23",
            name: "집",
            providerPlaceId: "home",
            defaultOrigin: true,
        };

        expect(pinDefaultOriginFirst([office, gym, home])).toEqual([home, office, gym]);
    });

    test("선택한 장소 그룹만 보여 주고 그룹 안에서도 기본 출발지를 먼저 보여 준다", () => {
        const taxiOffice = {
            ...favorite,
            id: "31",
            name: "회사",
            providerPlaceId: "taxi-office",
            categoryId: "taxi",
        };
        const familyHome = {
            ...favorite,
            id: "32",
            name: "본가",
            providerPlaceId: "family-home",
            categoryId: "family",
        };
        const taxiHome = {
            ...favorite,
            id: "33",
            name: "집",
            providerPlaceId: "taxi-home",
            categoryId: "taxi",
            defaultOrigin: true,
        };

        expect(selectFavoritePlacesByCategory([taxiOffice, familyHome, taxiHome], "taxi"))
            .toEqual([taxiHome, taxiOffice]);
        expect(selectFavoritePlacesByCategory([taxiOffice, familyHome, taxiHome]))
            .toEqual([taxiHome, taxiOffice, familyHome]);
    });

    test("기본주소를 첫 시스템 탭으로 만들고 각 장소를 하나의 탭에만 배치한다", () => {
        const defaultTaxi = {
            ...favorite,
            id: "41",
            name: "집",
            categoryId: "taxi",
            defaultOrigin: true,
        };
        const taxiOffice = {
            ...favorite,
            id: "42",
            name: "회사",
            providerPlaceId: "office",
            lat: 37.5,
            lng: 126.91,
            categoryId: "taxi",
        };
        const ungroupedGym = {
            ...favorite,
            id: "43",
            name: "헬스장",
            providerPlaceId: "gym",
            lat: 37.51,
            lng: 126.92,
            categoryId: undefined,
        };
        const tabs = buildFavoritePlaceTabs(
            [defaultTaxi, taxiOffice, ungroupedGym],
            [{ id: "taxi", name: "택시", color: "#F97316" }]
        );

        expect(tabs).toEqual([
            {
                id: DEFAULT_ADDRESS_FAVORITE_TAB_ID,
                name: "기본주소",
                kind: "default-address",
                count: 1,
            },
            {
                id: "taxi",
                name: "택시",
                kind: "category",
                color: "#F97316",
                count: 1,
            },
            {
                id: UNCATEGORIZED_FAVORITE_TAB_ID,
                name: "미분류",
                kind: "uncategorized",
                count: 1,
            },
        ]);
        expect(selectFavoritePlacesByTab(
            [defaultTaxi, taxiOffice, ungroupedGym],
            DEFAULT_ADDRESS_FAVORITE_TAB_ID,
            [{ id: "taxi", name: "택시", color: "#F97316" }]
        )).toEqual([defaultTaxi]);
        expect(selectFavoritePlacesByTab(
            [defaultTaxi, taxiOffice, ungroupedGym],
            "taxi",
            [{ id: "taxi", name: "택시", color: "#F97316" }]
        )).toEqual([taxiOffice]);
        expect(selectFavoritePlacesByTab(
            [defaultTaxi, taxiOffice, ungroupedGym],
            UNCATEGORIZED_FAVORITE_TAB_ID,
            [{ id: "taxi", name: "택시", color: "#F97316" }]
        )).toEqual([ungroupedGym]);
    });

    test("카테고리 탭을 선택하기 전에는 즐겨찾기 목록을 펼치지 않는다", () => {
        expect(selectFavoritePlacesByTab([favorite], undefined, [])).toEqual([]);
    });

    test("삭제되었거나 불러오지 못한 카테고리의 장소도 미분류에서 찾을 수 있다", () => {
        const orphan = { ...favorite, id: "88", categoryId: "missing-category" };

        expect(buildFavoritePlaceTabs([orphan], [])).toContainEqual({
            id: UNCATEGORIZED_FAVORITE_TAB_ID,
            name: "미분류",
            kind: "uncategorized",
            count: 1,
        });
        expect(selectFavoritePlacesByTab(
            [orphan],
            UNCATEGORIZED_FAVORITE_TAB_ID,
            []
        )).toEqual([orphan]);
    });

    test("시스템 카테고리 이름은 사용자 그룹 이름으로 다시 만들 수 없다", () => {
        expect(isReservedFavoritePlaceCategoryName(" 기본주소 ")).toBe(true);
        expect(isReservedFavoritePlaceCategoryName("미분류")).toBe(true);
        expect(isReservedFavoritePlaceCategoryName("회사")).toBe(false);
    });

    test("기존 시스템 동명 사용자 카테고리는 숨기지 않고 구분해 표시한다", () => {
        expect(buildFavoritePlaceTabs([], [{
            id: "legacy-default",
            name: "기본주소",
            color: "#22C55E",
        }])).toContainEqual({
            id: "legacy-default",
            name: "기본주소 (사용자 카테고리)",
            kind: "category",
            color: "#22C55E",
            count: 0,
        });
        expect(getFavoritePlaceCategoryDisplayName("미분류"))
            .toBe("미분류 (사용자 카테고리)");
        expect(getFavoritePlaceCategoryDisplayName("회사")).toBe("회사");
    });

    test("같은 장소가 기본주소와 기존 카테고리 레코드로 중복되어도 기본주소에만 표시한다", () => {
        const categorizedDuplicate = {
            ...favorite,
            id: "legacy-favorite",
            categoryId: "home",
        };
        const defaultDuplicate = {
            ...favorite,
            id: "default-origin",
            defaultOrigin: true,
        };
        const categories = [{ id: "home", name: "집", color: "#2563EB" }];

        expect(buildFavoritePlaceTabs(
            [categorizedDuplicate, defaultDuplicate],
            categories
        )).toEqual([
            {
                id: DEFAULT_ADDRESS_FAVORITE_TAB_ID,
                name: "기본주소",
                kind: "default-address",
                count: 1,
            },
            {
                id: "home",
                name: "집",
                kind: "category",
                color: "#2563EB",
                count: 0,
            },
        ]);
        expect(selectFavoritePlacesByTab(
            [categorizedDuplicate, defaultDuplicate],
            DEFAULT_ADDRESS_FAVORITE_TAB_ID,
            categories
        )).toEqual([defaultDuplicate]);
        expect(selectFavoritePlacesByTab(
            [categorizedDuplicate, defaultDuplicate],
            "home",
            categories
        )).toEqual([]);
        expect(selectFavoritePlacesByTab(
            [{ ...defaultDuplicate, defaultOrigin: false }, categorizedDuplicate],
            "home",
            categories
        )).toEqual([categorizedDuplicate]);
    });

    test("즐겨찾기와 같은 장소는 최근 검색 목록에서 제외한다", () => {
        const otherPlace = {
            name: "광화문",
            address: "서울 종로구 세종대로 172",
            lat: 37.571,
            lng: 126.976,
            provider: "TMAP",
            providerPlaceId: "gwanghwamun",
        };

        expect(excludeFavoritePlacesFromRecents([
            { name: "집 최근 검색", provider: "tmap", providerPlaceId: "PLACE-17" },
            otherPlace,
        ], [favorite])).toEqual([otherPlace]);
    });

    test("이름과 주소가 같은 검색·즐겨찾기 대표 좌표가 달라도 최근 검색에서 제외한다", () => {
        const seoulStationFavorite: FavoritePlace = {
            id: "51",
            name: "서울역",
            address: "서울 용산구 청파로 378",
            lat: 37.55593,
            lng: 126.97219,
            provider: "TMAP",
            providerPlaceId: "favorite-seoul-station",
        };
        const seoulStationRecent = {
            name: "서울역",
            address: "서울 용산구 청파로 378",
            lat: 37.55465,
            lng: 126.97073,
            provider: "TMAP",
            providerPlaceId: "recent-seoul-station",
        };

        expect(favoritePlaceMatches(seoulStationRecent, seoulStationFavorite)).toBe(true);
        expect(excludeFavoritePlacesFromRecents(
            [seoulStationRecent],
            [seoulStationFavorite]
        )).toEqual([]);
    });

    test("즐겨찾기에 연결된 장소 그룹 색상을 찾는다", () => {
        expect(getFavoritePlaceCategoryColor(
            { ...favorite, categoryId: "taxi" },
            [{ id: "taxi", name: "택시", color: "#F97316" }]
        )).toBe("#F97316");
        expect(getFavoritePlaceCategoryColor(favorite, [])).toBeUndefined();
    });

    test("관리 화면에서 기본 출발지를 바꾸면 기존 기본 출발지를 새 장소로 교체한다", () => {
        const newDefault = {
            ...favorite,
            id: "42",
            name: "새 집",
            lat: 37.51,
            providerPlaceId: "new-home",
            defaultOrigin: true,
        };

        expect(resolveManagedDefaultOriginSync(favorite, true, newDefault)).toEqual({
            kind: "replace",
            place: newDefault,
        });
        expect(resolveManagedDefaultOriginSync(favorite, true, undefined)).toEqual({
            kind: "clear-default-label",
        });
        expect(resolveManagedDefaultOriginSync(favorite, false, newDefault)).toEqual({ kind: "unchanged" });
    });
});
