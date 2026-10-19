import React, { useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import type { JourneyRouteInput, JourneyRouteCoordinate } from "./journeyRouteInput";
import type { SavedJourneyWalkingMapPath } from './savedJourneyWalkingMap';

const valid = (p: JourneyRouteCoordinate | null): p is JourneyRouteCoordinate => !!p
    && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
/** Tile-free QA rendering only. Numeric SVG values, no scripts, keys or external resource loads. */
export function buildGuidancePreviewSVG(input: JourneyRouteInput | null, position: JourneyRouteCoordinate | null,
    walkingPaths: SavedJourneyWalkingMapPath[] = []): string | null {
    if (!input || input.legs.length > 32 || input.legs.some(leg => leg.coordinates.some(p => !valid(p)))) return null;
    if (walkingPaths.length > 16 || new Set(walkingPaths.map(path => path.legIndex)).size !== walkingPaths.length
        || walkingPaths.some(path => input.legs[path.legIndex]?.kind !== 'WALK' || path.coordinates.length < 2
            || path.coordinates.length > 2000 || path.coordinates.some(point => !valid(point)))) return null;
    const coordinates = input.legs.map((leg, index) => walkingPaths.find(path => path.legIndex === index)?.coordinates ?? leg.coordinates);
    const points = coordinates.flat().filter(valid);
    if (points.length < 2 || points.length > 1000) return null;
    const minLat = Math.min(...points.map(p => p.latitude)), maxLat = Math.max(...points.map(p => p.latitude));
    const minLng = Math.min(...points.map(p => p.longitude)), maxLng = Math.max(...points.map(p => p.longitude));
    const scale = Math.min(280 / Math.max(0.00001, (maxLng - minLng) * Math.cos(minLat * Math.PI / 180)), 140 / Math.max(0.00001, maxLat - minLat));
    const xy = (p: JourneyRouteCoordinate) => [30 + (p.longitude - minLng) * Math.cos(minLat * Math.PI / 180) * scale, 180 - (p.latitude - minLat) * scale];
    const paths = input.legs.map((leg, index) => `<polyline points="${coordinates[index].filter(valid).map(p => xy(p).join(',')).join(' ')}" fill="none" stroke="${leg.kind === 'WALK' ? '#8A9DB0' : '#1264C7'}" stroke-width="6"/>`).join('');
    const dots = [points[0], points[points.length - 1]].map(p => { const [x,y] = xy(p); return `<circle cx="${x}" cy="${y}" r="6" fill="#16A34A"/>`; }).join('');
    const [x,y] = position && valid(position) ? xy(position) : [0,0];
    const current = position && valid(position) ? `<circle cx="${x}" cy="${y}" r="9" fill="#1264C7" stroke="white" stroke-width="3"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 220" style="width:100%;height:100%">${paths}${dots}${current}</svg>`;
}
export function SavedJourneyRoutePreview({ input, position, walkingPaths = [] }: { input: JourneyRouteInput | null;
    position: JourneyRouteCoordinate | null; walkingPaths?: SavedJourneyWalkingMapPath[] }) {
    const { fontScale } = useWindowDimensions();
    const svg = useMemo(() => buildGuidancePreviewSVG(input, position, walkingPaths), [input, position, walkingPaths]);
    if (!svg) return null;
    return <View style={styles.root} testID="saved-guidance-offline-map">
        <Text key={fontScale} style={styles.title} numberOfLines={1} accessibilityLabel="오프라인 경로 시험 · 지도 타일 없음">오프라인 경로 시험 · 지도 타일 없음</Text>
        {walkingPaths.length > 0 && <Text testID="saved-guidance-map-walking-source">서버 검증 도보 {walkingPaths.length}구간 · 저장 대중교통 경로 유지</Text>}
        <WebView source={{ html: `<html style="height:100%"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="height:100%;margin:0;background:#F4F8FC">${svg}</body></html>`, baseUrl: 'about:blank' }}
            originWhitelist={['about:blank']} javaScriptEnabled={false} scrollEnabled={false}
            onShouldStartLoadWithRequest={request => request.url === 'about:blank'} style={styles.map} />
        <Text testID="saved-guidance-map-position" style={styles.caption}>{position
            ? `엔진 위치 ${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` : '신선한 엔진 위치 없음'}</Text>
    </View>;
}
const styles = StyleSheet.create({ root: { ...StyleSheet.absoluteFillObject, padding: 16, paddingTop: 220, backgroundColor: '#F4F8FC' },
    title: { color: '#173953', fontSize: 14 }, map: { height: 220, flex: 0 }, caption: { fontSize: 12, color: '#344A60', marginTop: 8 } });
