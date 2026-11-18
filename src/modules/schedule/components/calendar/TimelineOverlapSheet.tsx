import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import { DAY_TIMELINE_HOUR_HEIGHT, formatDayTimelineDeparture, formatDayTimelineTimeRange, type TimelineOverlap } from '../../dayTimelineLayout';

export type TimelineOverlapSelection = {
  overlap: TimelineOverlap;
  restoreFocus: () => void;
};

export function TimelineOverlapButton({ overlap, day, compact, onOpen }: {
  overlap: TimelineOverlap;
  day: string;
  compact?: boolean;
  onOpen: (selection: TimelineOverlapSelection) => void;
}) {
  const { colors } = useTheme();
  const button = useRef<View>(null);
  const count = overlap.events.length;
  const hour = String(Math.floor(overlap.startMinute / 60)).padStart(2, '0');
  const minute = String(overlap.startMinute % 60).padStart(2, '0');
  const time = formatDayTimelineDeparture(`${day}T${hour}:${minute}:00`);
  const [, month, date] = day.split('-');
  return (
    <Pressable
      ref={button}
      testID="timeline-overlap-button"
      accessibilityRole="button"
      accessibilityLabel={`${Number(month)}월 ${Number(date)}일, ${time}부터 겹친 일정 ${count}개`}
      accessibilityHint="일정을 골라 상세를 엽니다"
      onPress={() => onOpen({ overlap, restoreFocus: () => {
        if (button.current) AccessibilityInfo.sendAccessibilityEvent?.(button.current, 'focus');
      } })}
      style={({ pressed }) => [styles.overlap, {
        top: overlap.startMinute / 60 * DAY_TIMELINE_HOUR_HEIGHT,
        height: overlap.height,
        backgroundColor: colors.surface2,
        borderColor: colors.border,
        opacity: pressed ? 0.65 : 1,
      }]}
    >
      <Text numberOfLines={1} style={[styles.overlapTitle, { color: colors.textPrimary }]}>
        {compact ? `일정 ${count}개` : `겹친 일정 ${count}개`}
      </Text>
      {!compact && <Ionicons name="chevron-forward-outline" size={17} color={colors.textSecondary} accessible={false} />}
    </Pressable>
  );
}

export function TimelineOverlapSheet({ selection, visible, bottomInset, reduceMotion, onClose, onSelect, onDismiss }: {
  selection: TimelineOverlapSelection | null;
  visible: boolean;
  bottomInset: number;
  reduceMotion: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const heading = useRef<Text>(null);
  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      visible={visible}
      onRequestClose={onClose}
      onDismiss={onDismiss}
      onShow={() => {
        if (heading.current) AccessibilityInfo.sendAccessibilityEvent?.(heading.current, 'focus');
      }}
    >
      {selection && <View style={styles.modal}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(bottomInset, 16) }]}>
          <View style={styles.header}>
            <Text ref={heading} accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
              {`겹친 일정 ${selection.overlap.events.length}개`}
            </Text>
            <Pressable accessibilityLabel="겹친 일정 닫기" accessibilityRole="button" onPress={onClose} style={styles.close}>
              <Ionicons name="close-outline" size={24} color={colors.textPrimary} accessible={false} />
            </Pressable>
          </View>
          <ScrollView bounces={false}>
            {selection.overlap.events.map(({ item }) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={[item.title, formatDayTimelineTimeRange(item)].filter(Boolean).join(', ')}
                onPress={() => onSelect(item.id)}
                style={({ pressed }) => [styles.row, { borderTopColor: colors.border, backgroundColor: pressed ? colors.surface2 : colors.surface }]}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
                  <Text style={[styles.time, { color: colors.textSecondary }]}>{formatDayTimelineTimeRange(item)}</Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={16} color={colors.textSecondary} accessible={false} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlap: { position: 'absolute', left: 2, right: 2, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  overlapTitle: { flex: 1, fontSize: 13, fontWeight: '700' },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { maxHeight: '74%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: 12 },
  heading: { flex: 1, fontSize: 20, fontWeight: '700' },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: 10, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 13 },
});
