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
    expanded?: boolean;
    hideTrigger?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
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
    expanded,
    hideTrigger = false,
    onExpandedChange,
}: Props) {
    const { colors, mode } = useTheme();
    const [internalOpen, setInternalOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
    const open = expanded ?? internalOpen;

    const updateOpen = (nextOpen: boolean) => {
        if (!nextOpen && open) setClosing(true);
        if (nextOpen) setClosing(false);
        if (expanded === undefined) setInternalOpen(nextOpen);
        onExpandedChange?.(nextOpen);
    };

    const expandAnim = useRef(new Animated.Value(0)).current;
    const prevOpenRef = useRef(false);

    useEffect(() => {
        const wasOpen = prevOpenRef.current;
        prevOpenRef.current = open;
        let animation: Animated.CompositeAnimation | undefined;

        if (open && !wasOpen) {
            setClosing(false);
            animation = Animated.spring(expandAnim, {
                toValue: 1,
                useNativeDriver: false,
                damping: 18,
                stiffness: 160,
                mass: 0.8,
            });
        } else if (!open && wasOpen) {
            setClosing(true);
            animation = Animated.timing(expandAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            });
        }

        animation?.start(({ finished }) => {
            if (finished && !open) setClosing(false);
        });
        return () => animation?.stop();
    }, [open, expandAnim]);

    const estimatedContentHeight =
        ITEM_HEIGHT * categories.length + (onManageCategories ? MANAGE_BUTTON_HEIGHT : 0);
    const targetHeight = measuredContentHeight || estimatedContentHeight;

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
    const canOpen = categories.length > 0 || Boolean(onManageCategories);
    const selectionAccent = mode === "dark" ? "#4B9DFF" : "#2979FF";

    return (
        <View style={styles.root}>
            {!hideTrigger ? (
                <>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>
                        {label}
                    </Text>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${label} 선택, 현재 ${selected?.title ?? "선택 안 됨"}`}
                        accessibilityState={{ expanded: open, disabled: !canOpen }}
                        disabled={!canOpen}
                        onPress={() => updateOpen(!open)}
                        style={[
                            styles.selector,
                            {
                                borderColor: open ? selectionAccent : colors.border,
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
                            <Ionicons
                                accessible={false}
                                name="chevron-down"
                                size={17}
                                color={open ? selectionAccent : colors.textSecondary}
                            />
                        </Animated.View>
                    </Pressable>
                </>
            ) : null}

            <Animated.View
                testID="category-dropdown-transition"
                accessibilityElementsHidden={!open}
                importantForAccessibility={open ? "auto" : "no-hide-descendants"}
                pointerEvents={open ? "auto" : closing ? "box-only" : "none"}
                style={[
                    styles.dropdownWrap,
                    {
                        maxHeight: listMaxHeight,
                        opacity: expandAnim,
                    },
                ]}
            >
                <View
                    testID="category-dropdown-content"
                    onLayout={(event) => {
                        const nextHeight = Math.ceil(event.nativeEvent.layout.height);
                        if (nextHeight > 0 && nextHeight !== measuredContentHeight) {
                            setMeasuredContentHeight(nextHeight);
                        }
                    }}
                    style={[
                        styles.dropdown,
                        hideTrigger && styles.inlineDropdown,
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
                                accessibilityRole="radio"
                                accessibilityState={{ checked: active }}
                                accessibilityLabel={`${category.title} 카테고리`}
                                onPress={() => {
                                    updateOpen(false);
                                    onChange(category.id);
                                }}
                                style={[
                                    styles.categoryItem,
                                    {
                                        backgroundColor: active ? colors.surface2 : colors.surface,
                                    },
                                ]}
                            >
                                {index > 0 ? (
                                    <View
                                        testID={`category-divider-${category.id}`}
                                        pointerEvents="none"
                                        style={[
                                            styles.itemDivider,
                                            { backgroundColor: colors.border },
                                        ]}
                                    />
                                ) : null}
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
                                    accessible={false}
                                    name="checkmark"
                                    size={18}
                                    color={active ? selectionAccent : "transparent"}
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
                                accessibilityRole="button"
                                accessibilityLabel="카테고리 관리 열기"
                                onPress={() => {
                                    updateOpen(false);
                                    onManageCategories();
                                }}
                                style={({ pressed }) => [
                                    styles.manageButton,
                                    { opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <Ionicons accessible={false} name="folder-open-outline" size={20} color={colors.textPrimary} />
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
    inlineDropdown: {
        marginTop: 0,
    },
    categoryItem: {
        minHeight: ITEM_HEIGHT,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    itemDivider: {
        position: "absolute",
        top: 0,
        right: 0,
        left: 34,
        height: StyleSheet.hairlineWidth,
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
        paddingVertical: 10,
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
