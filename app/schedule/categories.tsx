import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
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
    updateScheduleCategoryToApi,
} from "../../src/api/scheduleCategories";
import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";

const CATEGORY_COLORS = [
    "#ff3b30",
    "#ff9500",
    "#34c759",
    "#007aff",
    "#5856d6",
    "#af52de",
    "#ff2d55",
];

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleCategoriesScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newColor, setNewColor] = useState(CATEGORY_COLORS[0]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingColor, setEditingColor] = useState(CATEGORY_COLORS[0]);

    const categoryList = useMemo(
        () => [...state.categories].filter((category) => category.id),
        [state.categories]
    );

    const loadCategories = useCallback(async () => {
        setLoading(true);
        try {
            const categories = await getScheduleCategoriesFromApi();
            dispatch({ type: "SET_CATEGORIES", categories });
        } catch (error) {
            Alert.alert("카테고리 조회 실패", getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [dispatch]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    const createCategory = async () => {
        const title = newTitle.trim();
        if (!title || saving) return;

        setSaving(true);
        try {
            const category = await createScheduleCategoryToApi(title, newColor);
            dispatch({ type: "UPSERT_CATEGORY", category });
            setNewTitle("");
            setNewColor(CATEGORY_COLORS[categoryList.length % CATEGORY_COLORS.length]);
        } catch (error) {
            Alert.alert("카테고리 추가 실패", getErrorMessage(error));
        } finally {
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
        if (!editingId || !editingTitle.trim() || saving) return;

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
            setSaving(false);
        }
    };

    const confirmDelete = (categoryId: string) => {
        if (categoryList.length <= 1) {
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
        setSaving(true);
        try {
            await deleteScheduleCategoryFromApi(categoryId);
            dispatch({ type: "REMOVE_CATEGORY", id: categoryId });
            if (editingId === categoryId) cancelEditing();
        } catch (error) {
            Alert.alert("카테고리 삭제 실패", getErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}
        >
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    accessibilityLabel="뒤로 가기"
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>카테고리 관리</Text>
                <View style={styles.headerButtonGhost} />
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
                        value={newTitle}
                        onChangeText={setNewTitle}
                        onSubmitEditing={createCategory}
                        placeholder="카테고리 이름"
                        placeholderTextColor={colors.textDisabled}
                        style={[
                            styles.input,
                            {
                                backgroundColor: colors.surface2,
                                borderColor: colors.border,
                                color: colors.textPrimary,
                            },
                        ]}
                    />
                    <ColorPicker value={newColor} onChange={setNewColor} />
                    <Pressable
                        disabled={!newTitle.trim() || saving}
                        onPress={createCategory}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            {
                                backgroundColor: colors.selectedDayBg,
                                opacity: !newTitle.trim() || saving ? 0.4 : pressed ? 0.75 : 1,
                            },
                        ]}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color={colors.selectedDayText} />
                        ) : (
                            <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                                추가
                            </Text>
                        )}
                    </Pressable>
                </View>

                <View style={styles.listHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>카테고리 목록</Text>
                    {loading && <ActivityIndicator size="small" color={colors.textSecondary} />}
                </View>

                {categoryList.map((category) => {
                    const editing = editingId === category.id;
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
                                        value={editingTitle}
                                        onChangeText={setEditingTitle}
                                        onSubmitEditing={saveEditing}
                                        placeholder="카테고리 이름"
                                        placeholderTextColor={colors.textDisabled}
                                        style={[
                                            styles.input,
                                            {
                                                backgroundColor: colors.surface2,
                                                borderColor: colors.border,
                                                color: colors.textPrimary,
                                            },
                                        ]}
                                    />
                                    <ColorPicker value={editingColor} onChange={setEditingColor} />
                                    <View style={styles.editActions}>
                                        <Pressable
                                            onPress={cancelEditing}
                                            style={[styles.secondaryButton, { borderColor: colors.border }]}
                                        >
                                            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
                                                취소
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            disabled={!editingTitle.trim() || saving}
                                            onPress={saveEditing}
                                            style={({ pressed }) => [
                                                styles.editSaveButton,
                                                {
                                                    backgroundColor: colors.selectedDayBg,
                                                    opacity: !editingTitle.trim() || saving ? 0.4 : pressed ? 0.75 : 1,
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
                                        <Text style={[styles.categoryTitle, { color: colors.textPrimary }]}>
                                            {category.title}
                                        </Text>
                                    </View>
                                    <View style={styles.rowActions}>
                                        <Pressable
                                            onPress={() => startEditing(category)}
                                            style={({ pressed }) => [
                                                styles.iconAction,
                                                { opacity: pressed ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
                                        </Pressable>
                                        <Pressable
                                            onPress={() => confirmDelete(category.id)}
                                            style={({ pressed }) => [
                                                styles.iconAction,
                                                { opacity: pressed ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Ionicons
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
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
    const { colors } = useTheme();

    return (
        <View style={styles.colorRow}>
            {CATEGORY_COLORS.map((color) => {
                const selected = color === value;
                return (
                    <Pressable
                        key={color}
                        onPress={() => onChange(color)}
                        style={[
                            styles.colorButton,
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
        alignItems: "center",
        gap: 8,
    },
    colorButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    colorSwatch: {
        width: 23,
        height: 23,
        borderRadius: 12,
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
    rowActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    iconAction: {
        width: 40,
        height: 40,
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
});
