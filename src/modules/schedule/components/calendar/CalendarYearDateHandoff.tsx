import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { CALENDAR_YEAR_MOTION } from "../../calendarMotion";

export type CalendarDatePoint = { x: number; y: number };
type TargetKind = "grid" | "agenda";
type DateTargets = Map<string, View | Text>;
type Layout = CalendarDatePoint & { width: number; height: number };

export const CalendarYearDateTargets = createContext<DateTargets | null>(null);

export function useCalendarYearDateTarget(day: string | undefined, kind: TargetKind) {
    const targets = useContext(CalendarYearDateTargets);
    const attached = useRef<View | Text | null>(null);
    return useCallback((node: View | Text | null) => {
        if (!targets || !day) return;
        const key = `${kind}:${day}`;
        if (node) targets.set(key, node);
        else if (targets.get(key) === attached.current) targets.delete(key);
        attached.current = node;
    }, [day, kind, targets]);
}

function measure(node: View | Text, onLayout: (layout: Layout) => void) {
    node.measureInWindow((x, y, width, height) => onLayout({ x, y, width, height }));
}

type Props = {
    request: { day: string; from: CalendarDatePoint };
    targets: DateTargets;
    monthLayer: React.RefObject<View | null>;
    preferAgenda: boolean;
    dark: boolean;
    onFinish: () => void;
};

export function CalendarYearDateHandoff({ request, targets, monthLayer, preferAgenda, dark, onFinish }: Props) {
    const surface = useRef<View>(null);
    const progress = useRef(new Animated.Value(0)).current;
    const [flight, setFlight] = useState<{ from: CalendarDatePoint; to: CalendarDatePoint } | null>(null);

    useLayoutEffect(() => {
        let cancelled = false;
        let frame = 0;
        let attempts = 0;
        let animation: Animated.CompositeAnimation | undefined;
        const measurementDeadline = setTimeout(onFinish, CALENDAR_YEAR_MOTION.monthSelectionMs);
        const retry = () => {
            if (cancelled) return;
            if (attempts < 10) frame = requestAnimationFrame(findTarget);
            else {
                clearTimeout(measurementDeadline);
                onFinish();
            }
        };
        function findTarget() {
            attempts++;
            const layer = monthLayer.current;
            const overlay = surface.current;
            const agenda = preferAgenda ? targets.get(`agenda:${request.day}`) : undefined;
            const grid = targets.get(`grid:${request.day}`);
            const target = attempts > 5 ? grid ?? agenda : preferAgenda ? agenda : grid;
            if (!layer || !overlay || !target) return retry();

            measure(overlay, bounds => measure(layer, canvas => measure(target, cell => {
                if (cancelled) return;
                const to = {
                    x: cell.x - canvas.x + cell.width / 2,
                    y: cell.y - bounds.y + cell.height / 2,
                };
                const from = { x: request.from.x - bounds.x, y: request.from.y - bounds.y };
                if (![from.x, from.y, to.x, to.y].every(Number.isFinite) ||
                    cell.width <= 0 || cell.height <= 0 || bounds.width <= 0 ||
                    to.x < 0 || to.x > bounds.width || to.y < 0 || to.y > bounds.height) {
                    retry();
                    return;
                }
                clearTimeout(measurementDeadline);
                progress.setValue(0);
                setFlight({ from, to });
                frame = requestAnimationFrame(() => {
                    animation = Animated.timing(progress, {
                        duration: CALENDAR_YEAR_MOTION.selectedDayMarkerMs, toValue: 1,
                        easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true, isInteraction: false,
                    });
                    animation.start(({ finished }) => { if (finished && !cancelled) onFinish(); });
                });
            })));
        }
        retry();
        return () => {
            cancelled = true;
            clearTimeout(measurementDeadline);
            cancelAnimationFrame(frame);
            animation?.stop();
        };
    }, [monthLayer, onFinish, preferAgenda, progress, request, targets]);

    return (
        <View ref={surface} collapsable={false} pointerEvents="none" accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants" style={styles.overlay}>
            {flight && (
                <Animated.View testID="calendar-year-date-handoff" style={[
                    styles.badge,
                    { left: flight.from.x - 13.5, top: flight.from.y - 13.5, backgroundColor: dark ? "#A7C8FF" : "#172131" },
                    {
                        opacity: progress.interpolate({ inputRange: [0, 0.74, 1], outputRange: [0.96, 0.88, 0] }),
                        transform: [
                            { translateX: progress.interpolate({ inputRange: [0, 0.74, 1], outputRange: [0, flight.to.x - flight.from.x, flight.to.x - flight.from.x] }) },
                            { translateY: progress.interpolate({ inputRange: [0, 0.74, 1], outputRange: [0, flight.to.y - flight.from.y, flight.to.y - flight.from.y] }) },
                            { scale: progress.interpolate({ inputRange: [0, 0.74, 1], outputRange: [1, 0.87, 0.82] }) },
                        ],
                    },
                ]}>
                    <Text allowFontScaling={false} style={[styles.day, { color: dark ? "#15213A" : "#FFFFFF" }]}>
                        {Number(request.day.slice(8))}
                    </Text>
                </Animated.View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 35, elevation: 35, overflow: "hidden" },
    badge: {
        position: "absolute", width: 27, height: 27, borderRadius: 13.5,
        alignItems: "center", justifyContent: "center",
    },
    day: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
