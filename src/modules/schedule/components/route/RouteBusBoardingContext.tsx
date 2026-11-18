import React, { useEffect, useState, type RefObject } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { Ionicons } from './RouteStepTimeline.helpers';

export type BusBoardingScroll = {
    ref: RefObject<ScrollView | null>;
    offset: Animated.Value;
};

const HEIGHT = 44;

/** Keeps the boarding reference in view only while the open stop list is scrolling past it. */
export function RouteBusBoardingContext({ scroll, getRow, line, clock, stop, color, textColor, surface, border }: {
    scroll: BusBoardingScroll;
    getRow: () => View | undefined;
    line: string;
    clock?: string;
    stop: string;
    color: string;
    textColor: string;
    surface: string;
    border: string;
}) {
    const [bounds, setBounds] = useState<{ top: number; height: number }>();

    useEffect(() => {
        let active = true;
        const frame = requestAnimationFrame(() => {
            // ScrollView exposes this native reference in its imperative API.
            const scrollView = scroll.ref.current as (ScrollView & { getInnerViewRef?: () => HostInstance | null }) | null;
            const content = scrollView?.getInnerViewRef?.();
            if (!content) return;
            getRow()?.measureLayout(content, (_x, top, _width, height) => {
                if (!active) return;
                setBounds(current => current?.top === top && current.height === height ? current : { top, height });
            });
        });
        return () => {
            active = false;
            cancelAnimationFrame(frame);
        };
    }, [getRow, scroll.ref]);

    if (!bounds || bounds.height <= HEIGHT) return null;
    const start = Math.max(0, bounds.top);
    const opacity = scroll.offset.interpolate({ inputRange: [start, start + 1], outputRange: [0, 1], extrapolate: 'clamp' });
    const translateY = scroll.offset.interpolate({
        inputRange: [start, start + bounds.height - HEIGHT],
        outputRange: [0, bounds.height - HEIGHT],
        extrapolate: 'clamp',
    });

    return (
        <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            testID="route-pinned-bus-boarding"
            style={[styles.header, { backgroundColor: surface, borderBottomColor: border, opacity, transform: [{ translateY }] }]}
        >
            <Ionicons name="bus-outline" size={16} color={color} />
            {clock && <Text style={[styles.clock, { color: textColor }]}>{clock}</Text>}
            <Text numberOfLines={1} style={[styles.line, { color: textColor }]}>{line}</Text>
            <Text numberOfLines={1} style={[styles.stop, { color: textColor }]}>{stop} 승차</Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: HEIGHT,
        zIndex: 3,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    clock: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    line: { fontSize: 13, fontWeight: '800', flexShrink: 1, maxWidth: '34%' },
    stop: { fontSize: 13, fontWeight: '600', flex: 1 },
});
