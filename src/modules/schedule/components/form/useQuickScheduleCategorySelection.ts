import { useEffect, useMemo, useRef, useState } from "react";
import { Animated } from "react-native";

import { canWriteScheduleCategory } from "../../categoryPermissions";
import type { ScheduleCategory } from "../../types";

type Options = {
    categories?: ScheduleCategory[];
    defaultCategory?: ScheduleCategory;
    visible: boolean;
};

/** 쓰기 권한이 있는 카테고리만 남기고 같은 식별자가 반복되면 첫 항목만 유지한다. */
function resolveWritableCategories(
    categories: ScheduleCategory[] | undefined,
    defaultCategory: ScheduleCategory | undefined,
) {
    const available = categories ?? (defaultCategory ? [defaultCategory] : []);
    const seenIds = new Set<string>();

    return available.filter(category => {
        if (!canWriteScheduleCategory(category) || seenIds.has(category.id)) return false;
        seenIds.add(category.id);
        return true;
    });
}

/**
 * 빠른 일정 미리보기에서 사용할 카테고리 선택 상태와 펼침 애니메이션을 관리한다.
 * 카테고리 목록이 갱신되면 선택할 수 없는 값을 안전한 기본 카테고리로 교체한다.
 */
export function useQuickScheduleCategorySelection({ categories, defaultCategory, visible }: Options) {
    const writableCategories = useMemo(
        () => resolveWritableCategories(categories, defaultCategory),
        [categories, defaultCategory],
    );
    const initialCategoryId = defaultCategory
        && canWriteScheduleCategory(defaultCategory)
        && writableCategories.some(category => category.id === defaultCategory.id)
        ? defaultCategory.id
        : writableCategories[0]?.id ?? "";
    const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId);
    const [previewCategoryPickerOpen, setPreviewCategoryPickerOpen] = useState(false);
    const selectedCategory = useMemo(
        () => writableCategories.find(category => category.id === selectedCategoryId),
        [selectedCategoryId, writableCategories],
    );
    const previewCategoryChevronAnim = useRef(new Animated.Value(0)).current;
    const previewCategoryChevronRotation = previewCategoryChevronAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "180deg"],
    });
    const previewCategoryPickerMarginBottom = previewCategoryChevronAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-12, 0],
    });
    const previewCategoryPickerPaddingTop = previewCategoryChevronAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 6],
    });

    useEffect(() => {
        const animation = previewCategoryPickerOpen
            ? Animated.spring(previewCategoryChevronAnim, {
                toValue: 1,
                useNativeDriver: false,
                damping: 18,
                stiffness: 160,
                mass: 0.8,
            })
            : Animated.timing(previewCategoryChevronAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            });
        animation.start();
        return () => animation.stop();
    }, [previewCategoryChevronAnim, previewCategoryPickerOpen]);

    useEffect(() => {
        if (writableCategories.length === 0) setPreviewCategoryPickerOpen(false);
    }, [writableCategories.length]);

    useEffect(() => {
        if (!visible || selectedCategory) return;

        const initialCategory = defaultCategory
            && canWriteScheduleCategory(defaultCategory)
            && writableCategories.some(category => category.id === defaultCategory.id)
            ? defaultCategory
            : writableCategories[0];
        if (initialCategory) setSelectedCategoryId(initialCategory.id);
    }, [defaultCategory, selectedCategory, visible, writableCategories]);

    return {
        previewCategoryChevronRotation,
        previewCategoryPickerMarginBottom,
        previewCategoryPickerOpen,
        previewCategoryPickerPaddingTop,
        selectedCategory,
        selectedCategoryId,
        setPreviewCategoryPickerOpen,
        setSelectedCategoryId,
        writableCategories,
    };
}
