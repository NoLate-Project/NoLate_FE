import React, { useLayoutEffect, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSystemReduceMotion } from '../performance/useSystemReduceMotion';
import { compactTransitLineLabel } from '../schedule/routeInfo';
import type { JourneyRouteInput } from './journeyRouteInput';
import type { SavedJourneyRoutePosition } from './savedJourneyRoutePosition';
import type { SavedJourneyRouteLayout } from './savedJourneyRouteLayout';
import { SAVED_JOURNEY_MOTION } from './savedJourneyMotion';

const labels: Record<string, string> = { WALK: '도보', BUS: '버스', SUBWAY: '지하철', ETC: '이동', UNKNOWN: '미확인' };
const colors: Record<string, string> = { WALK: '#78828F', BUS: '#2F963B', SUBWAY: '#239FD2', ETC: '#78828F', UNKNOWN: '#78828F' };
/** Preserve all original legs. Static planned proportions never advance live progress by time. */
export function SavedJourneyRouteBar({ input, position, layout, copy: stageCopy, compact = false, isDark = false, showCopy = true, recovery = false, navigation = false, docked = false, dockCaption, trackingLocation = true }: {
    input: JourneyRouteInput; position: SavedJourneyRoutePosition | null; layout?: SavedJourneyRouteLayout | null;
    copy?: string; compact?: boolean; isDark?: boolean; showCopy?: boolean; recovery?: boolean; navigation?: boolean; docked?: boolean;
    dockCaption?: React.ReactNode;
    trackingLocation?: boolean;
}) {
    // Refresh native text metrics, never the engine/session or GPS-derived position.
    const { fontScale } = useWindowDimensions();
    const trackWidth = useSharedValue(0);
    if (!Array.isArray(input.legs) || !input.legs.length || input.legs.length > 32
        || input.legs.some((leg, index) => leg.index !== index || !labels[leg.kind])) return null;
    const activeKind = position && input.legs[position.legIndex]?.kind;
    const waitingForTrain = position?.waiting && input.legs[position.legIndex + 1]?.kind === 'SUBWAY';
    const copy = stageCopy ?? (!position ? '현재 위치 확인 필요'
        : position.waiting ? (waitingForTrain ? '승차역 · 열차 대기' : '승차 정류장 · 버스 대기')
        : activeKind === 'BUS' ? '버스로 이동 중' : activeKind === 'SUBWAY' ? '지하철로 이동 중'
        : position.legIndex === input.legs.length - 1 ? '목적지까지 · 도보로 이동 중'
        : '승차 지점까지 · 도보로 이동 중');
    const segments = layout?.legs ?? input.legs.map(leg => ({ ...leg, label: labels[leg.kind], color: colors[leg.kind], fraction: 1 / input.legs.length, durationMinutes: null }));
    const caption = layout?.caption ?? '구간 동일 폭';
    const currentSegment = position && segments[position.legIndex];
    const showAllCompactLabels = compact && !showCopy && fontScale <= 1.35 && segments.length <= 3;
    const alignCompactLabels = showAllCompactLabels && segments.every(leg => leg.fraction >= 0.15);
    const compactLabels = showAllCompactLabels ? segments : segments.filter(leg => leg.kind === 'SUBWAY' || leg.kind === 'BUS');
    const navigationRail = navigation && compact && !showCopy && fontScale <= 1.35;
    const modeBadges = navigationRail && segments.length <= 5 ? segments.map((leg, index) => ({ ...leg,
        start: segments.slice(0, index).reduce((sum, previous) => sum + previous.fraction, 0),
    })).filter(leg => leg.kind === 'BUS' || leg.kind === 'SUBWAY') : [];
    const dockLines = docked ? segments.filter(leg => leg.kind === 'SUBWAY' || leg.kind === 'BUS')
        .map(leg => compactTransitLineLabel(leg.label) ?? leg.label).join('  →  ') : '';
    const segmentDescription = segments.map(leg =>
        `${leg.index + 1}. ${leg.label}${leg.durationMinutes ? ` 예정 ${Math.ceil(leg.durationMinutes)}분` : ''}`
    ).join(' → ');
    const locationDescription = position?.waiting
        ? (showCopy ? null : `${copy}.`)
        : currentSegment ? `현재 위치는 ${currentSegment.label} 구간입니다.` : '현재 위치를 확인 중입니다.';
    const accessibilityLabel = [
        showCopy ? `${segmentDescription}, ${copy}.` : `${segmentDescription}.`,
        trackingLocation && locationDescription,
        `${caption}, 전체 여정 완료율이 아닙니다.`,
    ].filter(Boolean).join(' ');
    return <View key={fontScale} testID="saved-journey-route-bar" style={[styles.root, navigationRail && styles.navigationRoot]}>
        {docked && (dockCaption ?? <Text accessible={false} importantForAccessibility="no" numberOfLines={1}
            style={[styles.dockLines, isDark && styles.darkCopy]}>{dockLines || '전체 경로'}</Text>)}
        {!compact && <Text style={[styles.heading, isDark && styles.darkCopy]}>전체 이동 경로 · {caption}</Text>}
        <View style={[styles.track, navigationRail && styles.navigationTrack, docked && styles.dockTrack, isDark && styles.darkTrack]} accessible
            onLayout={event => { trackWidth.value = Math.max(0, event.nativeEvent.layout.width - 2); }}
            accessibilityLabel={accessibilityLabel}>
            {segments.map(leg => <View key={leg.index} testID={`saved-journey-route-leg-${leg.index}`}
                style={[styles.segment, { backgroundColor: leg.color, flex: leg.fraction }, leg.index === 0 && styles.first,
                    leg.index === input.legs.length - 1 && styles.last]} />)}
            {modeBadges.map(leg => <View key={leg.index} testID={`saved-journey-route-mode-${leg.index}`}
                accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
                style={[styles.modeBadge, { left: `${leg.start * 100}%`, backgroundColor: leg.color,
                    borderColor: isDark ? '#171A20' : '#F8FAFC' }]}>
                <Ionicons accessible={false} name={leg.kind === 'SUBWAY' ? 'train-outline' : 'bus-outline'} size={11} color="#FFFFFF" />
            </View>)}
            {position && (compact && !showCopy ? <ConfirmedPositionMarker fraction={position.barFraction} trackWidth={trackWidth}
                standard={fontScale <= 1.35} recovery={recovery} />
                : <View testID="saved-journey-route-marker" style={[styles.marker,
                    { left: `${position.barFraction * 100}%` }]}><Ionicons accessible={false} name="navigate-outline" size={13} color="#FFFFFF" /></View>)}
        </View>
        {showCopy && <Text testID="saved-journey-route-position" style={[styles.copy, isDark && styles.darkCopy]}>{copy}</Text>}
        {compact && !showCopy && !docked && <View style={showAllCompactLabels ? styles.segmentLegend : styles.legend}
            accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {compactLabels.map(leg => (
                <Text key={leg.index} lineBreakStrategyIOS={fontScale <= 1.35 ? 'hangul-word' : undefined}
                    style={[styles.label, isDark && styles.darkCopy, showAllCompactLabels && [
                    styles.segmentLabel, { flex: alignCompactLabels ? leg.fraction : 1 },
                ]]}>
                    {fontScale <= 1.35 && (leg.kind === 'BUS' || leg.kind === 'SUBWAY')
                        ? compactTransitLineLabel(leg.label) ?? leg.label : leg.label}
                    {leg.durationMinutes ? ` ${Math.ceil(leg.durationMinutes)}분` : ''}
                </Text>
            ))}
        </View>}
        {!compact && <View style={styles.legend}>{segments.map(leg => <Text key={leg.index}
            testID={`saved-journey-route-label-${leg.index}`} accessibilityLabel={`${leg.index + 1}. ${leg.label}${leg.durationMinutes ? ` · 예정 ${Math.ceil(leg.durationMinutes)}분` : ''}`}
            style={[styles.label, isDark && styles.darkCopy]}>
            {position && leg.index === (position.waiting ? position.legIndex + 1 : position.legIndex) ? '● ' : ''}{leg.index + 1}. {leg.label}{leg.durationMinutes ? ` · 예정 ${Math.ceil(leg.durationMinutes)}분` : ''}
        </Text>)}</View>}
    </View>;
}

