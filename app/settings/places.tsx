import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    Keyboard,
    LayoutAnimation,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    UIManager,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
    getFavoritePlaceCategoryDisplayName,
    isReservedFavoritePlaceCategoryName,
    selectFavoritePlacesByTab,
} from "../../src/modules/schedule/favoritePlaceSelection";
import type { Place } from "../../src/modules/schedule/types";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { BrandedLoadingState } from "../../src/ui/BrandedLoader";

const CATEGORY_COLORS = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#0891B2"];

type SearchMode = "favorite" | "default";

type PlaceEditorSheet = {
    kind: "placeEditor";
    place: Place;
    favoriteId?: string;
    label: string;
    categoryId?: string;
};

type SheetState =
    | { kind: "search"; mode: SearchMode }
    | PlaceEditorSheet
    | {
        kind: "categoryEditor";
        categoryId?: string;
        name: string;
        color: string;
    }
    | null;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function sortByOrder<T extends { sortOrder?: number; id?: string }>(items: T[]) {
    return [...items].sort((left, right) => {
        const orderDiff = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) return orderDiff;
        return (Number(left.id) || 0) - (Number(right.id) || 0);
    });
}

function samePlace(left: FavoritePlace | null, right: FavoritePlace) {
    if (!left) return false;
    if (left.id && right.id && left.id === right.id) return true;
    return findMatchingFavoritePlace(left, [right]) !== undefined;
}

function configureCategoryContentLayout() {
    LayoutAnimation.configureNext({
        duration: 220,
        create: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
        update: {
            type: LayoutAnimation.Types.easeInEaseOut,
        },
        delete: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
    });
}

