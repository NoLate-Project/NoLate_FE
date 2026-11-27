import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function RouteSheetOverview({ minutes, fallback, departureClock, departureDate, departed, primary, secondary, warning }: {
  minutes?: number | null; fallback: string; departureClock: string; departureDate?: string;
  departed: boolean; primary: string; secondary: string; warning?: string;
}) {
  const duration = typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
    ? [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}시간` : '', minutes % 60 ? `${Math.round(minutes % 60)}분` : ''].filter(Boolean).join(' ')
    : fallback;
  return <View testID="route-sheet-overview" style={styles.root}>
    <View style={styles.row}>
      {duration ? <Text accessibilityRole="header" style={[styles.duration, { color: primary }]}>{duration}</Text> : null}
      <Text testID="route-sheet-overview-departure" style={[styles.meta, { color: secondary }]}>
      {[departureDate, `${departureClock} ${departed ? '출발' : '출발 예정'}`].filter(Boolean).join(' · ')}
      </Text>
    </View>
    {warning && <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: secondary }]}>{warning}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  root: { paddingBottom: 4, gap: 2 },
  row: { minHeight: 32, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
  duration: { fontSize: 24, lineHeight: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  meta: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
});