function ConfirmedPositionMarker({ fraction, trackWidth, standard, recovery }: {
    fraction: number; trackWidth: ReturnType<typeof useSharedValue<number>>;
    standard: boolean; recovery: boolean;
}) {
    const reduceMotion = useSystemReduceMotion();
    const position = useSharedValue(fraction);
    const animateEntrance = useRef(!standard || recovery).current;
    const entrance = useSharedValue(reduceMotion || !animateEntrance ? 1 : 0);
    useLayoutEffect(() => {
        entrance.value = reduceMotion || !animateEntrance ? 1 : withTiming(1, {
            duration: SAVED_JOURNEY_MOTION.markerRecoveryMs,
            ...(standard ? { easing: Easing.bezier(...SAVED_JOURNEY_MOTION.contentCurve) } : {}),
            reduceMotion: ReduceMotion.System,
        });
        return () => cancelAnimation(entrance);
    }, [animateEntrance, entrance, reduceMotion, standard]);
    useLayoutEffect(() => {
        position.value = reduceMotion ? fraction : withTiming(fraction, {
            duration: SAVED_JOURNEY_MOTION.markerMoveMs,
            easing: standard ? Easing.bezier(...SAVED_JOURNEY_MOTION.routeCurve) : Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
        });
        return () => cancelAnimation(position);
    }, [fraction, position, reduceMotion, standard]);
    const motion = useAnimatedStyle(() => ({
        transform: [{ translateX: trackWidth.value * position.value }],
        opacity: trackWidth.value > 0 ? entrance.value : 0,
    }));
    const depth = useAnimatedStyle(() => {
        const remaining = 1 - entrance.value;
        return { transform: [
            { perspective: 160 }, { rotateX: `${28 * remaining}deg` },
            { translateY: -4 * remaining }, { scale: 1 - 0.18 * remaining },
        ] };
    });
    return <Animated.View testID="saved-journey-route-marker" pointerEvents="none" style={[styles.markerAnchor, motion]}>
        <Animated.View style={[styles.markerPin, standard && depth]}>
            <Ionicons name="navigate-outline" size={12} color="#FFFFFF" accessible={false} />
        </Animated.View>
    </Animated.View>;
}

