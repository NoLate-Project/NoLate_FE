import React from "react";
import {
    Animated,
    Pressable,
    ScrollView,
    StatusBar,
    Text,
    TextInput,
    View,
} from "react-native";

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
};

/** 출발지·도착지 검색과 최근 장소·즐겨찾기 선택 화면을 표시한다. */
export function RouteSelectSearchScreen({
    controller,
}: RouteSelectSearchScreenProps) {
    const {
        statusBarStyle,
        insets,
        originText,
        activeTarget,
        isEditingRoutePoint,
        originUsesDefault,
        recentPlaces,
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
        searching,
        currentLocationPending,
        activeTargetLabel,
        activeSearchText,
        showingSearchResults,
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
    if (isEditingRoutePoint) {
        return (
            <View style={[styles.screen, { backgroundColor: routeUi.background, paddingTop: insets.top + 10 }]}>
                <StatusBar barStyle={statusBarStyle} />
                <View style={styles.searchModeHeader}>
                    <Pressable
                        onPress={exitSearchMode}
                        accessibilityRole="button"
                        accessibilityLabel="장소 검색 닫기"
                        style={styles.searchModeBackButton}
                    >
                        <Text style={[styles.searchModeBackText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={[styles.searchModeSearchBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <View style={styles.searchModeTargetContext} accessible={false}>
                            <View
                                style={[
                                    styles.searchModeTargetDot,
                                    {
                                        borderColor: activeTarget === "origin"
                                            ? routeUi.accentGreen
                                            : routeUi.accentRed,
                                    },
                                ]}
                            />
                            <Text style={[styles.searchModeTargetText, { color: routeUi.textSecondary }]}>
                                {activeTargetLabel}
                            </Text>
                        </View>
                        <TextInput
                            autoFocus
                            value={activeSearchText}
                            onChangeText={(text) => handleSearchChange(activeTarget, text)}
                            accessibilityLabel={`${activeTargetLabel} 검색`}
                            accessibilityHint="장소 이름이나 주소를 입력하세요"
                            placeholder="장소명 또는 주소를 검색하세요"
                            placeholderTextColor={routeUi.inputPlaceholder}
                            selectionColor={routeUi.accentBlue}
                            returnKeyType="search"
                            textContentType="none"
                            autoComplete="off"
                            secureTextEntry={false}
                            style={[styles.searchModeInput, { color: routeUi.textPrimary }]}
                        />
                        {!!activeSearchText.trim() && (
                            <Pressable
                                onPress={() => handleSearchChange(activeTarget, "")}
                                accessibilityRole="button"
                                accessibilityLabel={`${activeTargetLabel} 검색어 지우기`}
                                style={[styles.searchModeClearButton, { backgroundColor: routeUi.clearButtonBg }]}
                            >
                                <Text style={[styles.searchModeClearText, { color: routeUi.clearButtonText }]}>×</Text>
                            </Pressable>
                        )}
                    </View>
                    <Pressable
                        onPress={goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 이동"
                        style={[styles.scheduleListIconButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="calendar-outline" size={20} color={routeUi.textPrimary} />
                    </Pressable>
                </View>

                {originUsesDefault && activeTarget === "destination" && (
                    <Pressable
                        onPress={editDefaultOrigin}
                        accessibilityRole="button"
                        accessibilityLabel={`기본 출발지 ${originText}, 변경`}
                        style={[
                            styles.defaultOriginBar,
                            { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                        ]}
                    >
                        <Ionicons name="location-outline" size={19} color={routeUi.accentBlue} />
                        <View style={styles.defaultOriginCopy}>
                            <Text style={[styles.defaultOriginLabel, { color: routeUi.textSecondary }]}>기본 출발지</Text>
                            <Text numberOfLines={1} style={[styles.defaultOriginName, { color: routeUi.textPrimary }]}>
                                {originText}
                            </Text>
                        </View>
                        <Text style={[styles.defaultOriginAction, { color: routeUi.accentBlue }]}>변경</Text>
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
                            { backgroundColor: routeUi.selectedModeBg, borderColor: routeUi.selectedBorder },
                        ]}
                    >
                        <View style={[styles.defaultOriginSetupIcon, { backgroundColor: routeUi.surface }]}>
                            <Ionicons name="home-outline" size={19} color={routeUi.accentBlue} />
                        </View>
                        <View style={styles.defaultOriginCopy}>
                            <Text style={[styles.defaultOriginSetupTitle, { color: routeUi.textPrimary }]}>기본 출발지가 없어요</Text>
                            <Text numberOfLines={2} style={[styles.defaultOriginSetupDescription, { color: routeUi.textSecondary }]}>
                                자주 출발하는 장소를 설정하면 다음부터 자동으로 입력돼요
                            </Text>
                        </View>
                        <Text style={[styles.defaultOriginAction, { color: routeUi.accentBlue }]}>설정</Text>
                    </Pressable>
                )}

                <View style={styles.searchModeActionRow}>
                    <Pressable
                        onPress={applyCurrentLocationToActiveTarget}
                        accessibilityRole="button"
                        accessibilityLabel={`${activeTargetLabel}를 현재 위치로 설정`}
                        accessibilityState={{
                            busy: currentLocationPending,
                            disabled: currentLocationPending,
                        }}
                        disabled={currentLocationPending}
                        style={[styles.searchModeActionButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        {currentLocationPending ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="현재 위치를 확인하고 있어요"
                            />
                        ) : (
                            <Ionicons name="navigate-outline" size={22} color={routeUi.accentBlue} />
                        )}
                        <Text style={[styles.searchModeActionText, { color: routeUi.accentBlue }]}>내 위치</Text>
                    </Pressable>
                    <Pressable
                        onPress={openMapForPointSelection}
                        accessibilityRole="button"
                        accessibilityLabel="지도에서 출발지 또는 도착지 선택"
                        style={[styles.searchModeActionButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="map-outline" size={23} color={routeUi.textSecondary} />
                        <Text style={[styles.searchModeActionText, { color: routeUi.textSecondary }]}>지도에서 선택</Text>
                    </Pressable>
                </View>

                <ScrollView
                    directionalLockEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[styles.searchModeContent, { paddingBottom: Math.max(insets.bottom + 24, 36) }]}
                >
                    {showingSearchResults ? (
                        <View style={styles.searchModePanel}>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>검색 결과</Text>
                            </View>
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
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        주소 검색에 실패했습니다. 네트워크를 확인해 주세요.
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="주소 다시 검색"
                                        onPress={() => handleSearchChange(activeTarget, activeSearchText)}
                                        style={[styles.emptyRetryButton, { backgroundColor: routeUi.accentBlue }]}
                                    >
                                        <Ionicons name="refresh" size={15} color="#FFFFFF" />
                                        <Text style={styles.emptyRetryText}>다시 검색</Text>
                                    </Pressable>
                                </View>
                            )}
                            {!searching && !searchError && searchResults.length === 0 && (
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        검색 결과가 없습니다.
                                    </Text>
                                </View>
                            )}
                            {searchResults.slice(0, 10).map((item, index) => {
                                const resultPlace = buildPlaceFromSearchItem(item);
                                const resultIcon = resolvePlaceListIcon({ ...resultPlace, category: item.category });
                                const savingKey = getPlaceActionKey(resultPlace);
                                const isSaving = favoriteSavingKey === savingKey;
                                const savedFavorite = findMatchingFavoritePlace(resultPlace, favoritePlaces);

                                return (
                                    <View
                                        key={`${item.lat}:${item.lng}:${index}`}
                                        style={[
                                            styles.searchModeResultRow,
                                            { borderColor: routeUi.border, backgroundColor: routeUi.surface },
                                        ]}
                                    >
                                        <Pressable
                                            onPress={() => applyPlace(activeTarget, item)}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${item.name}, ${item.address || "주소 정보 없음"}`}
                                            style={styles.searchModeResultMain}
                                        >
                                            <View style={[styles.searchModeListIcon, { backgroundColor: routeUi.surface2 }]}>
                                                <Ionicons name={resultIcon} size={18} color={routeUi.textSecondary} />
                                            </View>
                                            <View style={styles.searchModeResultTextWrap}>
                                                <Text numberOfLines={1} style={[styles.searchResultTitle, { color: routeUi.textPrimary }]}>
                                                    {item.name}
                                                </Text>
                                                {!!(item.category || formatSearchResultDistance(item.distanceMeters)) && (
                                                    <Text numberOfLines={1} style={styles.searchResultCategory}>
                                                        {[item.category, formatSearchResultDistance(item.distanceMeters)].filter(Boolean).join(" · ")}
                                                    </Text>
                                                )}
                                                <Text numberOfLines={1} style={[styles.searchResultAddress, { color: routeUi.textSecondary }]}>
                                                    {item.address}
                                                </Text>
                                            </View>
                                        </Pressable>
                                        <Pressable
                                            onPress={() => savedFavorite
                                                ? removePlaceFromFavorites(savedFavorite, resultPlace)
                                                : openFavoriteSaveSheet(resultPlace)}
                                            disabled={Boolean(favoriteSavingKey)}
                                            accessibilityRole="button"
                                            accessibilityLabel={savedFavorite
                                                ? `${item.name} 즐겨찾기 해제`
                                                : `${item.name} 즐겨찾기에 저장`}
                                            accessibilityState={{ disabled: Boolean(favoriteSavingKey) }}
                                            style={styles.searchModeFavoriteButton}
                                        >
                                            {isSaving ? (
                                                <BrandedLoader
                                                    size="button"
                                                    variant="route"
                                                    accessibilityLabel="즐겨찾기를 저장하고 있어요"
                                                />
                                            ) : (
                                                <Ionicons
                                                    name={savedFavorite ? "star" : "star-outline"}
                                                    size={21}
                                                    color={savedFavorite ? routeUi.accentBlue : routeUi.textSecondary}
                                                />
                                            )}
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                    ) : (
                        <View style={styles.searchModePanel}>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>즐겨찾기</Text>
                                <Pressable
                                    onPress={openPlaceSettings}
                                    accessibilityRole="button"
                                    accessibilityLabel="내 장소 관리"
                                    style={styles.favoriteManageButton}
                                >
                                    <Ionicons name="options-outline" size={15} color={routeUi.accentBlue} />
                                    <Text style={[styles.searchModeEditText, { color: routeUi.accentBlue }]}>관리</Text>
                                </Pressable>
                            </View>
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
                                        <Ionicons name="refresh" size={14} color={routeUi.accentBlue} />
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
                                                name={selected ? "home" : "home-outline"}
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
                                                    <Ionicons name="home" size={20} color={routeUi.accentBlue} />
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
                                                    <Ionicons name="star" size={21} color={routeUi.accentBlue} />
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
                                            <Pressable
                                                onPress={() => openFavoriteSaveSheet(place)}
                                                disabled={Boolean(favoriteSavingKey)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 즐겨찾기에 저장`}
                                                accessibilityState={{ disabled: Boolean(favoriteSavingKey) }}
                                                style={styles.searchModeFavoriteButton}
                                            >
                                                {isSaving ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel="즐겨찾기를 저장하고 있어요"
                                                    />
                                                ) : (
                                                    <Ionicons
                                                        name="star-outline"
                                                        size={21}
                                                        color={routeUi.textSecondary}
                                                    />
                                                )}
                                            </Pressable>
                                            <Pressable
                                                onPress={() => removeRecentPlace(place)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 최근 검색에서 삭제`}
                                                style={styles.searchModeRemoveButton}
                                            >
                                                <Text style={[styles.searchModeRemoveText, { color: routeUi.textSecondary }]}>×</Text>
                                            </Pressable>
                                        </View>
                                    );
                                })
                            ) : (
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        {recentPlaces.length > 0
                                            ? "즐겨찾기에 저장된 장소를 제외한 최근 검색이 없습니다."
                                            : "최근 검색 내역이 없습니다."}
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
