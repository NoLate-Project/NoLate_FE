import { useCallback, useEffect, useRef, useState } from "react";
import { Animated } from "react-native";

import { CATEGORY_PICKER_MARGIN, isDateType, pickerTargetH, type PickerType } from "./scheduleEditPresentation";

/** 카테고리 선택 영역의 열림·닫힘 상태와 여백·화살표 애니메이션을 함께 관리합니다. */
export function useCategoryPickerAnimation(initialOpen: boolean) {
    const [categoryPickerOpen, setCategoryPickerOpen] = useState(initialOpen);
    const [categoryPickerClosing, setCategoryPickerClosing] = useState(false);
    const categoryPickerOpenRef = useRef(initialOpen);
    const categoryPickerSpacingAnim = useRef(new Animated.Value(0)).current;

    /** 선택 영역 상태를 갱신하고 닫힘 애니메이션 동안 콘텐츠가 유지되도록 종료 상태를 표시합니다. */
    const setCategoryPickerExpanded = useCallback((expanded: boolean) => {
        const wasOpen = categoryPickerOpenRef.current;
        categoryPickerOpenRef.current = expanded;
        setCategoryPickerOpen(expanded);
        if (expanded) setCategoryPickerClosing(false);
        else if (wasOpen) setCategoryPickerClosing(true);
    }, []);

    /** 현재 열려 있는 카테고리 선택 영역을 닫습니다. */
    const closeCategoryPicker = useCallback(() => setCategoryPickerExpanded(false), [setCategoryPickerExpanded]);

    /** 현재 상태의 반대값으로 카테고리 선택 영역을 전환합니다. */
    const toggleCategoryPicker = useCallback(() => {
        setCategoryPickerExpanded(!categoryPickerOpenRef.current);
    }, [setCategoryPickerExpanded]);

    useEffect(() => {
        const animation = categoryPickerOpen
            ? Animated.spring(categoryPickerSpacingAnim, {
                toValue: 1, useNativeDriver: false, damping: 18, stiffness: 160, mass: 0.8,
            })
            : Animated.timing(categoryPickerSpacingAnim, { toValue: 0, duration: 200, useNativeDriver: false });
        animation.start(({ finished }) => {
            if (finished && !categoryPickerOpen) setCategoryPickerClosing(false);
        });
        return () => animation.stop();
    }, [categoryPickerOpen, categoryPickerSpacingAnim]);

    return {
        categoryPickerOpen,
        categoryPickerClosing,
        setCategoryPickerExpanded,
        closeCategoryPicker,
        toggleCategoryPicker,
        categoryPickerMarginBottom: categoryPickerSpacingAnim.interpolate({
            inputRange: [0, 1], outputRange: [-CATEGORY_PICKER_MARGIN, 0],
        }),
        categoryChevronRotation: categoryPickerSpacingAnim.interpolate({
            inputRange: [0, 1], outputRange: ["0deg", "180deg"],
        }),
    };
}

/** 날짜·시간 피커 종류가 바뀔 때 컨테이너 높이와 콘텐츠 투명도를 자연스럽게 전환합니다. */
export function useScheduleDateTimePickerAnimation() {
    const [picker, setPicker] = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);
    const heightAnim = useRef(new Animated.Value(0)).current;
    const outerOpacity = useRef(new Animated.Value(0)).current;
    const contentFade = useRef(new Animated.Value(1)).current;
    const prevPickerRef = useRef<PickerType | null>(null);

    /** 지정한 피커를 열고, 이미 같은 피커가 열려 있으면 닫습니다. */
    const togglePicker = useCallback((type: PickerType) => {
        setPicker((previous) => previous === type ? null : type);
    }, []);

    useEffect(() => {
        const previous = prevPickerRef.current;
        prevPickerRef.current = picker;
        if (picker !== null && previous === null) {
            setDisplayPicker(picker);
            Animated.parallel([
                Animated.spring(heightAnim, {
                    toValue: pickerTargetH(picker), useNativeDriver: false, damping: 18, stiffness: 160, mass: 0.8,
                }),
                Animated.timing(outerOpacity, { toValue: 1, duration: 200, useNativeDriver: false }),
            ]).start();
        } else if (picker === null && previous !== null) {
            Animated.parallel([
                Animated.timing(heightAnim, { toValue: 0, duration: 220, useNativeDriver: false }),
                Animated.timing(outerOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
            ]).start(({ finished }) => {
                if (finished) setDisplayPicker(null);
            });
        } else if (picker !== null && previous !== null) {
            if (isDateType(picker) !== isDateType(previous)) {
                Animated.timing(contentFade, { toValue: 0, duration: 120, useNativeDriver: false })
                    .start(({ finished }) => {
                        if (!finished) return;
                        setDisplayPicker(picker);
                        Animated.parallel([
                            Animated.spring(heightAnim, {
                                toValue: pickerTargetH(picker), useNativeDriver: false,
                                damping: 18, stiffness: 160, mass: 0.8,
                            }),
                            Animated.timing(contentFade, { toValue: 1, duration: 220, useNativeDriver: false }),
                        ]).start();
                    });
            } else setDisplayPicker(picker);
        }
    }, [contentFade, heightAnim, outerOpacity, picker]);

    return { picker, setPicker, displayPicker, togglePicker, heightAnim, outerOpacity, contentFade };
}
