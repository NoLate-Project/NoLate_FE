import styles from "../../src/routeSupport/settings/places.styles";
import React from "react";
import {
    ActivityIndicator,
    Animated,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

export default function PlacesSettingsScreen() {
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
