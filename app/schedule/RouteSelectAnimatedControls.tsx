import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
    Alert,
    Animated,
    Easing,
    LayoutAnimation,
    Linking,
    Platform,
    Pressable,
    Text,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import type { RouteAlternativeOption } from "../../src/modules/map/routingService";
import type { TravelMode } from "../../src/modules/schedule/types";
import styles from "./route-select.styles";

/** 장식용 아이콘이 접근성 탐색에 중복 노출되지 않도록 공통 속성을 적용한다. */
export function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

export const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];
export const MAP_PICKER_FALLBACK_LAT = 37.5665;
export const MAP_PICKER_FALLBACK_LNG = 126.978;
export const MAP_PICKER_DEFAULT_ZOOM = 14;

/** 현재 플랫폼에 맞는 앱 또는 위치 서비스 설정 화면을 연다. 실패하면 호출부가 별도 복구 흐름을 선택할 수 있도록 예외를 내부에서 안내한다. */
export async function openDeviceLocationSettings(preferServiceSettings = false) {
    try {
        if (preferServiceSettings && Platform.OS === "android") {
            await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
            return;
        }
        await Linking.openSettings();
    } catch {
        Alert.alert("설정을 열 수 없어요", "기기 설정에서 NoLate의 위치 권한을 확인해 주세요.");
    }
}

/** 위치 권한이나 서비스가 꺼진 경우 설정 화면으로 이동할 수 있는 표준 안내창을 표시한다. */
export function showLocationSettingsAlert(title: string, message: string, preferServiceSettings = false) {
    Alert.alert(title, message, [
        { text: "취소", style: "cancel" },
        {
            text: "설정 열기",
            onPress: () => {
                openDeviceLocationSettings(preferServiceSettings).catch(() => undefined);
            },
        },
    ]);
}

export type TransitRouteFilter = "ALL" | "SUBWAY" | "BUS" | "MIXED";
export type RouteSelectTransitLeg = NonNullable<RouteAlternativeOption["transitLegs"]>[number];
export type RouteProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    minutes: number;
    color: string;
    kind: RouteSelectTransitLeg["kind"] | "TRANSFER";
    flex: number;
    isRide: boolean;
};
export type RouteMetricChip = {
    key: string;
    label: string;
};
export type RouteDropdownSummaryKind = RouteSelectTransitLeg["kind"] | "TRANSFER";
export type RouteDropdownSummaryItem = {
    key: string;
    kind: RouteDropdownSummaryKind;
    color?: string;
    title: string;
    subtitle?: string;
};
export type PlaceListIconName = React.ComponentProps<typeof Ionicons>["name"];
export type PlaceIconSource = {
    name?: string;
    address?: string;
    category?: string;
};
export type AnimatedTravelModeButtonProps = {
    selected: boolean;
    label: string;
    iconName: React.ComponentProps<typeof Ionicons>["name"];
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    onPress: () => void;
};
export type AnimatedTransitFilterButtonProps = {
    selected: boolean;
    disabled: boolean;
    label: string;
    textColor: string;
    accentColor: string;
    onPress: () => void;
};
export type AnimatedRouteCardShellProps = {
    selected: boolean;
    style: StyleProp<ViewStyle>;
    children: React.ReactNode;
};
export type AnimatedRouteExpansionProps = {
    children: React.ReactNode;
    style: StyleProp<ViewStyle>;
};

export const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "BUS", label: "버스" },
    { key: "SUBWAY", label: "지하철" },
    { key: "MIXED", label: "버스+지하철" },
];
export const FAVORITE_CATEGORY_COLORS = [
    "#4B9DFF",
    "#22C55E",
    "#F0524C",
    "#F59E0B",
    "#A855F7",
    "#14B8A6",
    "#64748B",
];
export const ROUTE_SEGMENT_FALLBACK_COLORS = {
    walk: "#9CA3AF",
    bus: "#2979FF",
    subway: "#00B140",
    etc: "#7C8794",
};

export const TRAVEL_MODE_ICONS: Partial<Record<TravelMode, React.ComponentProps<typeof Ionicons>["name"]>> = {
    CAR: "car",
    TRANSIT: "bus",
    WALK: "walk",
    BIKE: "bicycle",
};
/** 선택 여부를 0~1 스프링 값으로 변환해 버튼과 카드가 같은 전환 감각을 공유하게 한다. */
export function useSelectedSpring(selected: boolean) {
    const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        Animated.spring(progress, {
            toValue: selected ? 1 : 0,
            friction: 8,
            tension: 120,
            useNativeDriver: true,
        }).start();
    }, [progress, selected]);

    return progress;
}

