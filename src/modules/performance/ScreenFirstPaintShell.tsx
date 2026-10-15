import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';

type Props = {
  title: string;
  backAccessibilityLabel: string;
  showBack?: boolean;
  testID?: string;
};

/** Minimal usable chrome shown while the full destination screen mounts. */
export default function ScreenFirstPaintShell({
  title,
  backAccessibilityLabel,
  showBack = true,
  testID,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/schedule');
  }, [router]);

  return (
    <View
      testID={testID}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel}
            hitSlop={10}
            onPress={goBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={[styles.backGlyph, { color: colors.textPrimary }]}>‹</Text>
          </Pressable>
        ) : <View style={styles.backButton} />}
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <View style={styles.trailing} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: { fontSize: 38, lineHeight: 40, fontWeight: '300' },
  title: {
    flex: 1,
    height: 44,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 20,
    fontWeight: '700',
  },
  trailing: { width: 44, height: 44 },
  pressed: { opacity: 0.55 },
});