export default function PlacesSettingsScreen() {
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

    if (loading) {
        return (
            <View style={[styles.root, { backgroundColor: colors.background }]}>
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
                <BrandedLoadingState
                    fill
                    size="full"
                    variant="auth"
                    title="내 장소를 불러오고 있어요"
                    caption="기본주소와 즐겨찾기를 확인하고 있어요"
                    accessibilityLabel="내 장소를 불러오고 있어요"
                />
            </View>
        );
    }

    const anyBusy = busyKey !== null;
    const selectedCategoryIndex = selectedCategory
        ? categories.findIndex((category) => category.id === selectedCategory.id)
        : -1;
    const selectedCategoryTitle = selectedCategoryKey === DEFAULT_ADDRESS_FAVORITE_TAB_ID
        ? "기본주소"
        : selectedCategoryKey === UNCATEGORIZED_FAVORITE_TAB_ID
            ? "미분류"
            : selectedCategory
                ? getFavoritePlaceCategoryDisplayName(selectedCategory.name)
                : "즐겨찾기";
    const selectedCategoryCaption = selectedCategoryKey === DEFAULT_ADDRESS_FAVORITE_TAB_ID
        ? "일정의 출발지로 자동 사용하는 주소예요"
        : `${selectedFavorites.length}개 장소`;

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.headerButtonGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="프로필로 돌아가기"
                        onPress={() => router.back()}
                        style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>
                <View style={styles.headerTitleWrap}>
                    <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>내 장소</Text>
                    <Text style={[styles.headerCaption, { color: colors.textSecondary }]}>즐겨찾기를 카테고리별로 관리해요</Text>
                </View>
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.headerButtonGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="내 장소 새로고침"
                        accessibilityState={{ disabled: refreshing }}
                        disabled={refreshing}
                        onPress={refresh}
                        style={({ pressed }) => [styles.headerButton, { opacity: pressed || refreshing ? 0.5 : 1 }]}
                    >
                        {refreshing
                            ? <ActivityIndicator size="small" color={colors.textPrimary} />
                            : <Ionicons name="refresh" size={20} color={colors.textPrimary} />}
                    </Pressable>
                </CalendarGlassSurface>
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
                contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 28 }]}
            >
                {loadError ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="내 장소를 다시 불러오기"
                        onPress={() => void loadPlaces(false)}
                        style={[styles.errorCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                    >
                        <Ionicons name="alert-circle-outline" size={22} color="#EF4444" />
                        <View style={styles.flexText}>
                            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>일부 정보를 불러오지 못했어요</Text>
                            <Text style={[styles.cardCaption, { color: colors.textSecondary }]}>{loadError} · 탭해서 다시 시도</Text>
                        </View>
                    </Pressable>
                ) : null}

                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <View style={styles.flexText}>
                            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>즐겨찾기 카테고리</Text>
                            <Text style={[styles.sectionCaption, { color: colors.textSecondary }]}>카테고리를 선택하면 저장한 장소만 모아 보여요</Text>
                        </View>
                    </View>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.categoryTabs}
                    >
                        {categoryTabs.map((tab) => (
                            <CategoryTab
                                key={tab.id}
                                label={tab.name}
                                count={tab.count}
                                selected={selectedCategoryKey === tab.id}
                                color={tab.color ?? (tab.kind === "default-address" ? "#2563EB" : "#64748B")}
                                icon={tab.kind === "default-address"
                                    ? "home"
                                    : tab.kind === "uncategorized"
                                        ? "albums-outline"
                                        : undefined}
                                colors={colors}
                                disabled={anyBusy}
                                reduceMotionEnabled={reduceMotionEnabled}
                                onPress={() => selectCategoryKey(tab.id)}
                            />
                        ))}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="새 즐겨찾기 카테고리 만들기"
                            accessibilityState={{ disabled: anyBusy }}
                            disabled={anyBusy}
                            onPress={() => openCategoryEditor()}
                            style={({ pressed }) => [
                                styles.addCategoryTab,
                                { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed || anyBusy ? 0.55 : 1 },
                            ]}
                        >
                            <Ionicons name="add" size={18} color="#2563EB" />
                            <Text style={styles.addCategoryTabText}>카테고리</Text>
                        </Pressable>
                    </ScrollView>
                </View>

                <Animated.View
                    style={[
                        styles.section,
                        {
                            opacity: categoryContentEntrance,
                            transform: [{
                                translateX: categoryContentEntrance.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [categoryTransitionDirectionRef.current * 12, 0],
                                }),
                            }],
                        },
                    ]}
                >
                    <View style={styles.sectionHeader}>
                        <View style={styles.flexText}>
                            <Text style={[styles.selectedCategoryTitle, { color: colors.textPrimary }]}>{selectedCategoryTitle}</Text>
                            <Text style={[styles.sectionCaption, { color: colors.textSecondary }]}>{selectedCategoryCaption}</Text>
                        </View>
                        {selectedCategoryKey !== DEFAULT_ADDRESS_FAVORITE_TAB_ID ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${selectedCategoryTitle}에 새 장소 추가`}
                                disabled={anyBusy}
                                onPress={() => openSearch("favorite")}
                                style={({ pressed }) => [styles.smallAddButton, { opacity: pressed || anyBusy ? 0.55 : 1 }]}
                            >
                                <Ionicons name="add" size={17} color="#2563EB" />
                                <Text style={styles.smallAddButtonText}>새 장소</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    {selectedCategory ? (
                        <View style={[styles.categoryManageBar, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                            <View style={[styles.colorDot, { backgroundColor: selectedCategory.color }]} />
                            <Text style={[styles.categoryManageText, { color: colors.textSecondary }]}>카테고리 관리</Text>
                            <View style={styles.categoryActions}>
                                <IconAction
                                    label={`${selectedCategoryTitle} 카테고리 왼쪽으로 이동`}
                                    icon="arrow-back"
                                    disabled={selectedCategoryIndex <= 0 || anyBusy}
                                    colors={colors}
                                    onPress={() => void moveCategory(selectedCategoryIndex, -1)}
                                />
                                <IconAction
                                    label={`${selectedCategoryTitle} 카테고리 오른쪽으로 이동`}
                                    icon="arrow-forward"
                                    disabled={selectedCategoryIndex < 0 || selectedCategoryIndex === categories.length - 1 || anyBusy}
                                    colors={colors}
                                    onPress={() => void moveCategory(selectedCategoryIndex, 1)}
                                />
                                <IconAction
                                    label={`${selectedCategoryTitle} 카테고리 수정`}
                                    icon="pencil-outline"
                                    disabled={!selectedCategory.id || anyBusy}
                                    colors={colors}
                                    onPress={() => openCategoryEditor(selectedCategory)}
                                />
                                <IconAction
                                    label={`${selectedCategoryTitle} 카테고리 삭제`}
                                    icon="trash-outline"
                                    destructive
                                    disabled={!selectedCategory.id || anyBusy}
                                    colors={colors}
                                    onPress={() => deleteCategory(selectedCategory)}
                                />
                            </View>
                        </View>
                    ) : null}

                    {selectedCategoryKey === DEFAULT_ADDRESS_FAVORITE_TAB_ID ? (
                        <CalendarGlassSurface
                            variant="card"
                            tone="solidCard"
                            style={[
                                styles.defaultCard,
                                {
                                    borderColor: defaultOrigin ? "#2563EB" : colors.border,
                                    backgroundColor: colors.surface,
                                },
                            ]}
                        >
                            {defaultOrigin ? (
                                <>
                                    <View style={styles.placeMainRow}>
                                        <View style={[styles.placeIcon, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                                            <Ionicons name="home" size={22} color="#2563EB" />
                                        </View>
                                        <View style={styles.flexText}>
                                            <View style={styles.badgeRow}>
                                                <Text numberOfLines={1} style={[styles.defaultName, { color: colors.textPrimary }]}>
                                                    {defaultOrigin.name ?? "기본주소"}
                                                </Text>
                                                <View style={styles.defaultBadge}>
                                                    <Text style={styles.defaultBadgeText}>사용 중</Text>
                                                </View>
                                            </View>
                                            <Text numberOfLines={2} style={[styles.cardCaption, { color: colors.textSecondary }]}>
                                                {defaultOrigin.address ?? "주소 정보 없음"}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={[styles.cardToolbar, { borderTopColor: colors.border }]}>
                                        <Text style={[styles.defaultUsageText, { color: colors.textSecondary }]}>일정 출발지로 자동 입력</Text>
                                        <View style={styles.cardActions}>
                                            <IconAction
                                                label={`${defaultOrigin.name ?? "기본주소"} 수정`}
                                                icon="pencil-outline"
                                                disabled={!defaultOrigin.id || anyBusy}
                                                colors={colors}
                                                onPress={() => openFavoriteEditor(defaultOrigin)}
                                            />
                                            <IconAction
                                                label={`${defaultOrigin.name ?? "기본주소"} 즐겨찾기에서 삭제`}
                                                icon="trash-outline"
                                                destructive
                                                disabled={!defaultOrigin.id || anyBusy}
                                                colors={colors}
                                                onPress={() => deleteFavorite(defaultOrigin)}
                                            />
                                        </View>
                                    </View>
                                    <View style={styles.defaultActions}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="기본주소 변경"
                                            disabled={anyBusy}
                                            onPress={() => openSearch("default")}
                                            style={({ pressed }) => [
                                                styles.secondaryButton,
                                                { borderColor: colors.border, opacity: pressed || anyBusy ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons name="swap-horizontal" size={17} color={colors.textPrimary} />
                                            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>변경</Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="기본주소 해제"
                                            disabled={anyBusy}
                                            onPress={clearDefaultOrigin}
                                            style={({ pressed }) => [
                                                styles.secondaryButton,
                                                { borderColor: colors.border, opacity: pressed || anyBusy ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons name="close-circle-outline" size={17} color="#EF4444" />
                                            <Text style={[styles.secondaryButtonText, { color: "#EF4444" }]}>해제</Text>
                                        </Pressable>
                                    </View>
                                </>
                            ) : (
                                <View style={styles.emptyDefaultContent}>
                                    <View style={[styles.emptyDefaultIcon, { backgroundColor: colors.surface2 }]}>
                                        <Ionicons name="home-outline" size={26} color="#2563EB" />
                                    </View>
                                    <Text style={[styles.emptyDefaultTitle, { color: colors.textPrimary }]}>기본주소가 아직 없어요</Text>
                                    <Text style={[styles.emptyDefaultCaption, { color: colors.textSecondary }]}>
                                        자주 출발하는 장소를 기본주소로 저장하면 일정과 경로 검색에 자동으로 입력됩니다.
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="기본주소 설정"
                                        accessibilityHint="즐겨찾기 또는 장소 검색으로 기본주소를 선택합니다"
                                        disabled={anyBusy}
                                        onPress={() => openSearch("default")}
                                        style={({ pressed }) => [styles.primaryButton, { opacity: pressed || anyBusy ? 0.65 : 1 }]}
                                    >
                                        <Ionicons name="add" size={19} color="#FFFFFF" />
                                        <Text style={styles.primaryButtonText}>기본주소 설정</Text>
                                    </Pressable>
                                </View>
                            )}
                        </CalendarGlassSurface>
                    ) : selectedFavorites.length === 0 ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${selectedCategoryTitle}에 첫 장소 추가`}
                            disabled={anyBusy}
                            onPress={() => openSearch("favorite")}
                            style={[styles.emptyListCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                        >
                            <Ionicons name="star-outline" size={26} color={colors.textSecondary} />
                            <Text style={[styles.emptyListTitle, { color: colors.textPrimary }]}>{selectedCategoryTitle}에 저장한 장소가 없어요</Text>
                            <Text style={[styles.cardCaption, { color: colors.textSecondary }]}>별표한 장소를 이 카테고리에서 빠르게 찾아보세요.</Text>
                        </Pressable>
                    ) : selectedFavorites.map((favorite, index) => (
                        <CalendarGlassSurface
                            key={favorite.id ?? `${favorite.name}-${index}`}
                            variant="card"
                            tone="solidCard"
                            style={[styles.placeCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                        >
                            <View style={styles.placeMainRow}>
                                <View style={[styles.placeIcon, { backgroundColor: colors.surface2 }]}>
                                    <Ionicons name="location-outline" size={21} color={colors.textSecondary} />
                                </View>
                                <View style={styles.flexText}>
                                    <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.textPrimary }]}>
                                        {favorite.name ?? "즐겨찾기 장소"}
                                    </Text>
                                    <Text numberOfLines={2} style={[styles.cardCaption, { color: colors.textSecondary }]}>
                                        {favorite.address ?? "주소 정보 없음"}
                                    </Text>
                                </View>
                            </View>
                            <View style={[styles.cardToolbar, { borderTopColor: colors.border }]}>
                                <View style={styles.reorderButtons}>
                                    <IconAction
                                        label={`${favorite.name ?? "장소"} 위로 이동`}
                                        icon="arrow-up"
                                        disabled={index === 0 || anyBusy}
                                        colors={colors}
                                        onPress={() => void moveFavorite(selectedFavorites, index, -1)}
                                    />
                                    <IconAction
                                        label={`${favorite.name ?? "장소"} 아래로 이동`}
                                        icon="arrow-down"
                                        disabled={index === selectedFavorites.length - 1 || anyBusy}
                                        colors={colors}
                                        onPress={() => void moveFavorite(selectedFavorites, index, 1)}
                                    />
                                </View>
                                <View style={styles.cardActions}>
                                    <IconAction
                                        label={`${favorite.name ?? "장소"}을 기본주소로 설정`}
                                        icon="home-outline"
                                        disabled={!favorite.id || anyBusy}
                                        colors={colors}
                                        onPress={() => chooseFavoriteAsDefault(favorite)}
                                    />
                                    <IconAction
                                        label={`${favorite.name ?? "장소"} 수정`}
                                        icon="pencil-outline"
                                        disabled={!favorite.id || anyBusy}
                                        colors={colors}
                                        onPress={() => openFavoriteEditor(favorite)}
                                    />
                                    <IconAction
                                        label={`${favorite.name ?? "장소"} 삭제`}
                                        icon="trash-outline"
                                        destructive
                                        disabled={!favorite.id || anyBusy}
                                        colors={colors}
                                        onPress={() => deleteFavorite(favorite)}
                                    />
                                </View>
                            </View>
                        </CalendarGlassSurface>
                    ))}
                </Animated.View>
            </ScrollView>

            {busyKey ? (
                <View pointerEvents="none" style={styles.busyOverlay}>
                    <View style={[styles.busyPill, { backgroundColor: mode === "dark" ? "#2C2C2E" : "#FFFFFF" }]}>
                        <ActivityIndicator size="small" color="#2563EB" />
                        <Text style={[styles.busyText, { color: colors.textPrimary }]}>변경사항 저장 중</Text>
                    </View>
                </View>
            ) : null}

            <Modal
                visible={sheet !== null}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => busyKey ? undefined : setSheet(null)}
            >
                <View style={[styles.sheetRoot, { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 14) }]}>
                    {sheet?.kind === "search" ? (
                        <SearchSheet
                            mode={sheet.mode}
                            query={searchQuery}
                            results={searchResults}
                            favorites={favorites}
                            defaultOrigin={defaultOrigin}
                            searching={searching}
                            disabled={anyBusy}
                            colors={colors}
                            onChangeQuery={setSearchQuery}
                            onSearch={() => void performSearch()}
                            onSelectResult={chooseSearchResult}
                            onSelectFavorite={chooseFavoriteAsDefault}
                            onClose={() => setSheet(null)}
                        />
                    ) : sheet?.kind === "placeEditor" ? (
                        <PlaceEditor
                            sheet={sheet}
                            categories={categories}
                            disabled={anyBusy}
                            colors={colors}
                            onChange={(updates) => setSheet((current) => current?.kind === "placeEditor"
                                ? { ...current, ...updates }
                                : current)}
                            onSave={() => void savePlaceEditor()}
                            onClose={() => setSheet(null)}
                        />
                    ) : sheet?.kind === "categoryEditor" ? (
                        <CategoryEditor
                            categoryId={sheet.categoryId}
                            name={sheet.name}
                            color={sheet.color}
                            disabled={anyBusy}
                            colors={colors}
                            onChange={(updates) => setSheet((current) => current?.kind === "categoryEditor"
                                ? { ...current, ...updates }
                                : current)}
                            onSave={() => void saveCategoryEditor()}
                            onClose={() => setSheet(null)}
                        />
                    ) : null}
                </View>
            </Modal>
        </View>
    );
}

