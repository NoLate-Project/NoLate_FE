import { Animated, StyleSheet } from 'react-native';

export default function DayEventReturnHighlight({ opacity, color, radius }: {
  opacity: Animated.Value;
  color: string;
  radius?: number;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: color, borderRadius: radius, opacity }]}
    />
  );
}
