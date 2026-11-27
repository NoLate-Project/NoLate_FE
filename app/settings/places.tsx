import styles from "../../src/routeSupport/settings/places.styles";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Platform,
    Animated,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import Reanimated, { FadeIn, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import {
    DEFAULT_ADDRESS_FAVORITE_TAB_ID,
    UNCATEGORIZED_FAVORITE_TAB_ID,
    getFavoritePlaceCategoryDisplayName,
} from "../../src/modules/schedule/favoritePlaceSelection";
import type { FavoritePlace } from "../../src/api/favoritePlaces";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import BrandedLoader, { BrandedLoadingState } from "../../src/ui/BrandedLoader";
import {
    CategoryEditor,
    CategoryTab,
    IconAction,
    PlaceEditor,
    SearchSheet,
} from "../../src/routeSupport/settings/PlacesSettingsComponents";
import { usePlacesSettings } from "../../src/routeSupport/settings/usePlacesSettings";
import { useScreenFirstPaintPerformance } from "../../src/modules/performance/useScreenFirstPaintPerformance";
import { useImmediateNavigationTransition } from "../../src/modules/performance/ImmediateNavigationTransition";
import { usePreMountedSceneActivity } from "../../src/modules/performance/preMountedSceneActivity";

const placeActionsEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const placeReorder = LinearTransition.duration(180).reduceMotion(ReduceMotion.System);

export default function PlacesSettingsScreen() {
    useScreenFirstPaintPerformance('/settings/places');
    const largeText = useWindowDimensions().fontScale > 1.35;
    const [expandedPlaceKey, setExpandedPlaceKey] = useState<string | null>(null);
    const placeOptions = useRef(new Map<string, React.ElementRef<typeof Pressable>>());
    const returnPlaceKey = useRef<string | null>(null);
    const { closeActiveScene, getPreviousSceneRoute, runWithTransitionShell } = useImmediateNavigationTransition();
    const { from } = useLocalSearchParams<{ from?: string }>();
    const sceneActive = usePreMountedSceneActivity();
    const returnsToSearch = sceneActive === undefined
        ? from === "route-search"
        : sceneActive && getPreviousSceneRoute() === "/schedule/route-select";
    const {
        router,
        insets,
        colors,
        mode,
        favorites,
        categories,
        defaultOrigin,
        loading,
        refreshing,
        pullRefreshing,
        loadError,
        busyKey,
        sheet,
        setSheet,
        searchQuery,
        changeSearchQuery,
        closeSheet,
        searchResults,
        searchCompleted,
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
    } = usePlacesSettings();
    const restorePlaceFocus = useCallback(() => {
        const key = returnPlaceKey.current;
        returnPlaceKey.current = null;
        const node = key ? placeOptions.current.get(key) : null;
        if (node) AccessibilityInfo.sendAccessibilityEvent?.(node, "focus");
    }, []);
    const reorderPlace = async (key: string, list: FavoritePlace[], index: number, offset: -1 | 1) => {
        if (!await moveFavorite(list, index, offset)) return;
        const options = placeOptions.current.get(key);
        if (options) AccessibilityInfo.sendAccessibilityEvent?.(options, "focus");
    };
    useEffect(() => {
        if (sheet || Platform.OS === "ios") return;
        const frame = requestAnimationFrame(restorePlaceFocus);
        return () => cancelAnimationFrame(frame);
    }, [restorePlaceFocus, sheet]);
    const goBack = useCallback(() => {
        if (closeActiveScene()) return;
        if (returnsToSearch && router.canGoBack()) {
            router.back();
            return;
        }
        runWithTransitionShell(
            {
                route: "/profile",
                title: "프로필",
                backAccessibilityLabel: "일정 목록으로 돌아가기",
            },
            () => router.canGoBack() ? router.back() : router.replace("/profile"),
        );
    }, [closeActiveScene, returnsToSearch, router, runWithTransitionShell]);

    const anyBusy = busyKey !== null;
    const placeEditor = sheet?.kind === "categoryEditor" ? sheet.returnToPlaceEditor : sheet;
    const searchMode = sheet?.kind === "search" ? sheet.mode
        : placeEditor?.kind === "placeEditor" && placeEditor.fromSearch ? "favorite" : undefined;
    const standardDarkAppearance = !largeText && mode === "dark";
    const placeActionColor = standardDarkAppearance ? "#9DC2FF" : "#2563EB";
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
    const showingDefault = selectedCategoryKey === DEFAULT_ADDRESS_FAVORITE_TAB_ID;
    const standardDefault = showingDefault && !largeText;
    const showDefaultSetup = standardDefault && !defaultOrigin;
    const defaultPlaceKey = defaultOrigin?.id ? `default:${defaultOrigin.id}` : undefined;

    const renderPlaceOptions = (key: string, name: string) => {
        const expanded = expandedPlaceKey === key;
        return (
            <Pressable
                ref={node => {
                    if (node) placeOptions.current.set(key, node);
                    else placeOptions.current.delete(key);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${name} 장소 옵션`}
                accessibilityState={{ expanded }}
                onPress={() => setExpandedPlaceKey(expanded ? null : key)}
                style={({ pressed }) => [styles.iconAction, {
                    backgroundColor: expanded ? "rgba(37,99,235,0.12)" : colors.surface2,
                    opacity: pressed ? 0.65 : 1,
                }]}
            >
                <Ionicons accessible={false} name="ellipsis-horizontal-outline" size={21} color={expanded ? placeActionColor : colors.textSecondary} />
            </Pressable>
        );
    };

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
                        accessibilityLabel={returnsToSearch ? "장소 검색으로 돌아가기" : "프로필로 돌아가기"}
                        onPress={goBack}
                        style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>
                <View style={styles.headerTitleWrap}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.headerTitle, { color: colors.textPrimary }]}>내 장소</Text>
                </View>
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.headerButtonGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="내 장소 새로고침"
                        accessibilityState={{ disabled: loading || refreshing }}
                        disabled={loading || refreshing}
                        onPress={() => refresh("toolbar")}
                        style={({ pressed }) => [styles.headerButton, { opacity: pressed || loading || refreshing ? 0.5 : 1 }]}
                    >
                        {refreshing
                            ? <BrandedLoader size="inline" accessibilityLabel="내 장소 새로고침 중" />
                            : <Ionicons name="refresh-outline" size={20} color={colors.textPrimary} />}
                    </Pressable>
                </CalendarGlassSurface>
            </View>

            {loading ? (
                <BrandedLoadingState
                    fill
                    size="section"
                    variant="auth"
                    title="내 장소를 불러오고 있어요"
                    accessibilityLabel="내 장소를 불러오고 있어요"
                />
            ) : <ScrollView
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={() => refresh("pull")} tintColor="transparent" />}
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
                            <Text maxFontSizeMultiplier={1.8} style={[styles.sectionTitle, { color: colors.textSecondary }]}>즐겨찾기 카테고리</Text>
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
                                    ? "home-outline"
                                    : tab.kind === "uncategorized"
                                        ? "albums-outline"
                                        : undefined}
                                colors={colors}
                                disabled={anyBusy}
                                reduceMotionEnabled={reduceMotionEnabled}
                                onPress={() => {
                                    if (tab.id !== selectedCategoryKey) setExpandedPlaceKey(null);
                                    selectCategoryKey(tab.id);
                                }}
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
                            <Ionicons name="add-outline" size={18} color={placeActionColor} />
                            <Text style={[styles.addCategoryTabText, { color: placeActionColor }]}>카테고리</Text>
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
                            <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.selectedCategoryTitle, { color: colors.textPrimary }]}>
                                {showingDefault ? "기본주소" : "저장한 장소"}
                            </Text>
                            {standardDefault ? (
                                <Text style={[styles.defaultSetupHint, { color: colors.textSecondary }]}>
                                    일정의 출발지로 자동 사용해요
                                </Text>
                            ) : null}
                        </View>
                        {selectedCategoryKey !== DEFAULT_ADDRESS_FAVORITE_TAB_ID ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${selectedCategoryTitle}에 새 장소 추가`}
                                disabled={anyBusy}
                                onPress={() => openSearch("favorite")}
                                style={({ pressed }) => [styles.smallAddButton, { opacity: pressed || anyBusy ? 0.55 : 1 }]}
                            >
                                <Ionicons name="add-outline" size={17} color={placeActionColor} />
                                <Text maxFontSizeMultiplier={1.65} style={[styles.smallAddButtonText, { color: placeActionColor }]}>장소 추가</Text>
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
                                    icon="arrow-back-outline"
                                    disabled={selectedCategoryIndex <= 0 || anyBusy}
                                    colors={colors}
                                    onPress={() => void moveCategory(selectedCategoryIndex, -1)}
                                />
                                <IconAction
                                    label={`${selectedCategoryTitle} 카테고리 오른쪽으로 이동`}
                                    icon="arrow-forward-outline"
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
                                    borderColor: defaultOrigin && largeText ? "#2563EB" : colors.border,
                                    backgroundColor: colors.surface,
                                },
                            ]}
                        >
                            {defaultOrigin ? (
                                <>
                                    <View style={styles.placeMainRow}>
                                        <View style={[styles.placeIcon, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                                            <Ionicons name="home-outline" size={22} color="#2563EB" />
                                        </View>
                                        <View style={styles.flexText}>
                                            <View style={styles.badgeRow}>
                                                <Text numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[standardDefault ? styles.cardTitle : styles.defaultName, { color: colors.textPrimary }]}>
                                                    {defaultOrigin.name ?? "기본주소"}
                                                </Text>
                                                {!standardDefault ? (
                                                    <View style={styles.defaultBadge}>
                                                        <Text style={styles.defaultBadgeText}>사용 중</Text>
                                                    </View>
                                                ) : null}
                                            </View>
                                            <Text numberOfLines={largeText ? undefined : 2} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.cardCaption, { color: colors.textSecondary }]}>
                                                {defaultOrigin.address ?? "주소 정보 없음"}
                                            </Text>
                                        </View>
                                        {standardDefault && defaultPlaceKey
                                            ? renderPlaceOptions(defaultPlaceKey, defaultOrigin.name ?? "기본주소")
                                            : null}
                                    </View>
                                    {standardDefault ? (
                                        <View style={[styles.defaultBadge, styles.defaultActiveBadge]}>
                                            <Ionicons accessible={false} name="checkmark-outline" size={13} color={mode === "dark" ? "#9DC2FF" : "#2563EB"} />
                                            <Text style={[styles.defaultBadgeText, mode === "dark" && styles.defaultActiveBadgeDarkText]}>
                                                기본주소로 사용 중
                                            </Text>
                                        </View>
                                    ) : null}
                                    {(!standardDefault || (defaultPlaceKey && expandedPlaceKey === defaultPlaceKey)) ? (
                                        <Reanimated.View
                                            entering={standardDefault && !reduceMotionEnabled ? placeActionsEntry : undefined}
                                            style={[styles.cardToolbar, { borderTopColor: colors.border }]}
                                        >
                                            {!standardDefault ? (
                                                <Text style={[styles.defaultUsageText, { color: colors.textSecondary }]}>일정 출발지로 자동 입력</Text>
                                            ) : null}
                                            <View style={styles.cardActions}>
                                                <IconAction
                                                    label={`${defaultOrigin.name ?? "기본주소"} 수정`}
                                                    visibleLabel={standardDefault ? "수정" : undefined}
                                                    icon="pencil-outline"
                                                    disabled={!defaultOrigin.id || anyBusy}
                                                    colors={colors}
                                                    onPress={() => {
                                                        if (standardDefault && defaultPlaceKey) returnPlaceKey.current = defaultPlaceKey;
                                                        openFavoriteEditor(defaultOrigin);
                                                    }}
                                                />
                                                <IconAction
                                                    label={`${defaultOrigin.name ?? "기본주소"} 즐겨찾기에서 삭제`}
                                                    visibleLabel={standardDefault ? "삭제" : undefined}
                                                    icon="trash-outline"
                                                    destructive
                                                    disabled={!defaultOrigin.id || anyBusy}
                                                    colors={colors}
                                                    onPress={() => deleteFavorite(defaultOrigin)}
                                                />
                                            </View>
                                        </Reanimated.View>
                                    ) : null}
                                    <View style={standardDefault ? styles.defaultActiveActions : styles.defaultActions}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="기본주소 변경"
                                            disabled={anyBusy}
                                            onPress={() => openSearch("default")}
                                            style={({ pressed }) => [
                                                styles.secondaryButton,
                                                standardDefault && styles.defaultActiveAction,
                                                {
                                                    borderColor: colors.border,
                                                    opacity: pressed || anyBusy ? 0.55 : 1,
                                                    backgroundColor: standardDefault ? colors.surface2 : undefined,
                                                },
                                            ]}
                                        >
                                            <Ionicons name={standardDefault ? "refresh-outline" : "swap-horizontal-outline"} size={17} color={colors.textPrimary} />
                                            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
                                                {standardDefault ? "주소 변경" : "변경"}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="기본주소 해제"
                                            disabled={anyBusy}
                                            onPress={clearDefaultOrigin}
                                            style={({ pressed }) => [
                                                styles.secondaryButton,
                                                standardDefault && styles.defaultActiveAction,
                                                { borderColor: colors.border, opacity: pressed || anyBusy ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons name={standardDefault ? "close-outline" : "close-circle-outline"} size={17} color="#EF4444" />
                                            <Text style={[styles.secondaryButtonText, { color: "#EF4444" }]}>해제</Text>
                                        </Pressable>
                                    </View>
                                </>
                            ) : (
                                <View style={showDefaultSetup ? styles.defaultSetupContent : styles.emptyDefaultContent}>
                                    <View style={showDefaultSetup ? styles.placeMainRow : styles.emptyDefaultSummary}>
                                        <View style={[
                                            styles.emptyDefaultIcon,
                                            showDefaultSetup && styles.defaultSetupIcon,
                                            { backgroundColor: showDefaultSetup ? "rgba(37,99,235,0.10)" : colors.surface2 },
                                        ]}>
                                            <Ionicons name="home-outline" size={showDefaultSetup ? 22 : 26} color="#2563EB" />
                                        </View>
                                        <View style={showDefaultSetup ? styles.flexText : styles.emptyDefaultSummary}>
                                            <Text style={[
                                                showDefaultSetup ? styles.cardTitle : styles.emptyDefaultTitle,
                                                { color: colors.textPrimary },
                                            ]}>
                                                {showDefaultSetup ? "기본주소를 설정하세요" : "기본주소가 아직 없어요"}
                                            </Text>
                                            <Text style={[
                                                showDefaultSetup ? styles.cardCaption : styles.emptyDefaultCaption,
                                                { color: colors.textSecondary },
                                            ]}>
                                                {showDefaultSetup
                                                    ? "자주 출발하는 곳을 저장하면 일정과 경로에 자동으로 입력돼요."
                                                    : "자주 출발하는 장소를 기본주소로 저장하면 일정과 경로 검색에 자동으로 입력됩니다."}
                                            </Text>
                                        </View>
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={showDefaultSetup ? "기본주소 추가" : "기본주소 설정"}
                                        accessibilityHint="즐겨찾기 또는 장소 검색으로 기본주소를 선택합니다"
                                        disabled={anyBusy}
                                        onPress={() => openSearch("default")}
                                        style={({ pressed }) => [styles.primaryButton, { opacity: pressed || anyBusy ? 0.65 : 1 }]}
                                    >
                                        <Ionicons name="add-outline" size={19} color="#FFFFFF" />
                                        <Text style={styles.primaryButtonText}>
                                            {showDefaultSetup ? "기본주소 추가" : "기본주소 설정"}
                                        </Text>
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
                    ) : selectedFavorites.map((favorite, index) => {
                        const key = favorite.id ?? `${favorite.name}-${index}`;
                        const expanded = expandedPlaceKey === key;
                        const name = favorite.name ?? "즐겨찾기 장소";
                        return (
                            <Reanimated.View
                                key={key}
                                layout={reduceMotionEnabled ? undefined : placeReorder}
                                style={[styles.placeCard, { borderColor: colors.border }]}
                            >
                                <View style={[styles.placeMainRow, styles.placeDisclosure]}>
                                    <View style={[styles.placeIcon, { backgroundColor: colors.surface2 }]}>
                                        <Ionicons name="location-outline" size={21} color={colors.textSecondary} />
                                    </View>
                                    <View style={styles.flexText}>
                                        <Text numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.cardTitle, { color: colors.textPrimary }]}>
                                            {name}
                                        </Text>
                                        <Text numberOfLines={largeText ? undefined : 2} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.cardCaption, { color: colors.textSecondary }]}>
                                            {favorite.address ?? "주소 정보 없음"}
                                        </Text>
                                    </View>
                                    {renderPlaceOptions(key, name)}
                                </View>
                                {expanded ? (
                                    <Reanimated.View entering={reduceMotionEnabled ? undefined : placeActionsEntry} style={[styles.expandedPlaceActions, { borderTopColor: colors.border }]}>
                                        <View style={styles.cardActions}>
                                            <IconAction
                                                label={`${name} 기본주소 설정`}
                                                visibleLabel="기본주소 설정"
                                                icon="home-outline"
                                                disabled={!favorite.id || anyBusy}
                                                colors={colors}
                                                onPress={() => chooseFavoriteAsDefault(favorite)}
                                            />
                                            <IconAction
                                                label={`${name} 수정`}
                                                visibleLabel="수정"
                                                icon="pencil-outline"
                                                disabled={!favorite.id || anyBusy}
                                                colors={colors}
                                                onPress={() => {
                                                    returnPlaceKey.current = key;
                                                    openFavoriteEditor(favorite);
                                                }}
                                            />
                                            <IconAction
                                                label={`${name} 삭제`}
                                                visibleLabel="삭제"
                                                icon="trash-outline"
                                                destructive
                                                disabled={!favorite.id || anyBusy}
                                                colors={colors}
                                                onPress={() => deleteFavorite(favorite)}
                                            />
                                        </View>
                                        {largeText || selectedFavorites.length > 1 ? (
                                            <View style={[styles.placeReorderRow, { borderTopColor: colors.border }]}>
                                                <Text style={[styles.placeReorderLabel, { color: colors.textSecondary }]}>목록 순서</Text>
                                                <View style={styles.reorderButtons}>
                                                    <IconAction
                                                        label={`${favorite.name ?? "장소"} 위로 이동`}
                                                        icon="arrow-up-outline"
                                                        disabled={index === 0 || anyBusy}
                                                        colors={colors}
                                                        onPress={() => reorderPlace(key, selectedFavorites, index, -1)}
                                                    />
                                                    <IconAction
                                                        label={`${favorite.name ?? "장소"} 아래로 이동`}
                                                        icon="arrow-down-outline"
                                                        disabled={index === selectedFavorites.length - 1 || anyBusy}
                                                        colors={colors}
                                                        onPress={() => reorderPlace(key, selectedFavorites, index, 1)}
                                                    />
                                                </View>
                                            </View>
                                        ) : null}
                                    </Reanimated.View>
                                ) : null}
                            </Reanimated.View>
                        );
                    })}
                    {showDefaultSetup ? (
                        <Text style={[styles.defaultSetupHint, { color: colors.textSecondary }]}>
                            저장한 장소는 즐겨찾기 탭에서도 관리할 수 있어요.
                        </Text>
                    ) : null}
                </Animated.View>
            </ScrollView>}

            {busyKey ? (
                <View pointerEvents="none" style={styles.busyOverlay}>
                    <View style={[styles.busyPill, { backgroundColor: mode === "dark" ? "#2C2C2E" : "#FFFFFF" }]}>
                        <BrandedLoader size="inline" accessibilityLabel="내 장소 변경사항 저장 중" />
                        <Text style={[styles.busyText, { color: colors.textPrimary }]}>변경사항 저장 중</Text>
                    </View>
                </View>
            ) : null}

            <Modal
                visible={sheet !== null}
                animationType={reduceMotionEnabled ? "none" : "slide"}
                presentationStyle="pageSheet"
                onDismiss={restorePlaceFocus}
                onRequestClose={closeSheet}
            >
                <View style={[
                    styles.sheetRoot,
                    { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 14) },
                    sheet?.kind === "search" && standardDarkAppearance && styles.searchDarkSurface,
                ]}>
                    {searchMode && (
                        <View
                            style={[styles.sheetRoot, sheet?.kind !== "search" && styles.inactiveSearchSheet]}
                            pointerEvents={sheet?.kind === "search" ? "auto" : "none"}
                            accessibilityElementsHidden={sheet?.kind !== "search"}
                            importantForAccessibility={sheet?.kind === "search" ? "auto" : "no-hide-descendants"}
                        >
                            <SearchSheet
                                mode={searchMode}
                                active={sheet?.kind === "search"}
                                standardLayout={!largeText}
                                dark={standardDarkAppearance}
                                query={searchQuery}
                                results={searchResults}
                                searchCompleted={searchCompleted}
                                favorites={favorites}
                                defaultOrigin={defaultOrigin}
                                searching={searching}
                                disabled={anyBusy}
                                colors={colors}
                                onChangeQuery={changeSearchQuery}
                                onSearch={() => void performSearch(!largeText)}
                                onSelectResult={chooseSearchResult}
                                onSelectFavorite={chooseFavoriteAsDefault}
                                onClose={closeSheet}
                            />
                        </View>
                    )}
                    {sheet?.kind === "placeEditor" ? (
                        <PlaceEditor
                            sheet={sheet}
                            categories={categories}
                            standardLayout={!largeText}
                            disabled={anyBusy}
                            colors={colors}
                            onChange={(updates) => setSheet((current) => current?.kind === "placeEditor"
                                ? { ...current, ...updates }
                                : current)}
                            onSave={() => void savePlaceEditor()}
                            onClose={closeSheet}
                            onAddCategory={largeText ? undefined : () => openCategoryEditor()}
                        />
                    ) : sheet?.kind === "categoryEditor" ? (
                        <CategoryEditor
                            categoryId={sheet.categoryId}
                            standardCreate={!largeText && !sheet.categoryId}
                            name={sheet.name}
                            color={sheet.color}
                            disabled={anyBusy}
                            colors={colors}
                            onChange={(updates) => setSheet((current) => current?.kind === "categoryEditor"
                                ? { ...current, ...updates }
                                : current)}
                            onSave={() => void saveCategoryEditor()}
                            onClose={closeSheet}
                        />
                    ) : null}
                </View>
            </Modal>
        </View>
    );
}