function CategoryTab({
    label,
    count,
    selected,
    color,
    icon,
    colors,
    disabled,
    reduceMotionEnabled,
    onPress,
}: {
    label: string;
    count: number;
    selected: boolean;
    color: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    colors: ReturnType<typeof useTheme>["colors"];
    disabled?: boolean;
    reduceMotionEnabled: boolean;
    onPress: () => void;
}) {
    const selectionProgress = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        selectionProgress.stopAnimation();
        if (reduceMotionEnabled) {
            selectionProgress.setValue(selected ? 1 : 0);
            return;
        }
        const animation = Animated.timing(selectionProgress, {
            toValue: selected ? 1 : 0,
            duration: 170,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [reduceMotionEnabled, selected, selectionProgress]);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} 카테고리, 장소 ${count}개`}
            accessibilityState={{ selected, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.categoryTab,
                {
                    borderColor: selected ? color : colors.border,
                    backgroundColor: selected ? `${color}18` : colors.surface,
                    opacity: pressed || disabled ? 0.55 : 1,
                },
            ]}
        >
            <View style={[styles.categoryTabMark, { backgroundColor: `${color}20` }]}>
                {icon
                    ? <Ionicons name={icon} size={16} color={color} />
                    : <View style={[styles.categoryTabDot, { backgroundColor: color }]} />}
            </View>
            <Text numberOfLines={1} style={[styles.categoryTabLabel, { color: selected ? color : colors.textPrimary }]}>{label}</Text>
            <View style={[styles.categoryTabCount, { backgroundColor: selected ? `${color}20` : colors.surface2 }]}>
                <Text style={[styles.categoryTabCountText, { color: selected ? color : colors.textSecondary }]}>{count}</Text>
            </View>
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.categoryTabIndicator,
                    {
                        backgroundColor: color,
                        opacity: selectionProgress,
                        transform: [{
                            scaleX: selectionProgress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.35, 1],
                            }),
                        }],
                    },
                ]}
            />
        </Pressable>
    );
}

function IconAction({
    label,
    icon,
    disabled,
    destructive = false,
    colors,
    onPress,
}: {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    disabled?: boolean;
    destructive?: boolean;
    colors: ReturnType<typeof useTheme>["colors"];
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: Boolean(disabled) }}
            disabled={disabled}
            hitSlop={6}
            onPress={onPress}
            style={({ pressed }) => [
                styles.iconAction,
                { backgroundColor: colors.surface2, opacity: disabled ? 0.3 : pressed ? 0.55 : 1 },
            ]}
        >
            <Ionicons name={icon} size={18} color={destructive ? "#EF4444" : colors.textSecondary} />
        </Pressable>
    );
}

function SheetHeader({
    title,
    caption,
    colors,
    disabled,
    onClose,
}: {
    title: string;
    caption: string;
    colors: ReturnType<typeof useTheme>["colors"];
    disabled?: boolean;
    onClose: () => void;
}) {
    return (
        <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <View style={styles.flexText}>
                <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>{title}</Text>
                <Text style={[styles.sheetCaption, { color: colors.textSecondary }]}>{caption}</Text>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${title} 닫기`}
                disabled={disabled}
                onPress={onClose}
                style={({ pressed }) => [styles.sheetClose, { backgroundColor: colors.surface2, opacity: pressed || disabled ? 0.55 : 1 }]}
            >
                <Ionicons name="close" size={21} color={colors.textPrimary} />
            </Pressable>
        </View>
    );
}

