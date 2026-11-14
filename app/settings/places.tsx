import styles from "../../src/routeSupport/settings/places.styles";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
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
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { BrandedLoadingState } from "../../src/ui/BrandedLoader";
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
    } = usePlacesSettings();
    const restorePlaceFocus = useCallback(() => {
        const key = returnPlaceKey.current;
        returnPlaceKey.current = null;
        const node = key ? placeOptions.current.get(key) : null;
        if (node) AccessibilityInfo.sendAccessibilityEvent?.(node, "focus");
    }, []);
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
                        accessibilityLabel={returnsToSearch ? "장소 검색으로 돌아가기" : "프로필로 돌아가기"}
                        onPress={goBack}
                        style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>
                <View style={styles.headerTitleWrap}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.headerTitle, { color: colors.textPrimary }]}>내 장소</Text>
                    <Text maxFontSizeMultiplier={1.65} style={[styles.headerCaption, { color: colors.textSecondary }]}>즐겨찾기를 카테고리별로 관리해요</Text>
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
                        onPress={refresh}
                        style={({ pressed }) => [styles.headerButton, { opacity: pressed || loading || refreshing ? 0.5 : 1 }]}
                    >
                        {refreshing
                            ? <ActivityIndicator size="small" color={colors.textPrimary} />
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
                            <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.selectedCategoryTitle, { color: colors.textPrimary }]}>{selectedCategoryTitle}</Text>
                            <Text maxFontSizeMultiplier={1.8} style={[styles.sectionCaption, { color: colors.textSecondary }]}>{selectedCategoryCaption}</Text>
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
                                <Text maxFontSizeMultiplier={1.65} style={styles.smallAddButtonText}>새 장소</Text>
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
                                                <Text numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.defaultName, { color: colors.textPrimary }]}>
                                                    {defaultOrigin.name ?? "기본주소"}
                                                </Text>
                                                <View style={styles.defaultBadge}>
                                                    <Text style={styles.defaultBadgeText}>사용 중</Text>
                                                </View>
                                            </View>
                                            <Text numberOfLines={largeText ? undefined : 2} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.cardCaption, { color: colors.textSecondary }]}>
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
                    ) : selectedFavorites.map((favorite, index) => {
                        const key = favorite.id ?? `${favorite.name}-${index}`;
                        const expanded = expandedPlaceKey === key;
                        const name = favorite.name ?? "즐겨찾기 장소";
                        return (
                            <Reanimated.View
                                key={key}
                                layout={reduceMotionEnabled ? undefined : placeReorder}
                                style={[styles.placeCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
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
                                        <Ionicons accessible={false} name="ellipsis-horizontal-outline" size={21} color={expanded ? "#2563EB" : colors.textSecondary} />
                                    </Pressable>
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
                                        <View style={styles.placeReorderRow}>
                                            <Text style={[styles.placeReorderLabel, { color: colors.textSecondary }]}>목록 순서</Text>
                                            <View style={styles.reorderButtons}>
                                                <IconAction
                                                    label={`${favorite.name ?? "장소"} 위로 이동`}
                                                    icon="arrow-up-outline"
                                                    disabled={index === 0 || anyBusy}
                                                    colors={colors}
                                                    onPress={() => void moveFavorite(selectedFavorites, index, -1)}
                                                />
                                                <IconAction
                                                    label={`${favorite.name ?? "장소"} 아래로 이동`}
                                                    icon="arrow-down-outline"
                                                    disabled={index === selectedFavorites.length - 1 || anyBusy}
                                                    colors={colors}
                                                    onPress={() => void moveFavorite(selectedFavorites, index, 1)}
                                                />
                                            </View>
                                        </View>
                                    </Reanimated.View>
                                ) : null}
                            </Reanimated.View>
                        );
                    })}
                </Animated.View>
            </ScrollView>}

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
                animationType={reduceMotionEnabled ? "none" : "slide"}
                presentationStyle="pageSheet"
                onDismiss={restorePlaceFocus}
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
