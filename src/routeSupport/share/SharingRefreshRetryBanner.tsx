import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../modules/theme/ThemeContext';

type Props = {
  bottom: number;
  accent: string;
  message: string;
  refreshing: boolean;
  retryTestID: string;
  onRetry: () => void;
};

export function SharingRefreshRetryBanner({ bottom, accent, message, refreshing, retryTestID, onRetry }: Props) {
  const { colors } = useTheme();

  return (
    <View pointerEvents="box-none" style={[styles.position, { bottom }]}>
      <View style={[styles.banner, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.textPrimary }]}>{message}</Text>
        <Pressable accessibilityRole="button" testID={retryTestID}
          accessibilityState={{ disabled: refreshing, busy: refreshing }} disabled={refreshing} onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
          <Text style={[styles.retryText, { color: refreshing ? colors.textSecondary : accent }]}>다시 시도</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 16 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 10,
  },
  message: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  retry: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  retryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
