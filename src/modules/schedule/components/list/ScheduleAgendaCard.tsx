import styles from './ScheduleAgendaCard.styles';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getScheduleShareBadgeLabel } from '../../../share/sharePermissionPresentation';
import { useTheme } from '../../../theme/ThemeContext';
import {
  formatDayTimelineDeparture,
  getDayTimelineEventMetadata,
} from '../../dayTimelineLayout';
import {
  formatAgendaDetailScheduleTime,
  formatAgendaDetailTimeColumn,
  getAgendaMultiDaySummary,
} from '../../agendaLayout';
import { getTravelModeLabel } from '../../travelMode';
import type { ScheduleItem, TravelMode } from '../../types';
import ScheduleSwipeActions, {
  type ScheduleSwipeActionCallbacks,
} from '../ScheduleSwipeActions';
import ScheduleIcon, { type ScheduleIconName } from '../shared/ScheduleIcon';

export type ScheduleAgendaCardProps = {
  item: ScheduleItem;
  onPress: () => void;
  onLongPress?: () => void;
  swipeActions?: ScheduleSwipeActionCallbacks;
  compact?: boolean;
  groupRow?: boolean;
  showMultiDaySummary?: boolean;
};

function travelIcon(mode?: TravelMode): ScheduleIconName {
  switch (mode) {
    case 'TRANSIT':
      return 'transit';
    case 'CAR':
      return 'car';
    case 'WALK':
      return 'walk';
    case 'BIKE':
      return 'bike';
    default:
      return 'departure';
  }
}

