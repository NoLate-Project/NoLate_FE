import React from "react";
import {
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";

import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import BrandedLoader from "../../src/ui/BrandedLoader";
import {
    getFavoritePlaceCategoryDisplayName,
} from "../../src/modules/schedule/favoritePlaceSelection";
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

/** 선택한 장소를 기존 또는 새 즐겨찾기 분류에 저장하는 모달 흐름을 표시한다. */
export function RouteSelectFavoriteSaveSheet({
    controller,
}: RouteSelectFavoriteSaveSheetProps) {
    const {
        favoriteSheetSaving,
        modeSelectedText,
        insets,
        favoriteSheetPlace,
        saveFavoriteAsDefaultOrigin,
        setSaveFavoriteAsDefaultOrigin,
        favoriteCategories,
        favoriteCategoryLoading,
        favoriteCategoryError,
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
    } = controller;
    return (
        <Modal
            visible={Boolean(favoriteSheetPlace)}
            transparent
            animationType="fade"
            onRequestClose={closeFavoriteSaveSheet}
        >
            <View accessibilityViewIsModal style={styles.favoriteModalRoot}>
                <Pressable
                    onPress={closeFavoriteSaveSheet}
                    disabled={favoriteSheetSaving || creatingFavoriteCategory}
                    accessibilityRole="button"
                    accessibilityLabel="즐겨찾기 저장 창 닫기"
                    style={styles.favoriteModalBackdrop}
                />
                <CalendarGlassSurface
                    prominent
                    variant="sheet"
                    style={[
                        styles.favoriteSheet,
                        {
                            borderColor: routeUi.border,
                            paddingBottom: Math.max(insets.bottom + 16, 22),
                        },
                    ]}
                >
                    <View style={[styles.favoriteSheetHandle, { backgroundColor: routeUi.borderStrong }]} />
                    <View style={styles.favoriteSheetHeader}>
                        <View>
                            <Text style={[styles.favoriteSheetTitle, { color: routeUi.textPrimary }]}>
                                즐겨찾기 저장
                            </Text>
                            <Text style={[styles.favoriteSheetSubtitle, { color: routeUi.textSecondary }]}>
                                저장할 카테고리를 선택하세요
                            </Text>
                        </View>
                        <Pressable
                            onPress={closeFavoriteSaveSheet}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="즐겨찾기 저장 창 닫기"
                            style={[styles.favoriteSheetCloseButton, { backgroundColor: routeUi.surface2 }]}
                        >
                            <Text style={[styles.favoriteSheetCloseText, { color: routeUi.textSecondary }]}>×</Text>
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
                        <Ionicons name="star" size={18} color={routeUi.accentBlue} />
                        <View style={styles.favoritePlaceTextWrap}>
                            <Text numberOfLines={1} style={[styles.favoritePlaceName, { color: routeUi.textPrimary }]}>
                                {favoriteSheetPlace ? getPlaceDisplayText(favoriteSheetPlace) : ""}
                            </Text>
                            {!!favoriteSheetPlace?.address && (
                                <Text numberOfLines={1} style={[styles.favoritePlaceAddress, { color: routeUi.textSecondary }]}>
                                    {favoriteSheetPlace.address}
                                </Text>
                            )}
                        </View>
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
                            accessibilityLabel="기본 주소 카테고리"
                            accessibilityHint="이 장소를 다음 경로부터 사용할 기본 주소로 저장합니다"
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
                                name={saveFavoriteAsDefaultOrigin ? "home" : "home-outline"}
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
                                        numberOfLines={1}
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
                            <Ionicons name={showNewCategoryForm ? "remove" : "add"} size={16} color={routeUi.textPrimary} />
                            <Text style={[styles.favoriteCategoryChipText, { color: routeUi.textPrimary }]}>
                                새 카테고리
                            </Text>
                        </Pressable>
                    </View>
                    {!!favoriteCategoryError && (
                        <Text style={[styles.favoriteCategoryError, { color: routeUi.accentRed }]}>
                            {favoriteCategoryError}
                        </Text>
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

                    <Pressable
                        onPress={saveFavoriteSheetPlace}
                        disabled={!favoriteSheetPlace || favoriteSheetSaving || creatingFavoriteCategory}
                        accessibilityRole="button"
                        accessibilityLabel="즐겨찾기 저장"
                        style={[
                            styles.favoriteSaveButton,
                            {
                                backgroundColor: routeUi.accentBlue,
                                opacity: favoriteSheetSaving || creatingFavoriteCategory ? 0.58 : 1,
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
                            <Text style={[styles.favoriteSaveButtonText, { color: modeSelectedText }]}>
                                즐겨찾기 저장
                            </Text>
                        )}
                    </Pressable>
                    </ScrollView>
                </CalendarGlassSurface>
            </View>
        </Modal>
    );

}
