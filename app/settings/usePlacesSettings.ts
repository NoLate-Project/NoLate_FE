import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Animated, Easing, Keyboard, Platform, UIManager } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createFavoritePlaceCategoryToApi,
    deleteFavoritePlaceCategoryFromApi,
    deleteFavoritePlaceFromApi,
    getDefaultOriginFromApi,
    getFavoritePlaceCategoriesFromApi,
    getFavoritePlacesFromApi,
    reorderFavoritePlaceCategoriesToApi,
    reorderFavoritePlacesToApi,
    saveFavoritePlaceToApi,
    updateFavoritePlaceCategoryToApi,
    updateFavoritePlaceToApi,
    type FavoritePlace,
    type FavoritePlaceCategory,
} from "../../src/api/favoritePlaces";
import { searchAddressByKeyword, type PlaceSearchItem } from "../../src/modules/map/routingService";
import {
    clearFavoriteDeparturePlaces,
    saveFavoriteDepartureFavorite,
    saveFavoriteDeparturePlace,
} from "../../src/modules/schedule/favoriteDeparture";
import {
    DEFAULT_ADDRESS_FAVORITE_TAB_ID,
    UNCATEGORIZED_FAVORITE_TAB_ID,
    buildFavoritePlaceTabs,
    findMatchingFavoritePlace,
    findMatchingFavoritePlaces,
    isReservedFavoritePlaceCategoryName,
    selectFavoritePlacesByTab,
} from "../../src/modules/schedule/favoritePlaceSelection";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import {
    CATEGORY_COLORS,
    configureCategoryContentLayout,
    getPlacesSettingsErrorMessage as errorMessage,
    isSameFavoritePlace as samePlace,
    sortPlacesByOrder as sortByOrder,
    type SearchMode,
    type SheetState,
} from "./placesSettingsModel";

/**
 * 내 장소 화면의 조회, 검색, 기본주소, 즐겨찾기·카테고리 변경 상태를 관리합니다.
 * 화면 컴포넌트에는 렌더링과 접근성 구조만 남기고 비동기 요청의 최신성 및 낙관적 정렬 복구를 이 훅에서 책임집니다.
 */