const styles = StyleSheet.create({
    root: { paddingVertical: 8, gap: 8 }, heading: { color: '#173953', fontSize: 13, fontWeight: '600' },
    navigationRoot: { paddingTop: 0, paddingBottom: 4, gap: 4 },
    dockLines: { paddingHorizontal: 12, fontSize: 14, fontWeight: '700', color: '#314158' },
    dockTrack: { marginTop: 5, marginBottom: 6 },
    navigationTrack: { height: 7, marginTop: 12, marginBottom: 10 },
    modeBadge: { position: 'absolute', top: -7, marginLeft: -10, width: 21, height: 21, borderRadius: 11,
        borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    track: { flexDirection: 'row', height: 8, marginVertical: 13, marginHorizontal: 15,
        backgroundColor: '#DCE3EB', borderRadius: 6 },
    darkTrack: { backgroundColor: '#52657A' },
    segment: { flex: 1 }, marker: { position: 'absolute', top: -10, marginLeft: -14, width: 28, height: 28,
        borderRadius: 14, backgroundColor: '#1264C7', borderWidth: 2, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
    markerAnchor: { position: 'absolute', left: 0, top: -9, marginLeft: -12 },
    markerPin: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
        borderRadius: 12, backgroundColor: '#2979FF', borderWidth: 2, borderColor: '#FFFFFF' },
    copy: { color: '#344A60', fontSize: 12 },
    darkCopy: { color: '#D5E6F8' },
    first: { borderTopLeftRadius: 5, borderBottomLeftRadius: 5 }, last: { borderTopRightRadius: 5, borderBottomRightRadius: 5 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, label: { fontSize: 12, maxWidth: '100%', color: '#344A60', flexShrink: 1 },
    segmentLegend: { flexDirection: 'row', marginHorizontal: 16 },
    segmentLabel: { textAlign: 'center', paddingHorizontal: 2 },
});
