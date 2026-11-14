import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

import { useSystemReduceMotion } from '../../modules/performance/useSystemReduceMotion';
import { useTheme } from '../../modules/theme/ThemeContext';
import { CURATION_APP_LOGO } from './calendarImportModel';

export default function CalendarImportStatusMark({ scanning = false, partial = false }: {
  scanning?: boolean;
  partial?: boolean;
}) {
  const { colors, mode } = useTheme();
  const reduceMotion = useSystemReduceMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const badgeProgress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const blue = mode === 'dark' ? '#9ABEFF' : '#246BFE';
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      badgeProgress.setValue(1);
      return;
    }
    const stackMotion = Animated.timing(progress, {
      toValue: 1,
      duration: scanning ? 520 : 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    const animation = scanning ? stackMotion : Animated.parallel([
      stackMotion,
      Animated.timing(badgeProgress, {
        toValue: 1,
        delay: 240,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
        isInteraction: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [badgeProgress, progress, reduceMotion, scanning]);

  const badgeColor = partial ? (mode === 'dark' ? '#FFB07A' : '#9B4D12') : '#07865D';

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
      {[0, 1, 2].map(index => (
        <Animated.View key={index} style={[
          styles.layer,
          {
            backgroundColor: index === 2 ? colors.surface : `${blue}${index === 0 ? '24' : '42'}`,
            borderColor: `${blue}44`,
            transform: [
              { perspective: 520 },
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [index * 25 - 25, scanning ? index * 6 - 6 : index * 16 - 16] }) },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [index * 13 - 21, index * 4 - 4] }) },
              { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: [`${-23 + index * 9}deg`, '0deg'] }) },
            ],
          },
        ]}>
          {scanning && index === 2
            ? <Image source={CURATION_APP_LOGO} style={styles.logo} />
            : <Ionicons name="calendar-outline" size={32} color={blue} />}
        </Animated.View>
      ))}
      {!scanning && (
        <Animated.View style={[styles.badge, {
          backgroundColor: badgeColor,
          borderColor: colors.surface,
          opacity: badgeProgress,
          transform: [{ scale: badgeProgress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }]}>
          <Ionicons name={partial ? 'alert-outline' : 'checkmark-outline'} size={17} color="#FFF" />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { width: 124, height: 108, alignItems: 'center', justifyContent: 'center' },
  layer: {
    position: 'absolute', width: 65, height: 68, borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center',
  },
  logo: { width: 62, height: 65, borderRadius: 12 },
  badge: {
    position: 'absolute', right: 6, bottom: 18, width: 28, height: 28, borderRadius: 14,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
});