export function usePlacesSettings() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const loadedOnceRef = useRef(false);
    const loadRequestIdRef = useRef(0);
    const [favorites, setFavorites] = useState<FavoritePlace[]>([]);
    const [categories, setCategories] = useState<FavoritePlaceCategory[]>([]);
    const [defaultOrigin, setDefaultOrigin] = useState<FavoritePlace | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>(DEFAULT_ADDRESS_FAVORITE_TAB_ID);
    const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
    const categoryContentEntrance = useRef(new Animated.Value(1)).current;
    const categoryTransitionDirectionRef = useRef<1 | -1>(1);

    useEffect(() => {
        if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }

        let active = true;
        AccessibilityInfo.isReduceMotionEnabled?.()
            .then((enabled) => {
                if (active) setReduceMotionEnabled(enabled);
            })
            .catch(() => undefined);
        const subscription = AccessibilityInfo.addEventListener?.(
            "reduceMotionChanged",
            setReduceMotionEnabled
        );
        return () => {
            active = false;
            subscription?.remove();
        };
    }, []);

    const loadPlaces = useCallback(async (showLoading = false) => {
        const requestId = loadRequestIdRef.current + 1;
        loadRequestIdRef.current = requestId;
        if (showLoading) setLoading(true);
        setLoadError(null);
        try {
            const [nextFavorites, nextCategories, nextDefaultOrigin] = await Promise.all([
                getFavoritePlacesFromApi(),
                getFavoritePlaceCategoriesFromApi(),
                getDefaultOriginFromApi(),
            ]);
            if (loadRequestIdRef.current !== requestId) return;
            setFavorites(sortByOrder(nextFavorites));
            setCategories(sortByOrder(nextCategories));
            setDefaultOrigin(nextDefaultOrigin);
            loadedOnceRef.current = true;
        } catch (error) {
            if (loadRequestIdRef.current !== requestId) return;
            setLoadError(errorMessage(error));
        } finally {
            if (loadRequestIdRef.current === requestId) {
                if (showLoading) setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            void loadPlaces(!loadedOnceRef.current);
            return () => {
                loadRequestIdRef.current += 1;
            };
        }, [loadPlaces])
    );

    const selectedCategoryId = selectedCategoryKey !== DEFAULT_ADDRESS_FAVORITE_TAB_ID
        && selectedCategoryKey !== UNCATEGORIZED_FAVORITE_TAB_ID
        ? selectedCategoryKey
        : undefined;
    const selectedCategory = useMemo(
        () => categories.find((category) => category.id === selectedCategoryId),
        [categories, selectedCategoryId]
    );
    const favoritesWithDefaultOrigin = useMemo(() => {
        const normalizedFavorites = favorites.map((favorite) => ({
            ...favorite,
            defaultOrigin: samePlace(defaultOrigin, favorite),
        }));
        if (!defaultOrigin || normalizedFavorites.some((favorite) => favorite.defaultOrigin)) {
            return normalizedFavorites;
        }
        return [{ ...defaultOrigin, defaultOrigin: true }, ...normalizedFavorites];
    }, [defaultOrigin, favorites]);
    const categoryTabs = useMemo(() => {
        const tabs = buildFavoritePlaceTabs(favoritesWithDefaultOrigin, categories);
        if (!tabs.some((tab) => tab.id === UNCATEGORIZED_FAVORITE_TAB_ID)) {
            tabs.push({
                id: UNCATEGORIZED_FAVORITE_TAB_ID,
                name: "미분류",
                kind: "uncategorized",
                count: 0,
            });
        }
        return tabs;
    }, [categories, favoritesWithDefaultOrigin]);
    const selectCategoryKey = useCallback((nextKey: string) => {
        if (nextKey === selectedCategoryKey) return;

        const currentIndex = categoryTabs.findIndex((tab) => tab.id === selectedCategoryKey);
        const nextIndex = categoryTabs.findIndex((tab) => tab.id === nextKey);
        categoryTransitionDirectionRef.current = nextIndex >= 0 && currentIndex >= 0 && nextIndex < currentIndex
            ? -1
            : 1;
        categoryContentEntrance.stopAnimation();
        categoryContentEntrance.setValue(reduceMotionEnabled ? 1 : 0);
        if (!reduceMotionEnabled) configureCategoryContentLayout();
        setSelectedCategoryKey(nextKey);
    }, [categoryContentEntrance, categoryTabs, reduceMotionEnabled, selectedCategoryKey]);
    const selectedFavorites = useMemo(
        () => selectFavoritePlacesByTab(favoritesWithDefaultOrigin, selectedCategoryKey, categories),
        [categories, favoritesWithDefaultOrigin, selectedCategoryKey]
    );

    useEffect(() => {
        if (reduceMotionEnabled) {
            categoryContentEntrance.setValue(1);
            return;
        }
        const animation = Animated.timing(categoryContentEntrance, {
            toValue: 1,
            duration: 210,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [categoryContentEntrance, reduceMotionEnabled, selectedCategoryKey]);

    useEffect(() => {
        if (selectedCategoryId && !selectedCategory) {
            setSelectedCategoryKey(DEFAULT_ADDRESS_FAVORITE_TAB_ID);
        }
    }, [selectedCategory, selectedCategoryId]);

    const openSearch = useCallback((searchMode: SearchMode) => {
        setSearchQuery("");
        setSearchResults([]);
        setSheet({ kind: "search", mode: searchMode });
    }, []);

    const refresh = useCallback(() => {
        setRefreshing(true);
        void loadPlaces(false);
    }, [loadPlaces]);

    const performSearch = useCallback(async () => {
        const query = searchQuery.trim();
        if (query.length < 2) {
            Alert.alert("검색어를 확인해 주세요", "장소명이나 주소를 두 글자 이상 입력해 주세요.");
            return;
        }

        Keyboard.dismiss();
        setSearching(true);
        try {
            const results = await searchAddressByKeyword(query);
            setSearchResults(results);
            if (results.length === 0) {
                Alert.alert("검색 결과가 없어요", "장소명이나 주소를 조금 다르게 입력해 보세요.");
            }
        } catch (error) {
            Alert.alert("장소를 검색하지 못했어요", errorMessage(error));
        } finally {
            setSearching(false);
        }
    }, [searchQuery]);

    const chooseSearchResult = useCallback((place: PlaceSearchItem) => {
        if (sheet?.kind !== "search") return;
        if (sheet.mode === "favorite") {
            const existing = findMatchingFavoritePlace(place, favorites);
            setSheet({
                kind: "placeEditor",
                place: existing ?? place,
                favoriteId: existing?.id,
                label: existing?.name?.trim() || place.name,
                categoryId: existing?.categoryId ?? selectedCategoryId,
            });
            return;
        }

        setSheet(null);
        setBusyKey("default-search");
        saveFavoriteDeparturePlace(place)
            .then(() => loadPlaces(false))
            .catch((error) => Alert.alert("기본주소를 설정하지 못했어요", errorMessage(error)))
            .finally(() => setBusyKey(null));
    }, [favorites, loadPlaces, selectedCategoryId, sheet]);

    const chooseFavoriteAsDefault = useCallback((favorite: FavoritePlace) => {
        if (!favorite.id) return;
        setSheet(null);
        setBusyKey(`default-${favorite.id}`);
        saveFavoriteDepartureFavorite(favorite)
            .then(() => loadPlaces(false))
            .catch((error) => Alert.alert("기본주소를 설정하지 못했어요", errorMessage(error)))
            .finally(() => setBusyKey(null));
    }, [loadPlaces]);

    const clearDefaultOrigin = useCallback(() => {
        Alert.alert(
            "기본주소를 해제할까요?",
            "출발지가 없는 일정을 만들 때 자동으로 채워지지 않습니다.",
            [
                { text: "취소", style: "cancel" },
                {
                    text: "해제",
                    style: "destructive",
                    onPress: () => {
                        setBusyKey("clear-default");
                        clearFavoriteDeparturePlaces()
                            .then(() => loadPlaces(false))
                            .catch((error) => Alert.alert("기본주소를 해제하지 못했어요", errorMessage(error)))
                            .finally(() => setBusyKey(null));
                    },
                },
            ]
        );
    }, [loadPlaces]);

    const openFavoriteEditor = useCallback((favorite: FavoritePlace) => {
        setSheet({
            kind: "placeEditor",
            favoriteId: favorite.id,
            place: favorite,
            label: favorite.name?.trim() || "즐겨찾기 장소",
            categoryId: favorite.categoryId,
        });
    }, []);

    const savePlaceEditor = useCallback(async () => {
        if (sheet?.kind !== "placeEditor") return;
        const label = sheet.label.trim();
        if (!label) {
            Alert.alert("장소 이름을 입력해 주세요");
            return;
        }

        setBusyKey("save-place");
        try {
            if (sheet.favoriteId) {
                await updateFavoritePlaceToApi(sheet.favoriteId, {
                    label,
                    categoryId: sheet.categoryId ?? null,
                });
            } else {
                await saveFavoritePlaceToApi(
                    { ...sheet.place, name: label },
                    { categoryId: sheet.categoryId }
                );
            }
            setSheet(null);
            await loadPlaces(false);
        } catch (error) {
            Alert.alert("즐겨찾기를 저장하지 못했어요", errorMessage(error));
        } finally {
            setBusyKey(null);
        }
    }, [loadPlaces, sheet]);

    const deleteFavorite = useCallback((favorite: FavoritePlace) => {
        if (!favorite.id) return;
        const removalTargetsById = new Map<string, FavoritePlace>();
        [...findMatchingFavoritePlaces(favorite, favorites), favorite].forEach((target) => {
            if (target.id) removalTargetsById.set(target.id, target);
        });
        const removalTargets = [...removalTargetsById.values()];
        const isDefault = samePlace(defaultOrigin, favorite)
            || removalTargets.some((target) => samePlace(defaultOrigin, target));
        const deleteRemovalTargets = async () => {
            const results = await Promise.allSettled(
                removalTargets.map((target) => deleteFavoritePlaceFromApi(target.id!))
            );
            if (results.every((result) => result.status === "fulfilled")) return;

            const deletedTargets = removalTargets.filter(
                (_, index) => results[index].status === "fulfilled"
            );
            if (deletedTargets.some((target) => samePlace(defaultOrigin, target))) {
                await clearFavoriteDeparturePlaces().catch(() => undefined);
            }
            throw new Error(
                deletedTargets.length > 0
                    ? "중복 저장된 항목 일부가 남았습니다. 잠시 후 다시 시도해 주세요."
                    : "잠시 후 다시 시도해 주세요."
            );
        };
        Alert.alert(
            "즐겨찾기에서 삭제할까요?",
            isDefault
                ? "이 장소는 기본주소입니다. 삭제하면 일정에 자동 입력되는 기본주소도 함께 해제됩니다."
                : `${favorite.name ?? "이 장소"}을(를) 즐겨찾기에서 삭제합니다.`,
            [
                { text: "취소", style: "cancel" },
                {
                    text: "삭제",
                    style: "destructive",
                    onPress: () => {
                        setBusyKey(`delete-place-${favorite.id}`);
                        deleteRemovalTargets()
                            .then(async () => {
                                if (!isDefault) return;
                                // 서버 삭제가 먼저 성공해야 삭제 실패 시 기본 출발지가 보존된다.
                                // 삭제된 기본 장소의 로컬 캐시는 서버 해제 재호출 실패와 무관하게 비워진다.
                                await clearFavoriteDeparturePlaces().catch(() => undefined);
                            })
                            .then(() => loadPlaces(false))
                            .catch(async (error) => {
                                await loadPlaces(false);
                                Alert.alert("즐겨찾기를 삭제하지 못했어요", errorMessage(error));
                            })
                            .finally(() => setBusyKey(null));
                    },
                },
            ]
        );
    }, [defaultOrigin, favorites, loadPlaces]);

    const moveFavorite = useCallback(async (
        visibleFavorites: FavoritePlace[],
        index: number,
        offset: -1 | 1
    ) => {
        const targetIndex = index + offset;
        if (targetIndex < 0 || targetIndex >= visibleFavorites.length || busyKey) return;
        const sourceId = visibleFavorites[index]?.id;
        const targetId = visibleFavorites[targetIndex]?.id;
        if (!sourceId || !targetId) return;

        const next = [...favorites];
        const sourceGlobalIndex = next.findIndex((favorite) => favorite.id === sourceId);
        const targetGlobalIndex = next.findIndex((favorite) => favorite.id === targetId);
        if (sourceGlobalIndex < 0 || targetGlobalIndex < 0) return;
        [next[sourceGlobalIndex], next[targetGlobalIndex]] = [next[targetGlobalIndex], next[sourceGlobalIndex]];
        const items = next.flatMap((favorite, sortOrder) => favorite.id
            ? [{ id: favorite.id, sortOrder }]
            : []);
        if (items.length !== next.length) return;

        setFavorites(next);
        setBusyKey("reorder-places");
        try {
            setFavorites(sortByOrder(await reorderFavoritePlacesToApi(items)));
        } catch (error) {
            await loadPlaces(false);
            Alert.alert("즐겨찾기 순서를 바꾸지 못했어요", errorMessage(error));
        } finally {
            setBusyKey(null);
        }
    }, [busyKey, favorites, loadPlaces]);

    const openCategoryEditor = useCallback((category?: FavoritePlaceCategory) => {
        setSheet({
            kind: "categoryEditor",
            categoryId: category?.id,
            name: category?.name ?? "",
            color: category?.color ?? CATEGORY_COLORS[0],
        });
    }, []);

    const saveCategoryEditor = useCallback(async () => {
        if (sheet?.kind !== "categoryEditor") return;
        const name = sheet.name.trim();
        if (!name) {
            Alert.alert("카테고리 이름을 입력해 주세요");
            return;
        }
        if (isReservedFavoritePlaceCategoryName(name)) {
            Alert.alert("사용할 수 없는 이름이에요", "기본주소와 미분류는 앱에서 제공하는 카테고리 이름입니다.");
            return;
        }
        const duplicate = categories.some((category) => (
            category.id !== sheet.categoryId
            && category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
        ));
        if (duplicate) {
            Alert.alert("이미 같은 이름의 카테고리가 있어요");
            return;
        }

        setBusyKey("save-category");
        try {
            let savedCategory: FavoritePlaceCategory;
            if (sheet.categoryId) {
                savedCategory = await updateFavoritePlaceCategoryToApi(sheet.categoryId, {
                    name,
                    color: sheet.color,
                });
            } else {
                savedCategory = await createFavoritePlaceCategoryToApi(name, sheet.color);
            }
            setSheet(null);
            await loadPlaces(false);
            if (savedCategory.id) {
                selectCategoryKey(savedCategory.id);
            }
        } catch (error) {
            Alert.alert("카테고리를 저장하지 못했어요", errorMessage(error));
        } finally {
            setBusyKey(null);
        }
    }, [categories, loadPlaces, selectCategoryKey, sheet]);

    const deleteCategory = useCallback((category: FavoritePlaceCategory) => {
        if (!category.id) return;
        const placeCount = favorites.filter((favorite) => favorite.categoryId === category.id).length;
        Alert.alert(
            "카테고리를 삭제할까요?",
            placeCount > 0
                ? `이 카테고리의 장소 ${placeCount}개는 삭제되지 않고 '미분류'로 이동합니다.`
                : `${category.name} 카테고리를 삭제합니다.`,
            [
                { text: "취소", style: "cancel" },
                {
                    text: "삭제",
                    style: "destructive",
                    onPress: () => {
                        setBusyKey(`delete-category-${category.id}`);
                        deleteFavoritePlaceCategoryFromApi(category.id!)
                            .then(() => {
                                if (selectedCategoryKey === category.id) {
                                    selectCategoryKey(UNCATEGORIZED_FAVORITE_TAB_ID);
                                }
                                return loadPlaces(false);
                            })
                            .catch((error) => Alert.alert("카테고리를 삭제하지 못했어요", errorMessage(error)))
                            .finally(() => setBusyKey(null));
                    },
                },
            ]
        );
    }, [favorites, loadPlaces, selectCategoryKey, selectedCategoryKey]);

    const moveCategory = useCallback(async (index: number, offset: -1 | 1) => {
        const targetIndex = index + offset;
        if (targetIndex < 0 || targetIndex >= categories.length || busyKey) return;
        const next = [...categories];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        const items = next.flatMap((category, sortOrder) => category.id
            ? [{ id: category.id, sortOrder }]
            : []);
        if (items.length !== next.length) return;

        setCategories(next);
        setBusyKey("reorder-categories");
        try {
            setCategories(sortByOrder(await reorderFavoritePlaceCategoriesToApi(items)));
        } catch (error) {
            await loadPlaces(false);
            Alert.alert("카테고리 순서를 바꾸지 못했어요", errorMessage(error));
        } finally {
            setBusyKey(null);
        }
    }, [busyKey, categories, loadPlaces]);

    return {
        router,
        insets,
        colors,
        mode,
        favorites,
        categories,
        defaultOrigin,
        loading,
        refreshing,
        loadError,
        busyKey,
        sheet,
        setSheet,
        searchQuery,
        setSearchQuery,
        searchResults,
        searching,
        selectedCategoryKey,
        reduceMotionEnabled,
        categoryContentEntrance,
        categoryTransitionDirectionRef,
        loadPlaces,
        selectedCategory,
        categoryTabs,
        selectCategoryKey,
        selectedFavorites,
        openSearch,
        refresh,
        performSearch,
        chooseSearchResult,
        chooseFavoriteAsDefault,
        clearDefaultOrigin,
        openFavoriteEditor,
        savePlaceEditor,
        deleteFavorite,
        moveFavorite,
        openCategoryEditor,
        saveCategoryEditor,
        deleteCategory,
        moveCategory,
    };
}
