import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
    AccessibilityInfo,
    Animated,
    Keyboard,
    Pressable,
    ScrollView,
    StatusBar,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import Reanimated, {
    Easing,
    FadeIn,
    ReduceMotion,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import BrandedLoader from "../../ui/BrandedLoader";
import {
    DEFAULT_ADDRESS_FAVORITE_TAB_ID,
    findMatchingFavoritePlace,
    getFavoritePlaceCategoryColor,
    getFavoritePlaceCategoryDisplayName,
} from "../../modules/schedule/favoritePlaceSelection";
import styles from "./route-select.styles";
import {
    FavoriteFilterSelectionIndicator,
    Ionicons,
} from "./RouteSelectAnimatedControls";
import { formatSearchResultDistance } from "./routeSelectRouteModel";
import {
    buildPlaceFromSearchItem,
    getPlaceActionKey,
    getPlaceDisplayText,
    resolvePlaceListIcon,
} from "./routeSelectPlaceModel";
import type { RouteSelectController } from "./useRouteSelectController";

type RouteSelectSearchScreenProps = {
    controller: RouteSelectController;
    mapButton: React.Ref<View>;
};

const searchResultsEntrance = FadeIn.duration(120).reduceMotion(ReduceMotion.System);
const targetTabInset = 3;

function SearchFavoriteButton({
    name, saved, saving, disabled, color, onOpen,
}: {
    name: string;
    saved: boolean;
    saving: boolean;
    disabled: boolean;
    color: string;
    onOpen: (restoreFocus: () => void) => void;
}) {
    const button = useRef<React.ElementRef<typeof Pressable>>(null);
    return (
        <Pressable
            ref={button}
            onPress={() => onOpen(() => {
                if (button.current) AccessibilityInfo.sendAccessibilityEvent?.(button.current, "focus");
            })}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={saved ? `${name} 즐겨찾기 수정` : `${name} 즐겨찾기에 저장`}
            accessibilityState={{ disabled, busy: saving }}
            style={({ pressed }) => [styles.searchModeFavoriteButton, pressed && { opacity: 0.55 }]}
        >
            {saving
                ? <BrandedLoader size="button" variant="route" accessibilityLabel="즐겨찾기를 저장하고 있어요" />
                : <Ionicons accessible={false} name={saved ? "pencil-outline" : "star-outline"} size={21} color={color} />}
        </Pressable>
    );
}

/** 출발지·도착지 검색과 최근 장소·즐겨찾기 선택 화면을 표시한다. */
export function RouteSelectSearchScreen({
    controller,
    mapButton,
}: RouteSelectSearchScreenProps) {
    const {
        statusBarStyle,
        insets,
        originText,
        activeTarget,
        isEditingRoutePoint,
        originUsesDefault,
        favoritePlaces,
        favoritePlacesLoaded,
        favoritePlacesError,
        setFavoriteReloadVersion,
        selectedFavoriteFilterId,
        reduceFavoriteMotionEnabled,
        favoriteSavingKey,
        defaultOriginSavingKey,
        favoriteCategories,
        searchResults,
        searchError,
        retryPlaceSearch,
        searching,
        currentLocationPending,
        activeTargetLabel,
        activeSearchText,
        showingSearchResults,
        returnsToScheduleDraft,
        goToScheduleList,
        openPlaceSettings,
        removeRecentPlace,
        favoritePlaceTabs,
        toggleFavoriteFilter,
        handleSearchChange,
        applyPlace,
        applyCurrentLocationToActiveTarget,
        applyRecentPlaceToActiveTarget,
        openMapForPointSelection,
        openRoutePointEditor,
        openFavoriteSaveSheet,
        removePlaceFromFavorites,
        setFavoriteAsDefaultOrigin,
        exitSearchMode,
        editDefaultOrigin,
        visibleFavoritePlaces,
        visibleRecentPlaces,
        favoritePanelAnimatedStyle,
        hasConfiguredDefaultOrigin,
        routeUi,
    } = controller;
    const { fontScale } = useWindowDimensions();
    const searchHeight = Math.max(48, Math.ceil(22 * fontScale + 14));
    const stackLocationActions = fontScale > 1.35;
    const managePlacesButton = useRef<View>(null);
    const returningFromPlaceSettings = useRef(false);
    useFocusEffect(useCallback(() => {
        if (!returningFromPlaceSettings.current) return;
        const frame = requestAnimationFrame(() => {
            returningFromPlaceSettings.current = false;
            if (managePlacesButton.current) AccessibilityInfo.sendAccessibilityEvent?.(managePlacesButton.current, "focus");
        });
        return () => cancelAnimationFrame(frame);
    }, []));
    const targetWithObjectParticle = activeTarget === "origin" ? "출발지를" : "도착지를";
    const [targetTabsWidth, setTargetTabsWidth] = useState(0);
    const targetTabProgress = useSharedValue(activeTarget === "destination" ? 1 : 0);
    const targetTabWidth = Math.max(0, (targetTabsWidth - targetTabInset * 2) / 2);
    useEffect(() => {
        targetTabProgress.value = withTiming(activeTarget === "destination" ? 1 : 0, {
            duration: 180,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
        });
    }, [activeTarget, targetTabProgress]);
    const targetTabIndicator = useAnimatedStyle(() => ({
        transform: [{ translateX: targetTabProgress.value * targetTabWidth }],
    }));
    if (isEditingRoutePoint) {
        const originContext = !showingSearchResults && <>
                {originUsesDefault && activeTarget === "destination" && (
                    <Pressable
                        onPress={editDefaultOrigin}
                        accessibilityRole="button"
                        accessibilityLabel={`기본 출발지 ${originText}, 변경`}
                        style={[
                            styles.defaultOriginBar,
                            stackLocationActions && styles.defaultOriginStacked,
                            { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                        ]}
                    >
                        <Ionicons name="location-outline" size={19} color={routeUi.accentBlue} />
                        <View style={styles.defaultOriginCopy}>
                            <Text style={[styles.defaultOriginLabel, { color: routeUi.textSecondary }]}>기본 출발지</Text>
                            <Text numberOfLines={stackLocationActions ? undefined : 1} style={[styles.defaultOriginName, { color: routeUi.textPrimary }]}>
                                {originText}
                            </Text>
                        </View>
                        <Text style={[styles.defaultOriginAction, stackLocationActions && styles.defaultOriginActionStacked, { color: routeUi.accentBlue }]}>변경</Text>
                    </Pressable>
                )}

                {activeTarget === "origin" && favoritePlacesLoaded && !favoritePlacesError && !hasConfiguredDefaultOrigin && (
                    <Pressable
                        onPress={openPlaceSettings}
                        accessibilityRole="button"
                        accessibilityLabel="기본 출발지 설정"
                        accessibilityHint="내 장소 관리 화면에서 기본 출발지를 설정합니다"
                        style={[
                            styles.defaultOriginSetupBar,
                            stackLocationActions && styles.defaultOriginStacked,
                            { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                        ]}
                    >
                        <View style={[styles.defaultOriginSetupIcon, { backgroundColor: routeUi.surface }]}>
                            <Ionicons name="home-outline" size={19} color={routeUi.accentBlue} />
                        </View>
                        <View style={styles.defaultOriginCopy}>
                            <Text style={[styles.defaultOriginSetupTitle, { color: routeUi.textPrimary }]}>기본 출발지가 없어요</Text>
                            <Text numberOfLines={stackLocationActions ? undefined : 2} style={[styles.defaultOriginSetupDescription, { color: routeUi.textSecondary }]}>
                                자주 출발하는 곳을 저장해요
                            </Text>
                        </View>
                        <Text style={[styles.defaultOriginAction, stackLocationActions && styles.defaultOriginActionStacked, { color: routeUi.accentBlue }]}>설정</Text>
                    </Pressable>
                )}

        </>;
        return (
            <View style={[styles.screen, { backgroundColor: routeUi.background, paddingTop: insets.top + 10 }]}>
                <StatusBar barStyle={statusBarStyle} />
                <View
                    style={[styles.searchTargetTabs, { backgroundColor: routeUi.surface2, padding: targetTabInset }]}
                    onLayout={({ nativeEvent }) => setTargetTabsWidth(nativeEvent.layout.width)}
                    accessibilityRole="tablist"
                >
                    {targetTabWidth > 0 && (
                        <Reanimated.View
                            pointerEvents="none"
                            accessible={false}
                            style={[
                                styles.searchTargetIndicator,
                                { left: targetTabInset, top: targetTabInset, bottom: targetTabInset, width: targetTabWidth,
                                    backgroundColor: routeUi.selectedSurface, borderColor: routeUi.borderStrong },
                                targetTabIndicator,
                            ]}
                        />
                    )}
                    {(["origin", "destination"] as const).map(target => {
                        const selected = activeTarget === target;
                        const label = target === "origin" ? "출발지" : "도착지";
                        return (
                            <Pressable
                                key={target}
                                testID={`route-search-tab-${target}`}
                                accessibilityRole="tab"
                                accessibilityState={{ selected }}
                                accessibilityLabel={label}
                                onPress={() => { if (!selected) openRoutePointEditor(target); }}
                                style={[
                                    styles.searchTargetTab,
                                    selected && targetTabWidth === 0 && { backgroundColor: routeUi.selectedSurface },
                                ]}
                            >
                                <Text style={[styles.searchTargetTabText, { color: selected ? routeUi.textPrimary : routeUi.textSecondary }]}>{label}</Text>
                            </Pressable>
                        );
                    })}
                </View>
                <View style={styles.searchModeHeader}>
                    <Pressable
                        onPress={exitSearchMode}
                        accessibilityRole="button"
                        accessibilityLabel="장소 검색 닫기"
                        style={styles.searchModeBackButton}
                    >
                        <Ionicons name="chevron-back-outline" size={22} color={routeUi.textPrimary} />
                    </Pressable>
                    <View style={[styles.searchModeSearchBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border, height: searchHeight }]}>
                        <TextInput
                            testID="route-search-input"
                            value={activeSearchText}
                            onChangeText={(text) => handleSearchChange(activeTarget, text)}
                            accessibilityLabel={`${activeTargetLabel} 검색`}
                            accessibilityHint="장소 이름이나 주소를 입력하세요"
                            selectionColor={routeUi.accentBlue}
                            returnKeyType="search"
                            onSubmitEditing={() => Keyboard.dismiss()}
                            textContentType="none"
                            autoComplete="off"
                            secureTextEntry={false}
                            style={[styles.searchModeInput, { color: routeUi.textPrimary, height: searchHeight }]}
                        />
                        {!activeSearchText && (
                            <View pointerEvents="none" style={styles.searchModePlaceholder}>
                                <Text accessible={false} numberOfLines={1} style={[styles.searchModePlaceholderText, { color: routeUi.textSecondary }]}>
                                    {stackLocationActions ? `${activeTargetLabel} 검색` : `${activeTargetLabel} 이름 또는 주소`}
                                </Text>
                            </View>
                        )}
                        {!!activeSearchText.trim() && (
                            <Pressable
                                onPress={() => handleSearchChange(activeTarget, "")}
                                accessibilityRole="button"
                                accessibilityLabel={`${activeTargetLabel} 검색어 지우기`}
                                hitSlop={10}
                                style={[styles.searchModeClearButton, { backgroundColor: routeUi.clearButtonBg }]}
                            >
                                <Ionicons name="close-outline" size={17} color={routeUi.clearButtonText} />
                            </Pressable>
                        )}
                    </View>
                    {!returnsToScheduleDraft && (
                        <Pressable
                            onPress={goToScheduleList}
                            accessibilityRole="button"
                            accessibilityLabel="일정 목록으로 이동"
                            style={[styles.scheduleListIconButton,
                                { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                        >
                            <Ionicons name="calendar-outline" size={20} color={routeUi.textPrimary} />
                        </Pressable>
                    )}
                </View>

                <View style={[styles.searchModeActionRow, stackLocationActions && styles.searchModeActionRowStacked]}>
                    <Pressable
                        onPress={applyCurrentLocationToActiveTarget}
                        testID="route-search-current-location"
                        accessibilityRole="button"
                        accessibilityLabel={`${targetWithObjectParticle} 현재 위치로 설정`}
                        accessibilityState={{
                            busy: currentLocationPending,
                            disabled: currentLocationPending,
                        }}
                        disabled={currentLocationPending}
                        style={({ pressed }) => [styles.searchModeActionButton, stackLocationActions && styles.searchModeActionStacked,
                            { backgroundColor: pressed ? routeUi.surface2 : routeUi.surface, borderColor: routeUi.border }]}
                    >
                        {currentLocationPending ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="현재 위치를 확인하고 있어요"
                            />
                        ) : (
                            <Ionicons name="locate-outline" size={22} color={routeUi.accentBlue} />
                        )}
                        <Text style={[styles.searchModeActionText, { color: routeUi.textPrimary }]}>내 위치</Text>
                    </Pressable>
                    <Pressable
                        ref={mapButton}
                        testID="route-search-map-picker"
                        onPress={openMapForPointSelection}
                        accessibilityRole="button"
                        accessibilityLabel={`${targetWithObjectParticle} 지도에서 선택`}
                        style={({ pressed }) => [styles.searchModeActionButton, stackLocationActions && styles.searchModeActionStacked,
                            { backgroundColor: pressed ? routeUi.surface2 : routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="map-outline" size={22} color={routeUi.accentBlue} />
                        <Text style={[styles.searchModeActionText, { color: routeUi.textPrimary }]}>지도에서 선택</Text>
                    </Pressable>
                </View>

                {!stackLocationActions && originContext}

                <ScrollView
                    directionalLockEnabled
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[styles.searchModeContent, { paddingBottom: Math.max(insets.bottom + 24, 36) }]}
                >
                    {stackLocationActions && originContext}
                    <View style={[styles.searchModeSectionHeader, stackLocationActions && styles.searchModeSectionHeaderStacked, { borderBottomColor: routeUi.border }]}>
                        <Text maxFontSizeMultiplier={1.8} style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>
                            {showingSearchResults ? "검색 결과" : "즐겨찾기"}
                        </Text>
                        {(!showingSearchResults || !stackLocationActions) && <Pressable
                            ref={managePlacesButton}
                            onPress={() => {
                                returningFromPlaceSettings.current = !stackLocationActions;
                                openPlaceSettings();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="내 장소 관리"
                            style={[styles.favoriteManageButton, stackLocationActions && styles.favoriteManageButtonStacked]}
                        >
                            <Ionicons name="options-outline" size={15} color={routeUi.accentBlue} />
                            <Text maxFontSizeMultiplier={1.8} style={[styles.searchModeEditText, { color: routeUi.accentBlue }]}>내 장소 관리</Text>
                        </Pressable>}
                    </View>
                    {showingSearchResults ? (
                        <View style={styles.searchModePanel}>
                            {searching && (
                                <View style={styles.searchingRow}>
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="주소를 검색하고 있어요"
                                    />
                                    <Text style={[styles.searchingText, { color: routeUi.textSecondary }]}>주소 검색 중...</Text>
                                </View>
                            )}
                            {!searching && searchError && (
                                <View style={styles.searchModeEmptyRow} accessibilityLiveRegion="polite">
                                    <Text style={[
                                        stackLocationActions ? styles.recentEmptyText : styles.placeSearchStatusTitle,
                                        { color: stackLocationActions ? routeUi.textSecondary : routeUi.textPrimary },
                                    ]}>
                                        {stackLocationActions
                                            ? "주소 검색에 실패했습니다. 네트워크를 확인해 주세요."
                                            : "장소를 불러오지 못했어요"}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="주소 다시 검색"
                                        accessibilityHint="입력한 검색어로 다시 검색합니다"
                                        onPress={retryPlaceSearch}
                                        style={[
                                            styles.emptyRetryButton,
                                            !stackLocationActions && styles.placeSearchRetry,
                                            { backgroundColor: stackLocationActions ? routeUi.accentBlue : routeUi.surface2 },
                                        ]}
                                    >
                                        <Ionicons name="refresh-outline" size={15} color={stackLocationActions ? "#FFFFFF" : routeUi.textPrimary} />
                                        <Text style={[styles.emptyRetryText, !stackLocationActions && { color: routeUi.textPrimary }]}>다시 검색</Text>
                                    </Pressable>
                                </View>
                            )}
                            {!searching && !searchError && searchResults.length === 0 && (
                                <View style={styles.searchModeEmptyRow} accessibilityLiveRegion="polite">
                                    <Text style={[
                                        stackLocationActions ? styles.recentEmptyText : styles.placeSearchStatusTitle,
                                        { color: stackLocationActions ? routeUi.textSecondary : routeUi.textPrimary },
                                    ]}>
                                        {stackLocationActions ? "검색 결과가 없습니다." : "검색 결과가 없어요"}
                                    </Text>
                                    {!stackLocationActions && (
                                        <Text style={[styles.searchingText, { color: routeUi.textSecondary }]}>
                                            장소명이나 주소를 바꿔 보세요.
                                        </Text>
                                    )}
                                </View>
                            )}
                            {searchResults.length > 0 && (
                                <Reanimated.View entering={searchResultsEntrance}>
                                    {searchResults.slice(0, 10).map((item, index) => {
                                        const resultPlace = buildPlaceFromSearchItem(item);
                                        const resultIcon = resolvePlaceListIcon({ ...resultPlace, category: item.category });
                                        const savingKey = getPlaceActionKey(resultPlace);
                                        const isSaving = favoriteSavingKey === savingKey;
                                        const savedFavorite = findMatchingFavoritePlace(resultPlace, favoritePlaces);
                                        const distance = formatSearchResultDistance(item.distanceMeters);
                                        const address = item.address?.trim();
                                        const category = item.category?.split(/[>＞]/).map(part => part.trim()).filter(Boolean).at(-1);
                                        const description = address || category || "주소 정보 없음";

                                        return (
                                            <View
                                                key={`${item.lat}:${item.lng}:${index}`}
                                                style={[
                                                    styles.searchModeResultRow,
                                                    { borderColor: routeUi.border },
                                                ]}
                                            >
                                                <Pressable
                                                    onPress={() => applyPlace(activeTarget, item)}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={[item.name, description, distance].filter(Boolean).join(", ")}
                                                    style={({ pressed }) => [styles.searchModeResultMain, pressed && { backgroundColor: routeUi.surface2 }]}
                                                >
                                                    <View style={[styles.searchModeListIcon, { backgroundColor: routeUi.surface2 }]}>
                                                        <Ionicons name={resultIcon} size={18} color={routeUi.textSecondary} />
                                                    </View>
                                                    <View style={styles.searchModeResultTextWrap}>
                                                        <Text numberOfLines={stackLocationActions ? undefined : 2} style={[styles.searchResultTitle, { color: routeUi.textPrimary }]}>
                                                            {item.name}
                                                        </Text>
                                                    <Text numberOfLines={stackLocationActions ? undefined : 2} style={[styles.searchResultAddress, { color: routeUi.textSecondary }]}>
                                                        {[description, stackLocationActions ? undefined : distance].filter(Boolean).join(" · ")}
                                                        </Text>
                                                    </View>
                                                </Pressable>
                                                <SearchFavoriteButton
                                                    name={item.name}
                                                    saved={!!savedFavorite}
                                                    saving={isSaving}
                                                    disabled={!!favoriteSavingKey}
                                                    color={savedFavorite ? routeUi.accentBlue : routeUi.textSecondary}
                                                    onOpen={restoreFocus => openFavoriteSaveSheet(resultPlace, savedFavorite, restoreFocus)}
                                                />
                                            </View>
                                        );
                                    })}
                                </Reanimated.View>
                            )}
                        </View>
                    ) : (
                        <View style={styles.searchModePanel}>
                            {!!favoritePlacesError && (
                                <View
                                    style={[
                                        styles.favoriteLoadErrorRow,
                                        { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                                    ]}
                                >
                                    <Text style={[styles.favoriteLoadErrorText, { color: routeUi.textSecondary }]}>
                                        {favoritePlacesError}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="즐겨찾기 다시 불러오기"
                                        hitSlop={6}
                                        onPress={() => setFavoriteReloadVersion((current) => current + 1)}
                                        style={[
                                            styles.favoriteRetryButton,
                                            { backgroundColor: routeUi.surface, borderColor: routeUi.borderStrong },
                                        ]}
                                    >
                                        <Ionicons name="refresh-outline" size={14} color={routeUi.accentBlue} />
                                        <Text style={[styles.favoriteRetryText, { color: routeUi.accentBlue }]}>다시 시도</Text>
                                    </Pressable>
                                </View>
                            )}
                            <ScrollView
                                horizontal
                                directionalLockEnabled
                                keyboardShouldPersistTaps="handled"
                                showsHorizontalScrollIndicator={false}
                                style={styles.favoriteFilterScroll}
                                contentContainerStyle={styles.favoriteFilterContent}
                            >
                                {favoritePlaceTabs.map((tab) => {
                                    const selected = selectedFavoriteFilterId === tab.id;
                                    const tabLabel = tab.kind === "default-address" ? "기본 주소" : tab.name;
                                    const tabColor = tab.kind === "default-address"
                                        ? routeUi.accentBlue
                                        : tab.color ?? routeUi.textSecondary;
                                    return (
                                    <Pressable
                                        key={tab.id}
                                        onPress={() => toggleFavoriteFilter(tab.id)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${tabLabel} 즐겨찾기`}
                                        accessibilityHint={selected
                                            ? "다시 누르면 장소 목록을 접습니다"
                                            : "누르면 장소 목록을 펼칩니다"}
                                        accessibilityState={{ selected, expanded: selected }}
                                        style={[
                                            styles.favoriteFilterChip,
                                            {
                                                backgroundColor: selected
                                                    ? routeUi.selectedModeBg
                                                    : routeUi.surface2,
                                                borderColor: selected ? tabColor : routeUi.border,
                                            },
                                        ]}
                                    >
                                        {tab.kind === "default-address" ? (
                                            <Ionicons
                                                name="home-outline"
                                                size={14}
                                                color={selected ? routeUi.accentBlue : routeUi.textSecondary}
                                            />
                                        ) : (
                                            <View style={[styles.favoriteCategoryDot, { backgroundColor: tabColor }]} />
                                        )}
                                        <Text style={[
                                            styles.favoriteFilterChipText,
                                            {
                                                color: selected
                                                    ? (tab.kind === "default-address"
                                                        ? routeUi.accentBlue
                                                        : routeUi.textPrimary)
                                                    : routeUi.textSecondary,
                                            },
                                        ]}>
                                            {tabLabel}
                                        </Text>
                                        <FavoriteFilterSelectionIndicator
                                            selected={selected}
                                            color={tabColor}
                                            reduceMotionEnabled={reduceFavoriteMotionEnabled}
                                        />
                                    </Pressable>
                                    );
                                })}
                            </ScrollView>
                            <Animated.View style={[styles.favoritePanelClip, favoritePanelAnimatedStyle]}>
                            {visibleFavoritePlaces.map((place, index) => {
                                const favoriteIcon = place.defaultOrigin ? "home-outline" : resolvePlaceListIcon(place);
                                const isDefaultSaving = defaultOriginSavingKey === getPlaceActionKey(place);
                                const isFavoriteSaving = favoriteSavingKey === getPlaceActionKey(place);
                                const categoryColor = place.defaultOrigin
                                    ? undefined
                                    : getFavoritePlaceCategoryColor(place, favoriteCategories);
                                const categoryName = place.defaultOrigin || !place.categoryName
                                    ? undefined
                                    : getFavoritePlaceCategoryDisplayName(place.categoryName);
                                return (
                                    <View
                                        key={place.id ?? `${place.lat ?? "x"}:${place.lng ?? "x"}:${index}`}
                                        style={[
                                            styles.searchModeRecentRow,
                                            { borderColor: routeUi.border, backgroundColor: routeUi.surface },
                                        ]}
                                    >
                                        <Pressable
                                            onPress={() => applyRecentPlaceToActiveTarget(place)}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${getPlaceDisplayText(place)}, 즐겨찾기 장소 선택`}
                                            style={styles.searchModeRecentMain}
                                        >
                                            <View
                                                style={[
                                                    styles.searchModeListIcon,
                                                    styles.favoriteListIcon,
                                                    {
                                                        backgroundColor: routeUi.surface2,
                                                        borderColor: categoryColor ?? "transparent",
                                                    },
                                                ]}
                                            >
                                                <Ionicons
                                                    name={favoriteIcon}
                                                    size={18}
                                                    color={place.defaultOrigin ? routeUi.accentBlue : routeUi.textSecondary}
                                                />
                                            </View>
                                            <View style={styles.searchModeResultTextWrap}>
                                                <View style={styles.favoriteTitleRow}>
                                                    <Text
                                                        numberOfLines={1}
                                                        style={[styles.recentPlaceTitle, styles.favoriteTitle, { color: routeUi.textPrimary }]}
                                                    >
                                                        {getPlaceDisplayText(place)}
                                                    </Text>
                                                    {place.defaultOrigin && (
                                                        <View style={[styles.defaultOriginBadge, { backgroundColor: routeUi.selectedModeBg }]}>
                                                            <Text style={[styles.defaultOriginBadgeText, { color: routeUi.accentBlue }]}>기본</Text>
                                                        </View>
                                                    )}
                                                </View>
                                                {!!(categoryName || place.address) && (
                                                    <View style={styles.favoriteMetaRow}>
                                                        {!!categoryColor && (
                                                            <View style={[styles.favoriteCategoryDot, { backgroundColor: categoryColor }]} />
                                                        )}
                                                        <Text
                                                            numberOfLines={1}
                                                            style={[styles.recentPlaceAddress, styles.favoriteMetaText, { color: routeUi.textSecondary }]}
                                                        >
                                                            {[categoryName, place.address].filter(Boolean).join(" · ")}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                        </Pressable>
                                        <View style={styles.favoriteRowActions}>
                                            {place.defaultOrigin ? (
                                                <View
                                                    accessibilityRole="image"
                                                    accessibilityLabel={`${getPlaceDisplayText(place)} 기본 출발지`}
                                                    style={styles.searchModeFavoriteButton}
                                                >
                                                    <Ionicons name="home-outline" size={20} color={routeUi.accentBlue} />
                                                </View>
                                            ) : activeTarget === "origin" ? (
                                                <Pressable
                                                    onPress={() => setFavoriteAsDefaultOrigin(place)}
                                                    disabled={Boolean(defaultOriginSavingKey) || Boolean(favoriteSavingKey)}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${getPlaceDisplayText(place)} 기본 출발지로 설정`}
                                                    accessibilityState={{
                                                        disabled: Boolean(defaultOriginSavingKey) || Boolean(favoriteSavingKey),
                                                    }}
                                                    style={styles.searchModeFavoriteButton}
                                                >
                                                    {isDefaultSaving ? (
                                                        <BrandedLoader
                                                            size="button"
                                                            variant="route"
                                                            accessibilityLabel="기본 출발지를 저장하고 있어요"
                                                        />
                                                    ) : (
                                                        <Ionicons name="home-outline" size={20} color={routeUi.textSecondary} />
                                                    )}
                                                </Pressable>
                                            ) : null}
                                            <Pressable
                                                onPress={() => removePlaceFromFavorites(place)}
                                                disabled={Boolean(favoriteSavingKey) || Boolean(defaultOriginSavingKey)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 즐겨찾기 해제`}
                                                accessibilityState={{
                                                    disabled: Boolean(favoriteSavingKey) || Boolean(defaultOriginSavingKey),
                                                }}
                                                style={styles.searchModeFavoriteButton}
                                            >
                                                {isFavoriteSaving ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel="즐겨찾기를 해제하고 있어요"
                                                    />
                                                ) : (
                                                    <Ionicons name="star-outline" size={21} color={routeUi.accentBlue} />
                                                )}
                                            </Pressable>
                                        </View>
                                    </View>
                                );
                            })}
                            {selectedFavoriteFilterId === DEFAULT_ADDRESS_FAVORITE_TAB_ID
                                && favoritePlacesLoaded
                                && !favoritePlacesError
                                && !hasConfiguredDefaultOrigin && (
                                <Pressable
                                    onPress={openPlaceSettings}
                                    accessibilityRole="button"
                                    accessibilityLabel="기본 주소 설정"
                                    accessibilityHint="내 장소 관리 화면에서 기본 주소를 설정합니다"
                                    style={[
                                        styles.defaultOriginSetupBar,
                                        { backgroundColor: routeUi.selectedModeBg, borderColor: routeUi.selectedBorder },
                                    ]}
                                >
                                    <View style={[styles.defaultOriginSetupIcon, { backgroundColor: routeUi.surface }]}>
                                        <Ionicons name="home-outline" size={19} color={routeUi.accentBlue} />
                                    </View>
                                    <View style={styles.defaultOriginCopy}>
                                        <Text style={[styles.defaultOriginSetupTitle, { color: routeUi.textPrimary }]}>기본 주소가 없어요</Text>
                                        <Text numberOfLines={2} style={[styles.defaultOriginSetupDescription, { color: routeUi.textSecondary }]}>
                                            자주 출발하는 장소를 기본 주소로 설정해 보세요
                                        </Text>
                                    </View>
                                    <Text style={[styles.defaultOriginAction, { color: routeUi.accentBlue }]}>설정</Text>
                                </Pressable>
                            )}
                            {!!selectedFavoriteFilterId
                                && visibleFavoritePlaces.length === 0
                                && !favoritePlacesError
                                && (
                                    selectedFavoriteFilterId !== DEFAULT_ADDRESS_FAVORITE_TAB_ID
                                    || !favoritePlacesLoaded
                                ) && (
                                <View style={styles.favoriteEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        {!favoritePlacesLoaded
                                            ? "즐겨찾기를 불러오는 중입니다."
                                            : "이 장소 그룹에 저장된 즐겨찾기가 없습니다."}
                                    </Text>
                                </View>
                            )}
                            </Animated.View>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>최근 검색</Text>
                            </View>
                            {visibleRecentPlaces.length > 0 ? (
                                visibleRecentPlaces.map((place, index) => {
                                    const recentIcon = resolvePlaceListIcon(place);
                                    const savedFavorite = findMatchingFavoritePlace(place, favoritePlaces);
                                    const savingKey = getPlaceActionKey(place);
                                    const isSaving = favoriteSavingKey === savingKey;

                                    return (
                                        <View
                                            key={`${place.lat ?? "x"}:${place.lng ?? "x"}:${place.name ?? ""}:${index}`}
                                            style={[
                                                styles.searchModeRecentRow,
                                                { borderColor: routeUi.border, backgroundColor: routeUi.surface },
                                            ]}
                                        >
                                            <Pressable
                                                onPress={() => applyRecentPlaceToActiveTarget(place)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)}, 최근 장소 선택`}
                                                style={styles.searchModeRecentMain}
                                            >
                                                <View style={[styles.searchModeListIcon, { backgroundColor: routeUi.surface2 }]}>
                                                    <Ionicons name={recentIcon} size={18} color={routeUi.textSecondary} />
                                                </View>
                                                <View style={styles.searchModeResultTextWrap}>
                                                    <Text numberOfLines={1} style={[styles.recentPlaceTitle, { color: routeUi.textPrimary }]}>
                                                        {getPlaceDisplayText(place)}
                                                    </Text>
                                                    {!!place.address && (
                                                        <Text numberOfLines={1} style={[styles.recentPlaceAddress, { color: routeUi.textSecondary }]}>
                                                            {place.address}
                                                        </Text>
                                                    )}
                                                </View>
                                            </Pressable>
                                            <SearchFavoriteButton
                                                name={getPlaceDisplayText(place)}
                                                saved={!!savedFavorite}
                                                saving={isSaving}
                                                disabled={!!favoriteSavingKey}
                                                color={savedFavorite ? routeUi.accentBlue : routeUi.textSecondary}
                                                onOpen={restoreFocus => openFavoriteSaveSheet(place, savedFavorite, restoreFocus)}
                                            />
                                            <Pressable
                                                onPress={() => removeRecentPlace(place)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 최근 검색에서 삭제`}
                                                style={styles.searchModeRemoveButton}
                                            >
                                                <Ionicons name="close-outline" size={20} color={routeUi.textSecondary} />
                                            </Pressable>
                                        </View>
                                    );
                                })
                            ) : (
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        최근 검색 내역이 없습니다.
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}
                </ScrollView>
            </View>
        );
    }

    return null;
}
