import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { runAfterScreenTransition } from '../../src/modules/performance/runAfterScreenTransition';
import { useTheme } from '../../src/modules/theme/ThemeContext';

const destinations = [
  { route: '/share/blocked', label: '차단한 사용자', icon: 'person-remove-outline' },
  { route: '/share/reports', label: '내 신고 내역', icon: 'flag-outline' },
] as const;

type SafetyRoute = typeof destinations[number]['route'];

export default function ShareSafetyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const lastDestination = useRef<SafetyRoute | null>(null);
  const rows = useRef(new Map<SafetyRoute, View>());

  useFocusEffect(useCallback(() => {
    const route = lastDestination.current;
    if (!route) return;
    const task = runAfterScreenTransition(() => {
      lastDestination.current = null;
      const row = rows.current.get(route);
      if (row) AccessibilityInfo.sendAccessibilityEvent?.(row, 'focus');
    });
    return task.cancel;
  }, []));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="공유함으로 돌아가기" style={styles.back}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/share/inbox');
          }}>
          <Ionicons name="chevron-back-outline" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>공유 안전 관리</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(20, insets.bottom) }]}>
        {destinations.map(({ route, label, icon }) => (
          <Pressable key={route} accessibilityRole="button" accessibilityLabel={label}
            ref={node => { if (node) rows.current.set(route, node); else rows.current.delete(route); }}
            onPress={() => {
              lastDestination.current = route;
              router.push({ pathname: route, params: { from: 'safety' } });
            }}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surface2 }]}>
            <Ionicons accessible={false} name={icon} size={21} color={colors.textSecondary} />
            <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
            <Ionicons accessible={false} name="chevron-forward-outline" size={17} color={colors.textSecondary} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 21, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingTop: 12 },
  row: { minHeight: 60, paddingHorizontal: 6, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontSize: 16, fontWeight: '600' },
});