function SearchSheet({
    mode,
    query,
    results,
    favorites,
    defaultOrigin,
    searching,
    disabled,
    colors,
    onChangeQuery,
    onSearch,
    onSelectResult,
    onSelectFavorite,
    onClose,
}: {
    mode: SearchMode;
    query: string;
    results: PlaceSearchItem[];
    favorites: FavoritePlace[];
    defaultOrigin: FavoritePlace | null;
    searching: boolean;
    disabled: boolean;
    colors: ReturnType<typeof useTheme>["colors"];
    onChangeQuery: (query: string) => void;
    onSearch: () => void;
    onSelectResult: (place: PlaceSearchItem) => void;
    onSelectFavorite: (favorite: FavoritePlace) => void;
    onClose: () => void;
}) {
    return (
        <>
            <SheetHeader
                title={mode === "default" ? "기본주소 선택" : "즐겨찾기 추가"}
                caption={mode === "default" ? "저장한 장소를 고르거나 새 주소를 검색하세요" : "장소명이나 주소로 검색하세요"}
                colors={colors}
                disabled={disabled}
                onClose={onClose}
            />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
                {mode === "default" && favorites.length > 0 ? (
                    <View style={styles.sheetSection}>
                        <Text style={[styles.sheetSectionTitle, { color: colors.textSecondary }]}>즐겨찾기에서 선택</Text>
                        {favorites.map((favorite) => {
                            const selected = samePlace(defaultOrigin, favorite);
                            return (
                                <Pressable
                                    key={favorite.id ?? favorite.name}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${favorite.name ?? "장소"}${selected ? ", 현재 기본주소" : ", 기본주소로 선택"}`}
                                    accessibilityState={{ selected, disabled: selected || !favorite.id || disabled }}
                                    disabled={selected || !favorite.id || disabled}
                                    onPress={() => onSelectFavorite(favorite)}
                                    style={({ pressed }) => [
                                        styles.sheetPlaceRow,
                                        { backgroundColor: colors.surface, borderColor: selected ? "#2563EB" : colors.border, opacity: pressed ? 0.6 : 1 },
                                    ]}
                                >
                                    <Ionicons name={selected ? "home" : "star"} size={20} color="#2563EB" />
                                    <View style={styles.flexText}>
                                        <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.textPrimary }]}>{favorite.name}</Text>
                                        <Text numberOfLines={1} style={[styles.cardCaption, { color: colors.textSecondary }]}>{favorite.address}</Text>
                                    </View>
                                    {selected
                                        ? <Text style={styles.selectedText}>현재 설정</Text>
                                        : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
                                </Pressable>
                            );
                        })}
                    </View>
                ) : null}

                <View style={styles.sheetSection}>
                    <Text style={[styles.sheetSectionTitle, { color: colors.textSecondary }]}>새 장소 검색</Text>
                    <View style={[styles.searchBar, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
                        <Ionicons name="search" size={20} color={colors.textSecondary} />
                        <TextInput
                            autoFocus
                            accessibilityLabel="장소명 또는 주소 검색"
                            value={query}
                            editable={!searching && !disabled}
                            onChangeText={onChangeQuery}
                            onSubmitEditing={onSearch}
                            returnKeyType="search"
                            placeholder="장소명 또는 주소를 입력하세요"
                            placeholderTextColor={colors.inputPlaceholder}
                            style={[styles.searchInput, { color: colors.textPrimary }]}
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="장소 검색"
                            accessibilityState={{ disabled: searching || disabled }}
                            disabled={searching || disabled}
                            onPress={onSearch}
                            style={({ pressed }) => [styles.searchButton, { opacity: pressed || searching || disabled ? 0.55 : 1 }]}
                        >
                            {searching
                                ? <ActivityIndicator size="small" color="#FFFFFF" />
                                : <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />}
                        </Pressable>
                    </View>
                    {results.map((result, index) => (
                        <Pressable
                            key={`${result.provider ?? "place"}-${result.providerPlaceId ?? `${result.lat}-${result.lng}`}-${index}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${result.name}, ${result.address} 선택`}
                            disabled={disabled}
                            onPress={() => onSelectResult(result)}
                            style={({ pressed }) => [
                                styles.searchResult,
                                { borderBottomColor: colors.border, opacity: pressed || disabled ? 0.55 : 1 },
                            ]}
                        >
                            <View style={[styles.searchResultIcon, { backgroundColor: colors.surface2 }]}>
                                <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
                            </View>
                            <View style={styles.flexText}>
                                <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.textPrimary }]}>{result.name}</Text>
                                <Text numberOfLines={2} style={[styles.cardCaption, { color: colors.textSecondary }]}>{result.address}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                        </Pressable>
                    ))}
                    {!searching && results.length === 0 ? (
                        <View style={styles.searchGuide}>
                            <Ionicons name="map-outline" size={28} color={colors.textDisabled} />
                            <Text style={[styles.searchGuideText, { color: colors.textSecondary }]}>예: 서울역, 강남대로 396</Text>
                        </View>
                    ) : null}
                </View>
            </ScrollView>
        </>
    );
}

function PlaceEditor({
    sheet,
    categories,
    disabled,
    colors,
    onChange,
    onSave,
    onClose,
}: {
    sheet: PlaceEditorSheet;
    categories: FavoritePlaceCategory[];
    disabled: boolean;
    colors: ReturnType<typeof useTheme>["colors"];
    onChange: (updates: Partial<Pick<PlaceEditorSheet, "label" | "categoryId">>) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        <>
            <SheetHeader
                title={sheet.favoriteId ? "즐겨찾기 수정" : "즐겨찾기 저장"}
                caption={sheet.place.address ?? sheet.place.name ?? "선택한 장소"}
                colors={colors}
                disabled={disabled}
                onClose={onClose}
            />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>표시할 이름</Text>
                <TextInput
                    accessibilityLabel="즐겨찾기 장소 이름"
                    value={sheet.label}
                    editable={!disabled}
                    onChangeText={(label) => onChange({ label })}
                    placeholder="예: 회사, 헬스장"
                    placeholderTextColor={colors.inputPlaceholder}
                    style={[
                        styles.editorInput,
                        { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.textPrimary },
                    ]}
                />

                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>즐겨찾기 카테고리</Text>
                <View style={styles.choiceWrap}>
                    <ChoiceChip
                        label="미분류"
                        selected={!sheet.categoryId}
                        color="#64748B"
                        textColor={colors.textPrimary}
                        disabled={disabled}
                        onPress={() => onChange({ categoryId: undefined })}
                    />
                    {categories.map((category) => (
                        <ChoiceChip
                            key={category.id ?? category.name}
                            label={getFavoritePlaceCategoryDisplayName(category.name)}
                            selected={sheet.categoryId === category.id}
                            color={category.color}
                            textColor={colors.textPrimary}
                            disabled={disabled || !category.id}
                            onPress={() => onChange({ categoryId: category.id })}
                        />
                    ))}
                </View>
                {categories.length === 0 ? (
                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>카테고리는 내 장소 화면 상단에서 만들 수 있습니다.</Text>
                ) : null}

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="즐겨찾기 저장"
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={onSave}
                    style={({ pressed }) => [styles.editorSaveButton, { opacity: pressed || disabled ? 0.6 : 1 }]}
                >
                    {disabled ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="checkmark" size={20} color="#FFFFFF" />}
                    <Text style={styles.editorSaveText}>저장</Text>
                </Pressable>
            </ScrollView>
        </>
    );
}

function CategoryEditor({
    categoryId,
    name,
    color,
    disabled,
    colors,
    onChange,
    onSave,
    onClose,
}: {
    categoryId?: string;
    name: string;
    color: string;
    disabled: boolean;
    colors: ReturnType<typeof useTheme>["colors"];
    onChange: (updates: { name?: string; color?: string }) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        <>
            <SheetHeader
                title={categoryId ? "카테고리 수정" : "새 카테고리"}
                caption="즐겨찾기를 모아볼 탭의 이름과 색상이에요"
                colors={colors}
                disabled={disabled}
                onClose={onClose}
            />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>카테고리 이름</Text>
                <TextInput
                    autoFocus
                    accessibilityLabel="즐겨찾기 카테고리 이름"
                    value={name}
                    editable={!disabled}
                    maxLength={24}
                    onChangeText={(nextName) => onChange({ name: nextName })}
                    placeholder="예: 회사, 운동, 가족"
                    placeholderTextColor={colors.inputPlaceholder}
                    style={[
                        styles.editorInput,
                        { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.textPrimary },
                    ]}
                />
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>카테고리 색상</Text>
                <View style={styles.colorChoices}>
                    {CATEGORY_COLORS.map((candidate) => {
                        const selected = candidate === color;
                        return (
                            <Pressable
                                key={candidate}
                                accessibilityRole="radio"
                                accessibilityLabel={`색상 ${candidate}`}
                                accessibilityState={{ checked: selected, disabled }}
                                disabled={disabled}
                                onPress={() => onChange({ color: candidate })}
                                style={({ pressed }) => [
                                    styles.colorChoice,
                                    {
                                        backgroundColor: candidate,
                                        borderColor: selected ? colors.textPrimary : "transparent",
                                        opacity: pressed || disabled ? 0.55 : 1,
                                    },
                                ]}
                            >
                                {selected ? <Ionicons name="checkmark" size={20} color="#FFFFFF" /> : null}
                            </Pressable>
                        );
                    })}
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="즐겨찾기 카테고리 저장"
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={onSave}
                    style={({ pressed }) => [styles.editorSaveButton, { opacity: pressed || disabled ? 0.6 : 1 }]}
                >
                    {disabled ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="checkmark" size={20} color="#FFFFFF" />}
                    <Text style={styles.editorSaveText}>저장</Text>
                </Pressable>
            </ScrollView>
        </>
    );
}

function ChoiceChip({
    label,
    selected,
    color,
    textColor,
    disabled,
    onPress,
}: {
    label: string;
    selected: boolean;
    color: string;
    textColor: string;
    disabled: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.choiceChip,
                {
                    borderColor: selected ? color : "rgba(120,120,128,0.24)",
                    backgroundColor: selected ? `${color}1F` : "transparent",
                    opacity: pressed || disabled ? 0.55 : 1,
                },
            ]}
        >
            <View style={[styles.colorDot, { backgroundColor: color }]} />
            <Text style={[styles.choiceChipText, { color: textColor }]}>{label}</Text>
            {selected ? <Ionicons name="checkmark" size={15} color={color} /> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: {
        minHeight: 76,
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    headerButtonGlass: { width: 44, height: 44, borderRadius: 22, borderWidth: 1 },
    headerButton: { flex: 1, alignItems: "center", justifyContent: "center" },
    headerTitleWrap: { flex: 1, minWidth: 0, alignItems: "center" },
    headerTitle: { fontSize: 18, fontWeight: "900" },
    headerCaption: { marginTop: 2, fontSize: 10, fontWeight: "700" },
    content: { paddingHorizontal: 18, paddingTop: 10, gap: 26 },
    section: { gap: 10 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
    sectionTitle: { paddingHorizontal: 2, fontSize: 12, fontWeight: "900" },
    sectionCaption: { marginTop: 3, paddingHorizontal: 2, fontSize: 11, fontWeight: "700" },
    selectedCategoryTitle: { paddingHorizontal: 2, fontSize: 20, fontWeight: "900" },
    flexText: { flex: 1, minWidth: 0 },
    errorCard: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 11 },
    categoryTabs: { gap: 8, paddingRight: 4 },
    categoryTab: { position: "relative", minHeight: 48, maxWidth: 190, paddingHorizontal: 10, borderWidth: 1, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 7, overflow: "hidden" },
    categoryTabMark: { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    categoryTabDot: { width: 10, height: 10, borderRadius: 5 },
    categoryTabLabel: { maxWidth: 94, fontSize: 13, fontWeight: "900" },
    categoryTabCount: { minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    categoryTabCountText: { fontSize: 10, fontWeight: "900" },
    categoryTabIndicator: { position: "absolute", left: 10, right: 10, bottom: 2, height: 2, borderRadius: 999 },
    addCategoryTab: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderStyle: "dashed", borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 4 },
    addCategoryTabText: { color: "#2563EB", fontSize: 12, fontWeight: "900" },
    categoryManageBar: { minHeight: 52, paddingHorizontal: 11, borderWidth: 1, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 8 },
    categoryManageText: { flex: 1, fontSize: 11, fontWeight: "800" },
    defaultCard: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 14 },
    placeMainRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    placeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    defaultName: { flexShrink: 1, fontSize: 18, fontWeight: "900" },
    cardTitle: { flexShrink: 1, fontSize: 15, fontWeight: "900" },
    cardCaption: { marginTop: 3, fontSize: 12, lineHeight: 17, fontWeight: "700" },
    badgeRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    defaultBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(37,99,235,0.13)" },
    defaultBadgeText: { color: "#2563EB", fontSize: 10, fontWeight: "900" },
    defaultUsageText: { fontSize: 11, fontWeight: "800" },
    defaultActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
    secondaryButton: { minHeight: 38, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    secondaryButtonText: { fontSize: 13, fontWeight: "900" },
    emptyDefaultContent: { paddingVertical: 8, alignItems: "center" },
    emptyDefaultIcon: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
    emptyDefaultTitle: { marginTop: 13, fontSize: 18, fontWeight: "900" },
    emptyDefaultCaption: { marginTop: 6, maxWidth: 310, textAlign: "center", fontSize: 12, lineHeight: 18, fontWeight: "700" },
    primaryButton: { marginTop: 16, minHeight: 44, paddingHorizontal: 18, borderRadius: 14, backgroundColor: "#2563EB", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
    smallAddButton: { minHeight: 36, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "rgba(37,99,235,0.10)", flexDirection: "row", alignItems: "center", gap: 3 },
    smallAddButtonText: { color: "#2563EB", fontSize: 12, fontWeight: "900" },
    emptyListCard: { minHeight: 122, borderWidth: 1, borderRadius: 18, padding: 20, alignItems: "center", justifyContent: "center" },
    emptyListTitle: { marginTop: 9, fontSize: 15, fontWeight: "900" },
    placeCard: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingTop: 14, overflow: "hidden" },
    categoryPillRow: { marginTop: 7, flexDirection: "row", alignItems: "center", gap: 5 },
    colorDot: { width: 9, height: 9, borderRadius: 5 },
    categoryPillText: { fontSize: 11, fontWeight: "800" },
    cardToolbar: { minHeight: 48, marginTop: 13, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    reorderButtons: { flexDirection: "row", gap: 7 },
    cardActions: { flexDirection: "row", gap: 7 },
    iconAction: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    categoryCard: { minHeight: 70, borderWidth: 1, borderRadius: 17, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    categoryIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    categoryLargeDot: { width: 16, height: 16, borderRadius: 8 },
    categoryActions: { flexDirection: "row", gap: 5 },
    busyOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "flex-end", paddingBottom: 34 },
    busyPill: { minHeight: 48, paddingHorizontal: 17, borderRadius: 24, flexDirection: "row", alignItems: "center", gap: 9, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
    busyText: { fontSize: 13, fontWeight: "900" },
    sheetRoot: { flex: 1 },
    sheetHeader: { minHeight: 78, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 14 },
    sheetTitle: { fontSize: 21, fontWeight: "900" },
    sheetCaption: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: "700" },
    sheetClose: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    sheetContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 44, gap: 24 },
    sheetSection: { gap: 10 },
    sheetSectionTitle: { fontSize: 12, fontWeight: "900" },
    sheetPlaceRow: { minHeight: 66, borderWidth: 1, borderRadius: 15, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 11 },
    selectedText: { color: "#2563EB", fontSize: 11, fontWeight: "900" },
    searchBar: { height: 54, borderWidth: 1, borderRadius: 15, paddingLeft: 14, paddingRight: 5, flexDirection: "row", alignItems: "center", gap: 8 },
    searchInput: { flex: 1, height: "100%", fontSize: 15, fontWeight: "700" },
    searchButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center" },
    searchResult: { minHeight: 72, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 11 },
    searchResultIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    searchGuide: { minHeight: 150, alignItems: "center", justifyContent: "center" },
    searchGuideText: { marginTop: 9, fontSize: 12, fontWeight: "700" },
    editorContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 44 },
    inputLabel: { marginBottom: 8, fontSize: 12, fontWeight: "900" },
    editorInput: { height: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, fontWeight: "700", marginBottom: 24 },
    choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choiceChip: { minHeight: 39, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 6 },
    choiceChipText: { fontSize: 13, fontWeight: "800" },
    helperText: { marginTop: 10, fontSize: 11, lineHeight: 16, fontWeight: "700" },
    editorSaveButton: { marginTop: 32, height: 52, borderRadius: 15, backgroundColor: "#2563EB", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
    editorSaveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
    colorChoices: { flexDirection: "row", flexWrap: "wrap", gap: 13 },
    colorChoice: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: "center", justifyContent: "center" },
});