/** 이동수단 선택 상태를 아이콘 크기와 카드 스케일로 표현하고 접근성 선택 상태를 함께 제공한다. */
export function AnimatedTravelModeButton({
    selected,
    label,
    iconName,
    backgroundColor,
    borderColor,
    textColor,
    onPress,
}: AnimatedTravelModeButtonProps) {
    const progress = useSelectedSpring(selected);
    const scale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.018],
    });

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            style={[styles.modeButtonShell, selected && styles.modeButtonShellSelected]}
        >
            <Animated.View
                style={[
                    styles.modeButton,
                    selected ? styles.modeButtonSelected : styles.modeButtonIconOnly,
                    {
                        backgroundColor,
                        borderColor,
                        transform: [{ scale }],
                    },
                ]}
            >
                <Ionicons name={iconName} size={selected ? 22 : 24} color={textColor} />
            </Animated.View>
        </Pressable>
    );
}

/** 대중교통 필터 선택 여부를 하단 인디케이터 애니메이션으로 표시하며 비활성 상태의 입력을 차단한다. */
export function AnimatedTransitFilterButton({
    selected,
    disabled,
    label,
    textColor,
    accentColor,
    onPress,
}: AnimatedTransitFilterButtonProps) {
    const progress = useSelectedSpring(selected);
    const indicatorScale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.32, 1],
    });

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${label} 경로 필터`}
            accessibilityState={{ selected, disabled }}
            style={[
                styles.transitFilterTab,
                {
                    opacity: disabled ? 0.38 : 1,
                    borderColor: "transparent",
                    backgroundColor: "transparent",
                },
            ]}
        >
            <Text style={[styles.transitFilterText, { color: textColor }]}>
                {label}
            </Text>
            <Animated.View
                style={[
                    styles.transitFilterIndicator,
                    {
                        backgroundColor: accentColor,
                        opacity: progress,
                        transform: [{ scaleX: indicatorScale }],
                    },
                ]}
            />
        </Pressable>
    );
}

/** 선택된 경로 카드에 미세한 스프링 스케일을 적용해 선택 피드백을 제공한다. */
export function AnimatedRouteCardShell({ selected, style, children }: AnimatedRouteCardShellProps) {
    const progress = useSelectedSpring(selected);
    const scale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.997, 1],
    });

    return (
        <Animated.View style={[style, { transform: [{ scale }] }]}>
            {children}
        </Animated.View>
    );
}

/** 경로 상세 내용이 열릴 때 투명도와 세로 이동을 결합한 짧은 진입 애니메이션을 적용한다. */
export function AnimatedRouteExpansion({ children, style }: AnimatedRouteExpansionProps) {
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(progress, {
            toValue: 1,
            duration: 190,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [progress]);

    const translateY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-4, 0],
    });

    return (
        <Animated.View
            style={[
                style,
                {
                    opacity: progress,
                    transform: [{ translateY }],
                },
            ]}
        >
            {children}
        </Animated.View>
    );
}

/** 즐겨찾기 필터의 활성 막대를 애니메이션하며 동작 줄이기 설정에서는 즉시 상태를 반영한다. */
export function FavoriteFilterSelectionIndicator({
    selected,
    color,
    reduceMotionEnabled,
}: {
    selected: boolean;
    color: string;
    reduceMotionEnabled: boolean;
}) {
    const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        progress.stopAnimation();
        if (reduceMotionEnabled) {
            progress.setValue(selected ? 1 : 0);
            return;
        }
        const animation = Animated.timing(progress, {
            toValue: selected ? 1 : 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [progress, reduceMotionEnabled, selected]);

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                styles.favoriteFilterIndicator,
                {
                    backgroundColor: color,
                    opacity: progress,
                    transform: [{
                        scaleX: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.35, 1],
                        }),
                    }],
                },
            ]}
        />
    );
}

/** 경로 카드가 펼쳐지거나 접힐 때 생성·갱신·삭제 레이아웃 전환을 동일한 시간으로 설정한다. */
export function configureRouteExpansionAnimation(duration = 210) {
    LayoutAnimation.configureNext({
        duration,
        create: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
        update: {
            type: LayoutAnimation.Types.easeInEaseOut,
        },
        delete: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
    });
}
