import React from 'react';
import { Text, View } from 'react-native';
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
} from './ScheduleDetailChrome';
import { createScheduleDetailStyles } from './schedule-detail.styles';

type Props = {
  labels: string[];
  color: string;
  borderColor: string;
  largeText: boolean;
  compact?: boolean;
};

export function ScheduleRouteFacts({ labels, color, borderColor, largeText, compact }: Props) {
  if (labels.length === 0) return null;
  if (compact && !largeText) {
    return <Text numberOfLines={1} style={[styles.improvedCompactFacts, { color }]}>{labels.join(' · ')}</Text>;
  }

  return (
    <View
      testID={compact ? 'compact-route-facts' : 'expanded-route-facts'}
      style={[styles.improvedRouteFacts, largeText && styles.improvedRouteFactsLarge]}
    >
      {labels.map((label, index) => (
        <React.Fragment key={label}>
          {!largeText && index > 0 && <View style={[styles.improvedRouteFactDivider, { backgroundColor: borderColor }]} />}
          <Text
            lineBreakStrategyIOS="hangul-word"
            maxFontSizeMultiplier={1.65}
            style={[
              styles.improvedRouteFactText,
              largeText && styles.improvedRouteFactTextLarge,
              largeText && { borderColor },
              { color },
            ]}
          >
            {label}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
