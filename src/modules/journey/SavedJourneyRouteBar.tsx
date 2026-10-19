import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { JourneyRouteInput } from './journeyRouteInput';
import type { SavedJourneyRoutePosition } from './savedJourneyRoutePosition';
import type { SavedJourneyRouteLayout } from './savedJourneyRouteLayout';

const labels: Record<string, string> = { WALK: '도보', BUS: '버스', SUBWAY: '지하철', ETC: '이동', UNKNOWN: '미확인' };
const colors: Record<string, string> = { WALK: '#78828F', BUS: '#2F963B', SUBWAY: '#239FD2', ETC: '#78828F', UNKNOWN: '#78828F' };
/** Preserve all original legs. Static planned proportions never advance live progress by time. */
export function SavedJourneyRouteBar({ input, position, layout, copy: stageCopy, compact = false, isDark = false }: {
    input: JourneyRouteInput; position: SavedJourneyRoutePosition | null; layout?: SavedJourneyRouteLayout | null;
    copy?: string; compact?: boolean; isDark?: boolean;
}) {
    // Refresh native text metrics, never the engine/session or GPS-derived position.
    const { fontScale } = useWindowDimensions();
    if (!Array.isArray(input.legs) || !input.legs.length || input.legs.length > 32
        || input.legs.some((leg, index) => leg.index !== index || !labels[leg.kind])) return null;
    const copy = stageCopy ?? (position ? position.waiting ? '승차 정류장 · 버스 대기'
        : position.legIndex === 1 ? '버스로 이동 중' : '승차 지점까지 · 도보로 이동 중' : '현재 위치 확인 필요');
    const segments = layout?.legs ?? input.legs.map(leg => ({ ...leg, label: labels[leg.kind], color: colors[leg.kind], fraction: 1 / input.legs.length, durationMinutes: null }));
    const caption = layout?.caption ?? '구간 동일 폭';
    return <View key={fontScale} testID="saved-journey-route-bar" style={styles.root}>
        {!compact && <Text style={[styles.heading, isDark && styles.darkCopy]}>전체 이동 경로 · {caption}</Text>}
        <View style={[styles.track, isDark && styles.darkTrack]} accessible accessibilityLabel={`${segments.map(leg => `${leg.index + 1}. ${leg.label}${leg.durationMinutes ? ` 예정 ${Math.ceil(leg.durationMinutes)}분` : ''}`).join(' → ')}, ${copy}. ${caption}, 전체 여정 완료율이 아닙니다.`}>
            {segments.map(leg => <View key={leg.index} testID={`saved-journey-route-leg-${leg.index}`}
                style={[styles.segment, { backgroundColor: leg.color, flex: leg.fraction }, leg.index === 0 && styles.first,
                    leg.index === input.legs.length - 1 && styles.last]} />)}
            {position && <View testID="saved-journey-route-marker" style={[styles.marker,
                { left: `${position.barFraction * 100}%` }]}><Text accessible={false} maxFontSizeMultiplier={1} style={styles.arrow}>▶</Text></View>}
        </View>
        <Text testID="saved-journey-route-position" style={[styles.copy, isDark && styles.darkCopy]}>{copy}</Text>
        {!compact && <View style={styles.legend}>{segments.map(leg => <Text key={leg.index}
            testID={`saved-journey-route-label-${leg.index}`} accessibilityLabel={`${leg.index + 1}. ${leg.label}${leg.durationMinutes ? ` · 예정 ${Math.ceil(leg.durationMinutes)}분` : ''}`}
            style={[styles.label, isDark && styles.darkCopy]}>
            {position && leg.index === (position.waiting ? position.legIndex + 1 : position.legIndex) ? '● ' : ''}{leg.index + 1}. {leg.label}{leg.durationMinutes ? ` · 예정 ${Math.ceil(leg.durationMinutes)}분` : ''}
        </Text>)}</View>}
    </View>;
}
const styles = StyleSheet.create({
    root: { paddingVertical: 8, gap: 8 }, heading: { color: '#173953', fontSize: 13, fontWeight: '600' },
    track: { flexDirection: 'row', height: 8, marginVertical: 10, marginHorizontal: 15, borderWidth: 1, borderColor: '#52657A', borderRadius: 6 },
    darkTrack: { borderColor: '#B8CCE0' },
    segment: { flex: 1 }, marker: { position: 'absolute', top: -10, marginLeft: -14, width: 28, height: 28,
        borderRadius: 14, backgroundColor: '#1264C7', borderWidth: 2, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
    arrow: { color: 'white', fontSize: 14 }, copy: { color: '#344A60', fontSize: 12 },
    darkCopy: { color: '#D5E6F8' },
    first: { borderTopLeftRadius: 5, borderBottomLeftRadius: 5 }, last: { borderTopRightRadius: 5, borderBottomRightRadius: 5 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, label: { fontSize: 12, maxWidth: '100%', color: '#344A60', flexShrink: 1 },
});
