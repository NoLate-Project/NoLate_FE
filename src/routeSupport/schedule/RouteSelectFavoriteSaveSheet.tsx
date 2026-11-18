import React, { useEffect, useRef } from "react";
import {
    AccessibilityInfo,
    Animated as NativeAnimated,
    Easing,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import BrandedLoader from "../../ui/BrandedLoader";
import {
    getFavoritePlaceCategoryDisplayName,
} from "../../modules/schedule/favoritePlaceSelection";
import styles from "./route-select.styles";
import { getPlaceDisplayText } from "./routeSelectPlaceModel";
import {
    FAVORITE_CATEGORY_COLORS,
    Ionicons,
} from "./RouteSelectAnimatedControls";
import type { RouteSelectController } from "./useRouteSelectController";

type RouteSelectFavoriteSaveSheetProps = {
    controller: RouteSelectController;
};

const defaultAddressNoticeEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

/** 선택한 장소를 기존 또는 새 즐겨찾기 분류에 저장하는 모달 흐름을 표시한다. */
export function RouteSelectFavoriteSaveSheet({
    controller,
}: RouteSelectFavoriteSaveSheetProps) {
    const {
        favoriteSheetSaving,
        hasConfiguredDefaultOrigin,
        favoriteSaveError,
        announceFavoriteSave,
        modeSelectedText,
        insets,
        favoriteSheetPlace,
        favoriteSheetExisting,
        favoriteSheetLabel,
        setFavoriteSheetLabel,
        saveFavoriteAsDefaultOrigin,
        setSaveFavoriteAsDefaultOrigin,
        favoriteCategories,
        favoriteCategoryLoading,
        favoriteCategoryError,
        loadFavoriteCategories,
        selectedFavoriteCategoryId,
        setSelectedFavoriteCategoryId,
        showNewCategoryForm,
        setShowNewCategoryForm,
        newCategoryName,
        setNewCategoryName,
        newCategoryColor,
        setNewCategoryColor,
        creatingFavoriteCategory,
        closeFavoriteSaveSheet,
        createFavoriteCategory,
        saveFavoriteSheetPlace,
        routeUi,
        reduceFavoriteMotionEnabled,
    } = controller;
    const largeText = useWindowDimensions().fontScale > 1.35;
    const busy = favoriteSheetSaving || creatingFavoriteCategory;
    const visible = Boolean(favoriteSheetPlace);
    const entrance = useRef(new NativeAnimated.Value(0)).current;
    const title = useRef<Text>(null);
    const saveLabel = saveFavoriteAsDefaultOrigin ? "기본 주소로 저장" : "장소 저장";
    const disabled = !favoriteSheetLabel.trim() || busy;
    useEffect(() => {
        if (!visible || reduceFavoriteMotionEnabled) {
            entrance.stopAnimation();
            entrance.setValue(visible ? 1 : 0);
        }
        if (Platform.OS !== "ios" && !visible) announceFavoriteSave();
    }, [announceFavoriteSave, entrance, reduceFavoriteMotionEnabled, visible]);

    const showSheet = () => {
        if (!reduceFavoriteMotionEnabled) {
            NativeAnimated.timing(entrance, {
                toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true,
            }).start();
        }
        if (title.current) AccessibilityInfo.sendAccessibilityEvent?.(title.current, "focus");
    };
    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onShow={showSheet}
            onRequestClose={closeFavoriteSaveSheet}
            onDismiss={announceFavoriteSave}
        >
            <View accessibilityViewIsModal style={styles.favoriteModalRoot}>
                <Pressable
                    onPress={closeFavoriteSaveSheet}
                    disabled={busy}
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.favoriteModalBackdrop}
                />
                <NativeAnimated.View
                    onAccessibilityEscape={closeFavoriteSaveSheet}
                    style={[
                        styles.favoriteSheet,
                        {
                            opacity: entrance,
                            transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
                        },
                        {
                            borderColor: routeUi.border,
                            backgroundColor: routeUi.surface,
                            paddingBottom: Math.max(insets.bottom + 16, 22),
                        },
                    ]}
                >
                    <View style={[styles.favoriteSheetHandle, { backgroundColor: routeUi.borderStrong }]} />
                    <View style={styles.favoriteSheetHeader}>
                        <View style={styles.favoritePlaceTextWrap}>
                            <Text ref={title} accessible accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.favoriteSheetTitle, { color: routeUi.textPrimary }]}>
                                {favoriteSheetExisting ? "즐겨찾기 수정" : "즐겨찾기 추가"}
                            </Text>
                            <Text maxFontSizeMultiplier={1.8} style={[styles.favoriteSheetSubtitle, { color: routeUi.textSecondary }]}>
                                장소 이름과 분류를 확인해 주세요
                            </Text>
                        </View>
                        <Pressable
                            onPress={closeFavoriteSaveSheet}
                            disabled={busy}
                            accessibilityRole="button"
                            accessibilityLabel="즐겨찾기 저장 창 닫기"
                            style={[styles.favoriteSheetCloseButton, { backgroundColor: routeUi.surface2 }]}
                        >
                            <Ionicons name="close-outline" size={23} color={routeUi.textSecondary} />
                        </Pressable>
                    </View>

                    <ScrollView
                        style={styles.favoriteSheetScroll}
                        contentContainerStyle={styles.favoriteSheetScrollContent}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                        automaticallyAdjustKeyboardInsets
                        showsVerticalScrollIndicator={false}
                    >
                    <View style={[styles.favoritePlaceBox, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}>
                        <Ionicons name="location-outline" size={18} color={routeUi.accentBlue} />
                        <View style={styles.favoritePlaceTextWrap}>
                            <Text numberOfLines={largeText ? undefined : 2} style={[styles.favoritePlaceName, { color: routeUi.textPrimary }]}>
                                {favoriteSheetPlace ? getPlaceDisplayText(favoriteSheetPlace) : ""}
                            </Text>
                            {!!favoriteSheetPlace?.address && (
                                <Text numberOfLines={largeText ? undefined : 2} style={[styles.favoritePlaceAddress, { color: routeUi.textSecondary }]}>
                                    {favoriteSheetPlace.address}
                                </Text>
                            )}
                        </View>
                    </View>

                    <View style={styles.favoriteNameField}>
                        <Text style={[styles.favoriteSectionLabel, { color: routeUi.textPrimary }]}>표시할 이름</Text>
                        <TextInput
                            accessibilityLabel="표시할 이름"
                            maxLength={120}
                            selectTextOnFocus
                            clearButtonMode="while-editing"
                            editable={!busy}
                            value={favoriteSheetLabel}
                            onChangeText={setFavoriteSheetLabel}
                            returnKeyType="done"
                            style={[styles.favoriteDisplayNameInput, { borderColor: routeUi.border, color: routeUi.textPrimary }]}
                        />
                    </View>

                    <View style={styles.favoriteSectionHeaderRow}>
                        <Text style={[styles.favoriteSectionLabel, { color: routeUi.textPrimary }]}>카테고리</Text>
                        {favoriteCategoryLoading && (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="즐겨찾기 카테고리를 불러오고 있어요"
                            />
                        )}
                    </View>
                    <View style={styles.favoriteCategoryWrap}>
                        <Pressable
                            onPress={() => {
                                setSaveFavoriteAsDefaultOrigin(true);
                                setSelectedFavoriteCategoryId(undefined);
                            }}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="기본 주소"
                            accessibilityHint="즐겨찾기에 저장하고 이후 경로 검색에 사용할 기본 출발지로 설정합니다"
                            accessibilityState={{ selected: saveFavoriteAsDefaultOrigin }}
                            style={[
                                styles.favoriteCategoryChip,
                                {
                                    backgroundColor: saveFavoriteAsDefaultOrigin ? routeUi.accentBlue : routeUi.surface2,
                                    borderColor: saveFavoriteAsDefaultOrigin ? routeUi.accentBlue : routeUi.border,
                                },
                            ]}
                        >
                            <Ionicons
                                name="home-outline"
                                size={15}
                                color={saveFavoriteAsDefaultOrigin ? modeSelectedText : routeUi.accentBlue}
                            />
                            <Text
                                style={[
                                    styles.favoriteCategoryChipText,
                                    { color: saveFavoriteAsDefaultOrigin ? modeSelectedText : routeUi.textPrimary },
                                ]}
                            >
                                기본 주소
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                setSaveFavoriteAsDefaultOrigin(false);
                                setSelectedFavoriteCategoryId(undefined);
                            }}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="미분류 카테고리"
                            accessibilityState={{
                                selected: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId,
                            }}
                            style={[
                                styles.favoriteCategoryChip,
                                {
                                    backgroundColor: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId
                                        ? routeUi.accentBlue
                                        : routeUi.surface2,
                                    borderColor: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId
                                        ? routeUi.accentBlue
                                        : routeUi.border,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.favoriteCategoryChipText,
                                    {
                                        color: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId
                                            ? modeSelectedText
                                            : routeUi.textSecondary,
                                    },
                                ]}
                            >
                                미분류
                            </Text>
                        </Pressable>
                        {favoriteCategories.map((category) => {
                            const selected = !saveFavoriteAsDefaultOrigin
                                && selectedFavoriteCategoryId === category.id;
                            const categoryColor = category.color || routeUi.accentBlue;
                            const categoryDisplayName = getFavoritePlaceCategoryDisplayName(category.name);
                            return (
                                <Pressable
                                    key={category.id ?? `${category.name}:${categoryColor}`}
                                    onPress={() => {
                                        setSaveFavoriteAsDefaultOrigin(false);
                                        setSelectedFavoriteCategoryId(category.id);
                                    }}
                                    disabled={!category.id || favoriteSheetSaving || creatingFavoriteCategory}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${categoryDisplayName} 카테고리`}
                                    accessibilityState={{
                                        selected,
                                        disabled: !category.id || favoriteSheetSaving || creatingFavoriteCategory,
                                    }}
                                    style={[
                                        styles.favoriteCategoryChip,
                                        {
                                            backgroundColor: selected ? categoryColor : routeUi.surface2,
                                            borderColor: selected ? categoryColor : routeUi.border,
                                            opacity: category.id ? 1 : 0.5,
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.favoriteCategorySwatch,
                                            { backgroundColor: selected ? modeSelectedText : categoryColor },
                                        ]}
                                    />
                                    <Text
                                        numberOfLines={largeText ? undefined : 2}
                                        style={[
                                            styles.favoriteCategoryChipText,
                                            { color: selected ? modeSelectedText : routeUi.textPrimary },
                                        ]}
                                    >
                                        {categoryDisplayName}
                                    </Text>
                                </Pressable>
                            );
                        })}
                        <Pressable
                            onPress={() => setShowNewCategoryForm((current) => !current)}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="새 카테고리 입력"
                            accessibilityState={{ expanded: showNewCategoryForm }}
                            style={[
                                styles.favoriteCategoryChip,
                                { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                            ]}
                        >
                            <Ionicons name={showNewCategoryForm ? "remove-outline" : "add-outline"} size={16} color={routeUi.textPrimary} />
                            <Text style={[styles.favoriteCategoryChipText, { color: routeUi.textPrimary }]}>
                                새 카테고리
                            </Text>
                        </Pressable>
                    </View>
                    {saveFavoriteAsDefaultOrigin && (
                        <Animated.View entering={defaultAddressNoticeEntry} style={[styles.favoriteDefaultAddressNotice, { backgroundColor: routeUi.surface2 }]}>
                            <Ionicons name="home-outline" size={18} color={routeUi.accentBlue} />
                            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} style={[styles.favoriteDefaultAddressNoticeText, { color: routeUi.textPrimary }]}>
                                {hasConfiguredDefaultOrigin ? "기존 기본 주소를 이 장소로 바꿔요. 다음 경로부터 적용돼요." : "다음 경로를 검색할 때 이 장소가 기본 출발지로 표시돼요."}
                            </Text>
                        </Animated.View>
                    )}

                    {!!favoriteCategoryError && (
                        <View style={[styles.favoriteCategoryRecovery, { backgroundColor: routeUi.surface2 }]}>
                            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} style={[styles.favoriteCategoryError, { color: routeUi.textPrimary }]}>
                                {favoriteCategoryError}
                            </Text>
                            <Text maxFontSizeMultiplier={2} style={[styles.favoriteCategoryHelp, { color: routeUi.textSecondary }]}>
                                다시 불러오거나 미분류를 선택할 수 있어요.
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="즐겨찾기 카테고리 다시 불러오기"
                                disabled={busy || favoriteCategoryLoading}
                                accessibilityState={{ busy: favoriteCategoryLoading, disabled: busy || favoriteCategoryLoading }}
                                onPress={() => void loadFavoriteCategories()}
                                style={styles.favoriteCategoryRetry}
                            >
                                <Ionicons name="refresh-outline" size={17} color={routeUi.accentBlue} />
                                <Text maxFontSizeMultiplier={2} style={[styles.favoriteCategoryError, { color: routeUi.accentBlue }]}>
                                    {favoriteCategoryLoading ? "불러오는 중" : "다시 불러오기"}
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {showNewCategoryForm && (
                        <View style={[styles.favoriteNewCategoryBox, { backgroundColor: routeUi.inputBackground, borderColor: routeUi.inputBorder }]}>
                            <TextInput
                                value={newCategoryName}
                                onChangeText={setNewCategoryName}
                                placeholder="카테고리 이름"
                                placeholderTextColor={routeUi.inputPlaceholder}
                                selectionColor={routeUi.accentBlue}
                                style={[
                                    styles.favoriteNewCategoryInput,
                                    {
                                        color: routeUi.textPrimary,
                                        borderColor: routeUi.inputBorder,
                                    },
                                ]}
                            />
                            <View style={styles.favoriteColorRow}>
                                {FAVORITE_CATEGORY_COLORS.map((color, colorIndex) => {
                                    const selected = newCategoryColor === color;
                                    return (
                                        <Pressable
                                            key={color}
                                            onPress={() => setNewCategoryColor(color)}
                                            disabled={creatingFavoriteCategory || favoriteSheetSaving}
                                            accessibilityRole="button"
                                            accessibilityLabel={`카테고리 색상 ${colorIndex + 1}`}
                                            accessibilityState={{ selected }}
                                            style={[
                                                styles.favoriteColorButton,
                                                {
                                                    borderColor: selected ? routeUi.textPrimary : "transparent",
                                                },
                                            ]}
                                        >
                                            <View style={[styles.favoriteColorSwatch, { backgroundColor: color }]} />
                                        </Pressable>
                                    );
                                })}
                            </View>
                            <Pressable
                                onPress={createFavoriteCategory}
                                disabled={creatingFavoriteCategory || favoriteSheetSaving}
                                accessibilityRole="button"
                                accessibilityLabel="카테고리 추가"
                                style={[
                                    styles.favoriteCreateCategoryButton,
                                    { backgroundColor: routeUi.textPrimary },
                                ]}
                            >
                                {creatingFavoriteCategory ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="즐겨찾기 카테고리를 추가하고 있어요"
                                    />
                                ) : (
                                    <Text style={[styles.favoriteCreateCategoryText, { color: routeUi.background }]}>
                                        카테고리 추가
                                    </Text>
                                )}
                            </Pressable>
                        </View>
                    )}

                    </ScrollView>
                    {!!favoriteSaveError && (
                        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" maxFontSizeMultiplier={2} style={[styles.favoriteCategoryError, { color: routeUi.textPrimary }]}>
                            {favoriteSaveError}
                        </Text>
                    )}
                    <Pressable
                        onPress={saveFavoriteSheetPlace}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityLabel={saveLabel}
                        accessibilityState={{ disabled, busy }}
                        style={[
                            styles.favoriteSaveButton,
                            {
                                backgroundColor: routeUi.accentBlue,
                                opacity: disabled ? 0.58 : 1,
                            },
                        ]}
                    >
                        {favoriteSheetSaving ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="즐겨찾기를 저장하고 있어요"
                            />
                        ) : (
                            <Text maxFontSizeMultiplier={2} style={[styles.favoriteSaveButtonText, { color: modeSelectedText }]}>
                                {saveLabel}
                            </Text>
                        )}
                    </Pressable>
                </NativeAnimated.View>
            </View>
        </Modal>
    );

}
