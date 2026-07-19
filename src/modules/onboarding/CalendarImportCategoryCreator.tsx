import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import {
    createScheduleCategoryToApi,
    type ScheduleCategoryItem,
} from "../../api/scheduleCategories";
import { canWriteScheduleCategory } from "../schedule/categoryPermissions";
import { useTheme } from "../theme/ThemeContext";

const CATEGORY_COLORS = [
    "#ff3b30",
    "#ff9500",
    "#34c759",
    "#007aff",
    "#5856d6",
    "#af52de",
    "#ff2d55",
] as const;

const CATEGORY_COLOR_LABELS = ["빨강", "주황", "초록", "파랑", "남색", "보라", "분홍"] as const;

type CalendarImportCategoryCreatorProps = {
    categoryCount: number;
    disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
    onCreated: (category: ScheduleCategoryItem) => void;
};

function getCreateErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "카테고리를 추가하지 못했어요. 다시 시도해 주세요.";
}

export default function CalendarImportCategoryCreator({
    categoryCount,
    disabled = false,
    onBusyChange,
    onCreated,
}: CalendarImportCategoryCreatorProps) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    const mutationPendingRef = useRef(false);
    const [expanded, setExpanded] = useState(false);
    const [title, setTitle] = useState("");
    const [color, setColor] = useState<string>(CATEGORY_COLORS[categoryCount % CATEGORY_COLORS.length]);
    const [saving, setSaving] = useState(false);

    const controlsDisabled = disabled || saving;
    const canCreate = title.trim().length > 0 && !controlsDisabled;

    const openCreator = () => {
        if (disabled || mutationPendingRef.current) return;
        setColor(CATEGORY_COLORS[categoryCount % CATEGORY_COLORS.length]);
        setExpanded(true);
    };

    const closeCreator = () => {
        if (controlsDisabled || mutationPendingRef.current) return;
        Keyboard.dismiss();
        setTitle("");
        setExpanded(false);
    };

    const createCategory = async () => {
        const nextTitle = title.trim();
        if (!nextTitle || disabled || mutationPendingRef.current) return;

        mutationPendingRef.current = true;
        setSaving(true);
        onBusyChange?.(true);

        try {
            const category = await createScheduleCategoryToApi(nextTitle, color);
            if (!canWriteScheduleCategory(category)) {
                throw new Error("추가된 카테고리를 확인하지 못했어요. 다시 시도해 주세요.");
            }

            onCreated(category);
            Keyboard.dismiss();
            setTitle("");
            setExpanded(false);
        } catch (error) {
            Alert.alert("카테고리 추가 실패", getCreateErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
            onBusyChange?.(false);
        }
    };

    if (!expanded) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="새 카테고리 추가"
                accessibilityHint="가져올 일정을 분류할 카테고리를 바로 만듭니다"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={openCreator}
                style={({ pressed }) => [
                    styles.openButton,
                    disabled && styles.disabled,
                    pressed && !disabled && styles.pressed,
                ]}
            >
                <View style={styles.openIcon}>
                    <Ionicons accessible={false} name="add" size={19} color={colors.selectedDayText} />
                </View>
                <View style={styles.openCopy}>
                    <Text style={styles.openTitle}>새 카테고리 추가</Text>
                    <Text style={styles.openCaption}>이 화면을 벗어나지 않고 바로 만들 수 있어요</Text>
                </View>
                <Ionicons accessible={false} name="chevron-down" size={17} color={colors.textSecondary} />
            </Pressable>
        );
    }

    return (
        <View style={styles.creatorCard}>
            <View style={styles.creatorHeader}>
                <View style={styles.openIcon}>
                    <Ionicons accessible={false} name="add" size={19} color={colors.selectedDayText} />
                </View>
                <View style={styles.openCopy}>
                    <Text style={styles.openTitle}>새 카테고리</Text>
                    <Text style={styles.openCaption}>추가하면 이번 일정에 바로 선택돼요</Text>
                </View>
            </View>

            <TextInput
                autoFocus
                accessibilityLabel="새 카테고리 이름"
                autoComplete="off"
                editable={!controlsDisabled}
                maxLength={80}
                onChangeText={setTitle}
                onSubmitEditing={() => {
                    createCategory().catch(() => undefined);
                }}
                placeholder="예: 운동, 가족, 사이드 프로젝트"
                placeholderTextColor={colors.inputPlaceholder}
                returnKeyType="done"
                secureTextEntry={false}
                textContentType="none"
                value={title}
                style={styles.input}
            />

            <View accessibilityRole="radiogroup" style={styles.colorRow}>
                {CATEGORY_COLORS.map((item, index) => {
                    const selected = color === item;
                    return (
                        <Pressable
                            key={item}
                            accessibilityRole="radio"
                            accessibilityLabel={`${CATEGORY_COLOR_LABELS[index]} 색상`}
                            accessibilityState={{ checked: selected, disabled: controlsDisabled }}
                            disabled={controlsDisabled}
                            onPress={() => setColor(item)}
                            style={({ pressed }) => [
                                styles.colorButton,
                                selected && styles.colorButtonSelected,
                                pressed && !controlsDisabled && styles.pressed,
                            ]}
                        >
                            <View style={[styles.colorSwatch, { backgroundColor: item }]} />
                        </Pressable>
                    );
                })}
            </View>

            <View style={styles.actionRow}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="새 카테고리 추가 취소"
                    accessibilityState={{ disabled: controlsDisabled }}
                    disabled={controlsDisabled}
                    onPress={closeCreator}
                    style={({ pressed }) => [
                        styles.cancelButton,
                        controlsDisabled && styles.disabled,
                        pressed && !controlsDisabled && styles.pressed,
                    ]}
                >
                    <Text style={styles.cancelButtonText}>취소</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="카테고리 만들기"
                    accessibilityState={{ busy: saving, disabled: !canCreate }}
                    disabled={!canCreate}
                    onPress={() => {
                        createCategory().catch(() => undefined);
                    }}
                    style={({ pressed }) => [
                        styles.createButton,
                        !canCreate && styles.disabled,
                        pressed && canCreate && styles.pressed,
                    ]}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color={colors.selectedDayText} />
                    ) : (
                        <Ionicons accessible={false} name="checkmark" size={17} color={colors.selectedDayText} />
                    )}
                    <Text style={styles.createButtonText}>{saving ? "추가 중" : "추가"}</Text>
                </Pressable>
            </View>
        </View>
    );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"], mode: "dark" | "light") {
    const isDark = mode === "dark";

    return StyleSheet.create({
        openButton: {
            minHeight: 64,
            paddingHorizontal: 13,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
        },
        openIcon: {
            width: 30,
            height: 30,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.selectedDayBg,
        },
        openCopy: {
            flex: 1,
            minWidth: 0,
            gap: 2,
        },
        openTitle: {
            color: colors.textPrimary,
            fontSize: 13,
            lineHeight: 18,
            fontWeight: "900",
        },
        openCaption: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "700",
        },
        creatorCard: {
            padding: 13,
            gap: 12,
            borderRadius: 18,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)",
            backgroundColor: colors.surface2,
        },
        creatorHeader: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        input: {
            minHeight: 50,
            paddingHorizontal: 13,
            paddingVertical: 0,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.inputBorder,
            backgroundColor: colors.inputBackground,
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "800",
        },
        colorRow: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
        },
        colorButton: {
            width: 36,
            height: 36,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: "transparent",
        },
        colorButtonSelected: {
            borderColor: colors.textPrimary,
        },
        colorSwatch: {
            width: 24,
            height: 24,
            borderRadius: 8,
        },
        actionRow: {
            flexDirection: "row",
            justifyContent: "flex-end",
            gap: 8,
        },
        cancelButton: {
            minWidth: 70,
            minHeight: 42,
            paddingHorizontal: 14,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
        },
        cancelButtonText: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: "900",
        },
        createButton: {
            minWidth: 88,
            minHeight: 42,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            borderRadius: 14,
            backgroundColor: colors.selectedDayBg,
        },
        createButtonText: {
            color: colors.selectedDayText,
            fontSize: 13,
            fontWeight: "900",
        },
        disabled: {
            opacity: 0.45,
        },
        pressed: {
            opacity: 0.72,
            transform: [{ scale: 0.99 }],
        },
    });
}
