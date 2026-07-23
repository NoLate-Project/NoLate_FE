import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createScheduleCategoryToApi,
    deleteScheduleCategoryFromApi,
    getScheduleCategoriesFromApi,
    type ScheduleCategoryItem,
    updateScheduleCategoryToApi,
} from "../../src/api/scheduleCategories";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import CategoryLoadErrorBanner from "../../src/modules/schedule/components/form/CategoryLoadErrorBanner";
import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { getCategorySharePermissionLabel } from "../../src/modules/share/sharePermissionPresentation";
import { countOwnedScheduleCategories } from "../../src/modules/schedule/categoryPermissions";
import BrandedLoader from "../../src/ui/BrandedLoader";

const CATEGORY_COLORS = [
    "#ff3b30",
    "#ff9500",
    "#34c759",
    "#007aff",
    "#5856d6",
    "#af52de",
    "#ff2d55",
];
const CATEGORY_COLOR_LABELS = ["빨강", "주황", "초록", "파랑", "남색", "보라", "분홍"];

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleCategoriesScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newColor, setNewColor] = useState(CATEGORY_COLORS[0]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingColor, setEditingColor] = useState(CATEGORY_COLORS[0]);
    const [sharingCategory, setSharingCategory] = useState<ScheduleCategoryItem | null>(null);
    const loadSequenceRef = useRef(0);
    const loadPendingRef = useRef(false);
    const mutationPendingRef = useRef(false);
    const controlsBusy = loading || saving;

    const categoryList = useMemo(
        () => [...state.categories].filter((category) => category.id) as ScheduleCategoryItem[],
        [state.categories]
    );
    const ownedCategoryCount = useMemo(
        () => countOwnedScheduleCategories(categoryList),
        [categoryList]
    );

    const loadCategories = useCallback(async () => {
        if (loadPendingRef.current || mutationPendingRef.current) return;
        const sequence = loadSequenceRef.current + 1;
        loadSequenceRef.current = sequence;
        loadPendingRef.current = true;
        setLoading(true);
        setLoadError(null);
        try {
            const categories = await getScheduleCategoriesFromApi();
            if (loadSequenceRef.current !== sequence) return;
            dispatch({ type: "SET_CATEGORIES", categories });
        } catch (error) {
            if (loadSequenceRef.current !== sequence) return;
            setLoadError(getErrorMessage(error));
        } finally {
            if (loadSequenceRef.current === sequence) {
                loadPendingRef.current = false;
                setLoading(false);
            }
        }
    }, [dispatch]);

    useEffect(() => {
        loadCategories();
        return () => {
            loadSequenceRef.current += 1;
            loadPendingRef.current = false;
        };
    }, [loadCategories]);

    const createCategory = async () => {
        const title = newTitle.trim();
        if (!title || controlsBusy || mutationPendingRef.current) return;

        mutationPendingRef.current = true;
        setSaving(true);
        try {
            const category = await createScheduleCategoryToApi(title, newColor);
            dispatch({ type: "UPSERT_CATEGORY", category });
            setNewTitle("");
            setNewColor(CATEGORY_COLORS[categoryList.length % CATEGORY_COLORS.length]);
        } catch (error) {
            Alert.alert("카테고리 추가 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
        }
    };

    const startEditing = (category: { id: string; title: string; color: string }) => {
        setEditingId(category.id);
        setEditingTitle(category.title);
        setEditingColor(category.color);
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditingTitle("");
        setEditingColor(CATEGORY_COLORS[0]);
    };

    const saveEditing = async () => {
        if (!editingId || !editingTitle.trim() || controlsBusy || mutationPendingRef.current) return;

        mutationPendingRef.current = true;
        setSaving(true);
        try {
            const category = await updateScheduleCategoryToApi(editingId, {
                title: editingTitle.trim(),
                color: editingColor,
            });
            dispatch({ type: "UPSERT_CATEGORY", category });
            cancelEditing();
        } catch (error) {
            Alert.alert("카테고리 수정 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
        }
    };

    const confirmDelete = (categoryId: string) => {
        if (controlsBusy || mutationPendingRef.current) return;
        if (ownedCategoryCount <= 1) {
            Alert.alert("카테고리 삭제", "카테고리는 최소 1개 이상 필요합니다.");
            return;
        }

        Alert.alert("카테고리 삭제", "이 카테고리를 삭제할까요? 기존 일정의 표시 정보는 유지됩니다.", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: () => {
                    deleteCategory(categoryId).catch(() => undefined);
                },
            },
        ]);
    };

    const deleteCategory = async (categoryId: string) => {
        if (controlsBusy || mutationPendingRef.current) return;
        mutationPendingRef.current = true;
        setSaving(true);
        try {
            await deleteScheduleCategoryFromApi(categoryId);
            dispatch({ type: "REMOVE_CATEGORY", id: categoryId });
            if (editingId === categoryId) cancelEditing();
        } catch (error) {
            Alert.alert("카테고리 삭제 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
        }
    };

    const goBack = () => {
        if (loadPendingRef.current || mutationPendingRef.current) {
            Alert.alert("처리 중이에요", "카테고리 작업이 끝난 뒤 돌아가 주세요.");
            return;
        }
        if (router.canGoBack()) router.back();
        else router.replace("/schedule");
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}
        >
            <StatusBar
                barStyle={mode === "dark" ? "light-content" : "dark-content"}
                backgroundColor={colors.background}
            />
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    onPress={goBack}
                    accessibilityLabel="뒤로 가기"
                    accessibilityState={{ busy: controlsBusy }}
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons accessible={false} name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>카테고리 관리</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 캘린더 관리"
                    onPress={() => router.push("/schedule/calendars")}
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons accessible={false} name="people-outline" size={21} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 16) + 20 },
                ]}
            >
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>새 카테고리</Text>
                    <TextInput
                        accessibilityLabel="새 카테고리 이름"
                        textContentType="none"
                        autoComplete="off"
                        secureTextEntry={false}
                        value={newTitle}
                        editable={!controlsBusy}
                        onChangeText={setNewTitle}
                        onSubmitEditing={createCategory}
                        maxLength={80}
                        placeholder="카테고리 이름"
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[
                            styles.input,
                            {
                                backgroundColor: colors.inputBackground,
                                borderColor: colors.inputBorder,
                                color: colors.textPrimary,
                            },
                        ]}
                    />
                    <ColorPicker value={newColor} onChange={setNewColor} disabled={controlsBusy} />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="카테고리 추가"
                        accessibilityState={{ disabled: !newTitle.trim() || controlsBusy, busy: saving }}
                        disabled={!newTitle.trim() || controlsBusy}
                        onPress={createCategory}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            {
                                backgroundColor: colors.selectedDayBg,
                                opacity: !newTitle.trim() || controlsBusy ? 0.4 : pressed ? 0.75 : 1,
                            },
                        ]}
                    >
                        {saving ? (
                            <BrandedLoader
                                size="button"
                                variant="schedule"
                                accessibilityLabel="카테고리를 추가하고 있어요"
                            />
                        ) : (
                            <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                                추가
                            </Text>
                        )}
                    </Pressable>
                </View>

                <View style={styles.listHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>카테고리 목록</Text>
                    {loading ? (
                        <BrandedLoader
                            size="button"
                            variant="schedule"
                            accessibilityLabel="카테고리를 불러오고 있어요"
                        />
                    ) : null}
                </View>

                {loadError ? (
                    <CategoryLoadErrorBanner
                        retrying={controlsBusy}
                        onRetry={() => {
                            if (!saving) loadCategories();
                        }}
                    />
                ) : null}

                {categoryList.map((category) => {
                    const editing = editingId === category.id;
                    const isShared = category.shared === true;
                    return (
                        <View
                            key={category.id}
                            style={[
                                styles.categoryCard,
                                { backgroundColor: colors.surface, borderColor: colors.border },
                            ]}
                        >
                            {editing ? (
                                <View style={styles.editBody}>
                                    <TextInput
                                        autoFocus
                                        accessibilityLabel={`${category.title} 카테고리 이름 수정`}
                                        textContentType="none"
                                        autoComplete="off"
                                        secureTextEntry={false}
                                        value={editingTitle}
                                        editable={!controlsBusy}
                                        onChangeText={setEditingTitle}
                                        onSubmitEditing={saveEditing}
                                        maxLength={80}
                                        placeholder="카테고리 이름"
                                        placeholderTextColor={colors.inputPlaceholder}
                                        style={[
                                            styles.input,
                                            {
                                                backgroundColor: colors.inputBackground,
                                                borderColor: colors.inputBorder,
                                                color: colors.textPrimary,
                                            },
                                        ]}
                                    />
                                    <ColorPicker value={editingColor} onChange={setEditingColor} disabled={controlsBusy} />
                                    <View style={styles.editActions}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="카테고리 수정 취소"
                                            accessibilityState={{ disabled: controlsBusy }}
                                            disabled={controlsBusy}
                                            onPress={cancelEditing}
                                            style={[
                                                styles.secondaryButton,
                                                { borderColor: colors.border },
                                                controlsBusy && styles.disabledControl,
                                            ]}
                                        >
                                            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
                                                취소
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="카테고리 수정 저장"
                                            accessibilityState={{ disabled: !editingTitle.trim() || controlsBusy, busy: saving }}
                                            disabled={!editingTitle.trim() || controlsBusy}
                                            onPress={saveEditing}
                                            style={({ pressed }) => [
                                                styles.editSaveButton,
                                                {
                                                    backgroundColor: colors.selectedDayBg,
                                                    opacity: !editingTitle.trim() || controlsBusy ? 0.4 : pressed ? 0.75 : 1,
                                                },
                                            ]}
                                        >
                                            <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                                                저장
                                            </Text>
                                        </Pressable>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.categoryRow}>
                                    <View style={styles.categoryInfo}>
                                        <View style={[styles.categoryDot, { backgroundColor: category.color }]} />
                                        <View style={styles.categoryTitleWrap}>
                                            <View style={styles.categoryTitleRow}>
                                                <Text style={[styles.categoryTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                                                    {category.title}
                                                </Text>
                                                {isShared && (
                                                    <View style={[styles.sharedBadge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                                                        <Ionicons accessible={false} name="people-outline" size={13} color={colors.textSecondary} />
                                                        <Text style={[styles.sharedBadgeText, { color: colors.textSecondary }]}>
                                                            공유됨
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                            {isShared && (
                                                <Text style={[styles.categoryAssist, { color: colors.textSecondary }]} numberOfLines={1}>
                                                    받은 카테고리 · {getCategorySharePermissionLabel(category.sharePermission)}
                                                </Text>
                                            )}
                                        </View>
                                    </View>
                                    <View style={styles.rowActions}>
                                        {!isShared && (
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={() => setSharingCategory(category)}
                                                accessibilityLabel={`${category.title} 공유`}
                                                accessibilityState={{ disabled: controlsBusy }}
                                                disabled={controlsBusy}
                                                style={({ pressed }) => [
                                                    styles.iconAction,
                                                    { opacity: controlsBusy ? 0.32 : pressed ? 0.55 : 1 },
                                                ]}
                                            >
                                                <Ionicons accessible={false} name="share-social-outline" size={20} color={colors.textPrimary} />
                                            </Pressable>
                                        )}
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`${category.title} 수정`}
                                            accessibilityState={{ disabled: isShared || controlsBusy }}
                                            onPress={() => startEditing(category)}
                                            disabled={isShared || controlsBusy}
                                            style={({ pressed }) => [
                                                styles.iconAction,
                                                { opacity: isShared || controlsBusy ? 0.32 : pressed ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons accessible={false} name="create-outline" size={20} color={colors.textPrimary} />
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`${category.title} 삭제`}
                                            accessibilityState={{ disabled: isShared || controlsBusy }}
                                            onPress={() => confirmDelete(category.id)}
                                            disabled={isShared || controlsBusy}
                                            style={({ pressed }) => [
                                                styles.iconAction,
                                                { opacity: isShared || controlsBusy ? 0.32 : pressed ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons
                                                accessible={false}
                                                name="trash-outline"
                                                size={20}
                                                color={mode === "dark" ? "#ff6961" : "#d70015"}
                                            />
                                        </Pressable>
                                    </View>
                                </View>
                            )}
                        </View>
                    );
                })}
                {!loading && !loadError && categoryList.length === 0 ? (
                    <View
                        style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                        <Ionicons accessible={false} name="folder-open-outline" size={28} color={colors.textSecondary} />
                        <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>카테고리가 없어요</Text>
                        <Text style={[styles.emptyCaption, { color: colors.textSecondary }]}>위에서 첫 카테고리를 추가해 주세요.</Text>
                    </View>
                ) : null}
            </ScrollView>
            <ShareInvitationSheet
                visible={!!sharingCategory}
                resourceType="category"
                resourceId={sharingCategory?.id}
                title={sharingCategory?.title ?? "카테고리"}
                subtitle="이 카테고리에 포함된 일정을 함께 볼 수 있어요"
                onClose={() => setSharingCategory(null)}
            />
        </KeyboardAvoidingView>
    );
}

function ColorPicker({
    value,
    onChange,
    disabled = false,
}: {
    value: string;
    onChange: (color: string) => void;
    disabled?: boolean;
}) {
    const { colors } = useTheme();

    return (
        <View style={styles.colorRow}>
            {CATEGORY_COLORS.map((color, index) => {
                const selected = color === value;
                return (
                    <Pressable
                        key={color}
                        accessibilityRole="radio"
                        accessibilityLabel={`${CATEGORY_COLOR_LABELS[index]} 색상`}
                        accessibilityState={{ selected, disabled }}
                        disabled={disabled}
                        onPress={() => onChange(color)}
                        style={[
                            styles.colorButton,
                            disabled && styles.disabledControl,
                            {
                                borderColor: selected ? colors.textPrimary : "transparent",
                            },
                        ]}
                    >
                        <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        minHeight: 60,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerButtonGhost: {
        width: 44,
        height: 44,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0,
    },
    content: {
        paddingHorizontal: 20,
        gap: 16,
    },
    card: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    input: {
        height: 46,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 13,
        fontSize: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    colorRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
    },
    colorButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    colorSwatch: {
        width: 28,
        height: 28,
        borderRadius: 14,
    },
    disabledControl: {
        opacity: 0.4,
    },
    primaryButton: {
        height: 46,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    primaryButtonText: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    listHeader: {
        minHeight: 28,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    categoryCard: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
    },
    categoryRow: {
        minHeight: 62,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    categoryInfo: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    categoryDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
    },
    categoryTitle: {
        flex: 1,
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 0,
    },
    categoryTitleWrap: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    categoryTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    categoryAssist: {
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0,
    },
    sharedBadge: {
        height: 24,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    sharedBadgeText: {
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0,
    },
    rowActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    iconAction: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    editBody: {
        padding: 14,
        gap: 12,
    },
    editActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    secondaryButton: {
        flex: 1,
        height: 42,
        borderWidth: 1,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryButtonText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    editSaveButton: {
        flex: 1,
        height: 42,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    emptyCard: {
        minHeight: 132,
        borderWidth: 1,
        borderRadius: 16,
        padding: 20,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: "800",
    },
    emptyCaption: {
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
});