/** Flow layout shared by the selected-day agenda and month list. */
export default function ScheduleAgendaCard({
  item,
  onPress,
  onLongPress,
  swipeActions,
  compact = false,
  groupRow = false,
  showMultiDaySummary = false,
}: ScheduleAgendaCardProps) {
  const { colors, mode } = useTheme();
  const isDetailCard = groupRow && !compact;
  const categoryColor = item.category?.color ?? '#8e8e93';
  const metadata = useMemo(() => getDayTimelineEventMetadata(item), [item]);
  const scheduleTime = useMemo(
    () => formatAgendaDetailScheduleTime(item),
    [item],
  );
  const timeColumn = useMemo(() => formatAgendaDetailTimeColumn(item), [item]);
  const multiDaySummary = useMemo(
    () => (showMultiDaySummary ? getAgendaMultiDaySummary(item) : null),
    [item, showMultiDaySummary],
  );
  const departureText = formatDayTimelineDeparture(metadata.departureAt);
  const travelText = item.routeSetupRequired
    ? ''
    : [
        departureText ? `${departureText} 출발` : '',
        metadata.travelMinutes ? `${metadata.travelMinutes}분` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  const sharePermission =
    item.sharePermission ?? item.category?.sharePermission;
  const isShared = item.category?.shared === true || Boolean(sharePermission);
  const shareAccessibilityLabel = isShared
    ? getScheduleShareBadgeLabel(sharePermission)
    : undefined;
  const travelModeAccessibilityLabel =
    metadata.isTravel && metadata.travelMode
      ? `${getTravelModeLabel(metadata.travelMode)} 이동`
      : undefined;
  const hasContext = Boolean(
    metadata.location || travelText || item.routeSetupRequired,
  );
  const departureColor = mode === 'dark' ? '#4B9DFF' : '#2979FF';
  const routeStatusColor = mode === 'dark' ? '#FF9F0A' : '#B85F00';
  const availableSwipeActionText = [
    swipeActions?.onEdit ? '수정' : '',
    swipeActions?.onDelete ? '삭제' : '',
  ]
    .filter(Boolean)
    .join(' 또는 ');
  const accessibilityHint = availableSwipeActionText
    ? `왼쪽으로 밀면 ${availableSwipeActionText} 작업이 나타납니다.${
        onLongPress ? ' 길게 눌러 작업 메뉴를 열 수도 있습니다.' : ''
      }`
    : onLongPress
    ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다'
    : undefined;
  // Dates are retained for overnight and multi-day events; give those labels more room.
  const hasDatedTime =
    timeColumn.startLabel.length > 10 ||
    (timeColumn.endLabel?.length ?? 0) > 10;

  return (
    <ScheduleSwipeActions
      itemTitle={item.title}
      onEdit={swipeActions?.onEdit}
      onDelete={swipeActions?.onDelete}
      compact={compact || groupRow}
      containerStyle={[
        styles.swipeContainer,
        groupRow && styles.swipeContainerGroupRow,
      ]}
    >
      <Pressable
        testID={isDetailCard ? 'selected-day-agenda-card' : 'month-agenda-card'}
        accessibilityRole="button"
        accessibilityLabel={[
          item.title,
          multiDaySummary?.stayLabel,
          scheduleTime,
          travelModeAccessibilityLabel,
          metadata.location,
          travelText || undefined,
          item.routeSetupRequired ? '경로 미설정' : undefined,
          shareAccessibilityLabel,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={accessibilityHint}
        accessibilityActions={[
          ...(swipeActions?.onEdit ? [{ name: 'edit', label: '수정' }] : []),
          ...(swipeActions?.onDelete
            ? [{ name: 'delete', label: '삭제' }]
            : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'edit') swipeActions?.onEdit?.();
          if (nativeEvent.actionName === 'delete') swipeActions?.onDelete?.();
        }}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={420}
        style={({ pressed }) => [
          styles.card,
          groupRow && styles.groupRow,
          {
            backgroundColor: pressed
              ? mode === 'dark'
                ? 'rgba(255,255,255,0.075)'
                : 'rgba(0,0,0,0.045)'
              : groupRow
              ? 'transparent'
              : mode === 'dark'
              ? colors.surface
              : colors.surface2,
            borderColor: colors.border,
          },
        ]}
      >
        <View
          testID={isDetailCard ? 'selected-day-agenda-card-rail' : undefined}
          style={[styles.categoryRail, { backgroundColor: categoryColor }]}
        />
        <View
          testID={isDetailCard ? 'selected-day-agenda-card-content' : undefined}
          style={styles.content}
        >
          <View testID="agenda-card-title-row" style={styles.titleRow}>
            {metadata.isTravel ? (
              <ScheduleIcon
                name={travelIcon(metadata.travelMode)}
                color={colors.textSecondary}
              />
            ) : null}
            <Text
              testID="agenda-card-title"
              maxFontSizeMultiplier={1.5}
              numberOfLines={2}
              style={[styles.title, { color: colors.textPrimary }]}
            >
              {item.title}
            </Text>
          </View>
          {hasContext ? (
            <View testID="agenda-card-context-row" style={styles.context}>
              {metadata.location ? (
                <View
                  testID="agenda-card-location-row"
                  style={styles.metadataRow}
                >
                  <ScheduleIcon name="location" color={colors.textSecondary} />
                  <Text
                    maxFontSizeMultiplier={1.5}
                    numberOfLines={1}
                    style={[
                      styles.metadataText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {metadata.location}
                  </Text>
                </View>
              ) : null}
              {item.routeSetupRequired ? (
                <View
                  testID="agenda-route-required-badge"
                  style={styles.metadataRow}
                >
                  <ScheduleIcon name="departure" color={routeStatusColor} />
                  <Text
                    maxFontSizeMultiplier={1.4}
                    style={[
                      styles.metadataText,
                      styles.departureText,
                      { color: routeStatusColor },
                    ]}
                  >
                    경로 미설정
                  </Text>
                </View>
              ) : travelText ? (
                <View
                  testID="agenda-card-departure-row"
                  style={styles.metadataRow}
                >
                  <ScheduleIcon name="departure" color={departureColor} />
                  <Text
                    maxFontSizeMultiplier={1.5}
                    style={[
                      styles.metadataText,
                      styles.departureText,
                      { color: departureColor },
                    ]}
                  >
                    {travelText}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {multiDaySummary || isShared ? (
            <View style={styles.badgesRow}>
              {multiDaySummary ? (
                <View
                  testID="agenda-multi-day-summary"
                  style={styles.metadataRow}
                >
                  <ScheduleIcon name="calendar" color={colors.textSecondary} />
                  <Text
                    maxFontSizeMultiplier={1.4}
                    style={[styles.badgeText, { color: colors.textSecondary }]}
                  >
                    {multiDaySummary.stayLabel}
                  </Text>
                </View>
              ) : null}
              {isShared ? (
                <View testID="agenda-shared-badge" style={styles.metadataRow}>
                  <ScheduleIcon name="shared" color={colors.textSecondary} />
                  <Text
                    maxFontSizeMultiplier={1.4}
                    style={[styles.badgeText, { color: colors.textSecondary }]}
                  >
                    공유
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <View
          testID="agenda-card-time-column"
          style={[
            styles.timeColumn,
            hasDatedTime && styles.datedTimeColumn,
            !isDetailCard && styles.listTimeColumn,
          ]}
        >
          <Text
            maxFontSizeMultiplier={1.4}
            numberOfLines={hasDatedTime ? 2 : 1}
            style={[styles.timePrimary, { color: colors.textPrimary }]}
          >
            {timeColumn.startLabel}
          </Text>
          {timeColumn.endLabel ? (
            <Text
              maxFontSizeMultiplier={1.4}
              numberOfLines={hasDatedTime ? 2 : 1}
              style={[styles.timeSecondary, { color: colors.textSecondary }]}
            >
              {timeColumn.endLabel}
            </Text>
          ) : null}
        </View>
        {!isDetailCard ? (
          <View style={styles.chevronColumn}>
            <ScheduleIcon name="forward" color={colors.textSecondary} />
          </View>
        ) : null}
      </Pressable>
    </ScheduleSwipeActions>
  );
}
