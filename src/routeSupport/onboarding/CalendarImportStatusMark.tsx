import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

import { useSystemReduceMotion } from '../../modules/performance/useSystemReduceMotion';
import { useTheme } from '../../modules/theme/ThemeContext';
import { BRAND_BLUE, CURATION_APP_LOGO } from './calendarImportModel';

const settleEasing = Easing.bezier(0.22, 1, 0.36, 1);
const calendarPages = [
  { left: 8, tilt: '-10deg' },
  { left: 25, tilt: '4deg' },
  { left: 38, tilt: '-2deg' },
] as const;

export function CalendarScanLogo() {
  const reduceMotion = useSystemReduceMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const settle = Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      easing: settleEasing,
      useNativeDriver: true,
      isInteraction: false,
    });
    settle.start();
    return () => settle.stop();
  }, [progress, reduceMotion]);

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.scanFrame}>
      <Animated.View style={[styles.logoFrame, {
        transform: [
          { perspective: 420 },
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) },
          { rotateX: progress.interpolate({ inputRange: [0, 1], outputRange: ['16deg', '0deg'] }) },
          { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['-27deg', '0deg'] }) },
        ],
      }]}>
        <View style={styles.logoEdge} />
        <Image source={CURATION_APP_LOGO} accessibilityIgnoresInvertColors fadeDuration={0} style={styles.logoFace} />
        <View style={styles.logoRim} />
      </Animated.View>
    </View>
  );
}

export default function CalendarImportStatusMark({ partial = false }: { partial?: boolean }) {
  const { colors, mode } = useTheme();
  const dark = mode === 'dark';
  const reduceMotion = useSystemReduceMotion();
  const stackProgress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const badgeProgress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      stackProgress.setValue(1);
      badgeProgress.setValue(1);
      return;
    }
    const stackMotion = Animated.timing(stackProgress, {
      toValue: 1,
      duration: 620,
      easing: settleEasing,
      useNativeDriver: true,
      isInteraction: false,
    });
    const badgeMotion = Animated.timing(badgeProgress, {
      toValue: 1,
      delay: 240,
      duration: 360,
      easing: settleEasing,
      useNativeDriver: true,
      isInteraction: false,
    });
    const animation = Animated.parallel([stackMotion, badgeMotion]);
    animation.start();
    return () => animation.stop();
  }, [badgeProgress, reduceMotion, stackProgress]);

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.resultFrame}>
      <Animated.View style={[styles.stack, {
        opacity: stackProgress,
        transform: [
          { perspective: 620 },
          { translateY: stackProgress.interpolate({ inputRange: [0, 1], outputRange: [9, 0] }) },
          { rotateY: stackProgress.interpolate({ inputRange: [0, 1], outputRange: ['-26deg', '0deg'] }) },
          { scale: stackProgress.interpolate({ inputRange: [0, 1], outputRange: [0.91, 1] }) },
        ],
      }]}>
        {calendarPages.map(({ left, tilt }, index) => {
          const front = index === calendarPages.length - 1;
          return (
            <View key={left} style={[styles.page, {
              left,
              backgroundColor: front ? colors.surface : dark ? colors.surface2 : '#F4F7FB',
              borderColor: front ? dark ? '#485E80' : '#CDDCFF' : dark ? colors.border : '#DFE6EF',
              transform: [{ rotateZ: tilt }],
            }]}>
              <View style={[styles.pageHeader, { backgroundColor: front ? BRAND_BLUE : dark ? '#40557B' : '#D9E6FF' }]} />
              <View style={styles.grid}>
                {Array.from({ length: 6 }, (_, day) => (
                  <View key={day} style={[styles.day, {
                    backgroundColor: day % 3 === 2 ? dark ? '#6889B5' : '#BED1FF' : dark ? '#4C5563' : '#D7DEEA',
                  }]} />
                ))}
              </View>
            </View>
          );
        })}
      </Animated.View>
      <Animated.View style={[styles.badge, {
        backgroundColor: partial ? '#A15B16' : '#07865D',
        borderColor: colors.surface,
        opacity: badgeProgress,
        transform: [
          { translateY: badgeProgress.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) },
          { scale: badgeProgress.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }) },
        ],
      }]}>
        <Ionicons name={partial ? 'alert-outline' : 'checkmark-outline'} size={18} color="#FFF" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scanFrame: { width: 98, height: 96, alignItems: 'center', justifyContent: 'center' },
  logoFrame: { width: 70, height: 70 },
  logoEdge: {
    ...StyleSheet.absoluteFillObject, top: 3, bottom: -4, left: 2, right: -3,
    backgroundColor: '#174AA2', borderRadius: 20, borderWidth: 1, borderColor: '#82B2FF',
    shadowColor: '#253B60', shadowOpacity: 0.25, shadowRadius: 10,
    shadowOffset: { width: 0, height: 7 },
  },
  logoFace: { width: 70, height: 70, borderRadius: 19 },
  logoRim: { ...StyleSheet.absoluteFillObject, borderRadius: 19, borderWidth: 1, borderColor: '#D6E7FF8C' },
  resultFrame: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  stack: { width: 112, height: 96 },
  page: {
    position: 'absolute', top: 11, width: 62, height: 72, borderRadius: 10,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#1F3450', shadowOpacity: 0.12, shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
  },
  pageHeader: { width: 44, height: 5, borderRadius: 3 },
  grid: { width: 30, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: { width: 6, height: 6, borderRadius: 2 },
  badge: {
    position: 'absolute', right: 0, top: 47, width: 32, height: 32, borderRadius: 16,
    zIndex: 1, borderWidth: 3, alignItems: 'center', justifyContent: 'center',
  },
});
