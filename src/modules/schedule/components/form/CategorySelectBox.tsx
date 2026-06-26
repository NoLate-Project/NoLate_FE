import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";

export type ScheduleCategory = {
    id: string;
    title: string;
    color: string;
};

type Props = {
    label?: string;
    categories: ScheduleCategory[];
    value: string;
    onChange: (id: string) => void;
    onManageCategories?: () => void;
};

const ITEM_HEIGHT = 49;
const MANAGE_BUTTON_HEIGHT = 52;

// 일정 카테고리를 선택하고 별도 관리 화면으로 이동하는 드롭다운이다.
export default function CategorySelectBox({
    label = "카테고리",
    categories,
    value,
    onChange,
    onManageCategories,
}: Props) {
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);

    const expandAnim = useRef(new Animated.Value(0)).current;
    const prevOpenRef = useRef(false);

    useEffect(() => {
        const wasOpen = prevOpenRef.current;
        prevOpenRef.current = open;

        if (open && !wasOpen) {
            Animated.spring(expandAnim, {
                toValue: 1,
                useNativeDriver: false,
                damping: 18,
                stiffness: 160,
                mass: 0.8,
            }).start();
        } else if (!open && wasOpen) {
            Animated.timing(expandAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            }).start();
        }
    }, [open, expandAnim]);

    const targetHeight =
        ITEM_HEIGHT * categories.length + (onManageCategories ? MANAGE_BUTTON_HEIGHT : 0);

    const listMaxHeight = expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, targetHeight],
    });

    const arrowRotate = expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "180deg"],
    });

    const selected = useMemo(
        () => categories.find((category) => category.id === value),
        [categories, value]
    );

    return (
        <View style={styles.root}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
                {label}
            </Text>

            <Pressable
                onPress={() => setOpen((current) => !current)}
                style={[
                    styles.selector,
                    {
                        borderColor: open ? colors.selectedDayBg : colors.border,
                        backgroundColor: colors.surface2,
                    },
                ]}
            >
                <View style={styles.selectedRow}>
                    <View
                        style={[
                            styles.selectedDot,
                            { backgroundColor: selected?.color ?? colors.textDisabled },
                        ]}
                    />
                    <Text style={[styles.selectedText, { color: colors.textPrimary }]}>
                        {selected?.title ?? "선택"}
                    </Text>
                </View>

                <Animated.View style={{ transform: [{ rotate: arrowRotate }] }}>
                    <Ionicons name="chevron-down" size={17} color={colors.textSecondary} />
                </Animated.View>
            </Pressable>

            <Animated.View
                style={[
                    styles.dropdownWrap,
                    {
                        maxHeight: listMaxHeight,
                        opacity: expandAnim,
                    },
                ]}
            >
                <View
                    style={[
                        styles.dropdown,
                        {
                            borderColor: colors.border,
                            backgroundColor: colors.surface,
                        },
                    ]}
                >
                    {categories.map((category, index) => {
                        const active = category.id === value;
                        return (
                            <Pressable
                                key={category.id}
                                onPress={() => {
                                    onChange(category.id);
                                    setOpen(false);
                                }}
                                style={[
                                    styles.categoryItem,
                                    {
                                        backgroundColor: active ? colors.surface2 : colors.surface,
                                        borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                                        borderTopColor: colors.border,
                                    },
                                ]}
                            >
                                <View style={styles.categoryTitleRow}>
                                    <View
                                        style={[
                                            styles.categoryDot,
                                            { backgroundColor: category.color },
                                        ]}
                                    />
                                    <Text
                                        style={[
                                            styles.categoryText,
                                            { color: colors.textPrimary },
                                        ]}
                                    >
                                        {category.title}
                                    </Text>
                                </View>
                                <Ionicons
                                    name="checkmark"
                                    size={18}
                                    color={active ? colors.textPrimary : "transparent"}
                                />
                            </Pressable>
                        );
                    })}

                    {onManageCategories && (
                        <>
                            <View
                                style={[
                                    styles.divider,
                                    { backgroundColor: colors.border },
                                ]}
                            />
                            <Pressable
                                onPress={() => {
                                    setOpen(false);
                                    onManageCategories();
                                }}
                                style={({ pressed }) => [
                                    styles.manageButton,
                                    { opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <Ionicons name="folder-open-outline" size={20} color={colors.textPrimary} />
                                <Text style={[styles.manageText, { color: colors.textPrimary }]}>
                                    카테고리 관리
                                </Text>
                            </Pressable>
                        </>
                    )}
                </View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        marginBottom: 12,
    },
    label: {
        marginBottom: 6,
        fontSize: 13,
        fontWeight: "600",
        letterSpacing: 0,
    },
    selector: {
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    selectedRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    selectedDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    selectedText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    dropdownWrap: {
        overflow: "hidden",
    },
    dropdown: {
        marginTop: 6,
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
    categoryItem: {
        minHeight: ITEM_HEIGHT,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    categoryTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    categoryDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    categoryText: {
        fontSize: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
    },
    manageButton: {
        minHeight: MANAGE_BUTTON_HEIGHT,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    manageText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
});
