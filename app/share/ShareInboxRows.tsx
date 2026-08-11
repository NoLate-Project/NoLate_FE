import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import styles from './inbox.styles';

import CalendarGlassSurface from '../../src/modules/schedule/components/calendar/CalendarGlassSurface';
import {
  ShareInboxButton,
  ShareInboxDecoration,
} from '../../src/modules/share/ShareInboxAccessibility';
import { type ShareLibraryItem } from '../../src/modules/share/shareInboxPresentation';
import { type AppColors } from '../../src/modules/theme/ThemeContext';

import {
  contentModeLabel,
  DEPARTURE_GREEN,
  formatScheduleDate,
  formatScheduleTimeRange,
  formatShortDate,
  ownerLabel,
  permissionLabel,
  ROUTE_AMBER,
  scheduleLocationLabel,
  shareItemColor,
} from './shareInboxModel';

/** 공유 종류별 미확인 개수와 선택 상태를 표시하는 탭 버튼입니다. */
export function ShareTabButton({
  label,
  count,
  selected,
  accent,
  colors,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  accent: string;
  colors: AppColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${count > 0 ? `, 미확인 ${count}개` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabButton,
        selected && {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        { opacity: pressed ? 0.68 : 1 },
      ]}
    >
      <View style={styles.tabLabelRow}>
        <Text
          style={[
            styles.tabLabel,
            { color: selected ? colors.textPrimary : colors.textSecondary },
          ]}
        >
          {label}
        </Text>
        {count > 0 ? (
          <View
            style={[
              styles.tabCount,
              { backgroundColor: selected ? `${accent}1A` : colors.surface2 },
            ]}
          >
            <Text
              style={[
                styles.tabCountText,
                { color: selected ? accent : colors.textSecondary },
              ]}
            >
              {count > 99 ? '99+' : count}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** 공유 일정의 권한, 소유자, 시간·장소 정보를 한 행으로 표시합니다. */
export function ScheduleShareRow({
  item,
  colors,
  accent,
  onOpen,
  onManage,
  onSafety,
  safetyPending,
}: {
  item: ShareLibraryItem;
  colors: AppColors;
  accent: string;
  onOpen: () => void;
  onManage: () => void;
  onSafety: () => void;
  safetyPending: boolean;
}) {
  const itemColor = shareItemColor(item, accent);
  const location = scheduleLocationLabel(item.schedule);
  const dateTime = `${formatScheduleDate(
    item.schedule,
  )} · ${formatScheduleTimeRange(item.schedule)}`;
  const scheduleMeta = [dateTime, location].filter(Boolean).join(' · ');
  const timeRange = formatScheduleTimeRange(item.schedule);
  const relationMeta =
    item.relation === 'owned'
      ? item.shareCount > 0
        ? `내가 공유 · ${item.shareCount}명`
        : `활성 링크 · ${item.activeInvitations.length}개`
      : item.isPending
      ? `${ownerLabel(item)}에게 받음`
      : `${ownerLabel(item)}에게 받음`;
  const departureColor =
    item.departedCount && item.departedCount > 0
      ? DEPARTURE_GREEN
      : colors.textSecondary;
  const cardStatus = item.isPending
    ? {
        icon: 'hourglass-outline' as const,
        label: '수락 대기',
        color: colors.textSecondary,
      }
    : item.routeState === 'needed'
    ? {
        icon: 'navigate-outline' as const,
        label: '경로 필요',
        color: ROUTE_AMBER,
      }
    : item.relation === 'owned' && item.departureSummary
    ? {
        icon: 'walk-outline' as const,
        label: item.departureSummary,
        color: departureColor,
      }
    : item.routeState === 'ready'
    ? {
        icon: 'navigate-circle-outline' as const,
        label: '경로 등록',
        color: accent,
      }
    : null;
  const eyebrowMeta = `${formatScheduleDate(item.schedule)} · ${relationMeta}`;

  return (
    <CalendarGlassSurface
      prominent
      variant="card"
      tone="solidCard"
      style={[styles.shareCard, { borderColor: colors.border }]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.shareCardRail, { backgroundColor: itemColor }]}
      />
      <ShareInboxButton
        accessibilityLabel={`${item.title}, ${scheduleMeta}, ${relationMeta}${
          cardStatus ? `, ${cardStatus.label}` : ''
        }, 열기`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.shareCardOpenButton,
          { opacity: pressed ? 0.62 : 1 },
        ]}
      >
        <View style={styles.shareCardCopy}>
          <View style={styles.cardEyebrowRow}>
            <Ionicons
              accessible={false}
              name="people-outline"
              size={14}
              color={itemColor}
            />
            <Text
              style={[styles.cardEyebrow, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {eyebrowMeta}
            </Text>
          </View>
          <View style={styles.scheduleTitleTimeRow}>
            <View style={styles.scheduleTitleLine}>
              <Text
                style={[styles.shareCardTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              {item.isUnseen ? (
                <View
                  accessibilityLabel="새 공유"
                  style={[styles.unreadDot, { backgroundColor: accent }]}
                />
              ) : null}
            </View>
            <Text
              style={[styles.scheduleTimeRange, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {timeRange}
            </Text>
          </View>
          {location || cardStatus ? (
            <View style={styles.scheduleCardBottomLine}>
              {location ? (
                <View style={styles.scheduleCardLocation}>
                  <Ionicons
                    accessible={false}
                    name="location-outline"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.scheduleCardLocationText,
                      { color: colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {location}
                  </Text>
                </View>
              ) : null}
              {cardStatus ? (
                <View style={styles.scheduleCardStatus}>
                  <Ionicons
                    accessible={false}
                    name={cardStatus.icon}
                    size={13}
                    color={cardStatus.color}
                  />
                  <Text
                    style={[
                      styles.scheduleCardStatusText,
                      { color: cardStatus.color },
                    ]}
                    numberOfLines={1}
                  >
                    {cardStatus.label}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ShareInboxButton>

      <View style={styles.shareCardAction}>
        {item.relation === 'owned' ? (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 공유 관리`}
            onPress={onManage}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.textSecondary}
              />
            </ShareInboxDecoration>
          </ShareInboxButton>
        ) : item.isPending ? (
          <ShareInboxDecoration>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textDisabled}
            />
          </ShareInboxDecoration>
        ) : (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 신고 또는 사용자 차단`}
            accessibilityState={{
              busy: safetyPending,
              disabled: safetyPending,
            }}
            disabled={safetyPending}
            onPress={onSafety}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: safetyPending ? 0.42 : pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              {safetyPending ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Ionicons
                  name="ellipsis-horizontal"
                  size={20}
                  color={colors.textSecondary}
                />
              )}
            </ShareInboxDecoration>
          </ShareInboxButton>
        )}
      </View>
    </CalendarGlassSurface>
  );
}

/** 공유 캘린더의 멤버 관계와 공유 범위를 한 행으로 표시합니다. */
export function CalendarShareRow({
  item,
  colors,
  accent,
  onOpen,
  onManage,
  onSafety,
  safetyPending,
}: {
  item: ShareLibraryItem;
  colors: AppColors;
  accent: string;
  onOpen: () => void;
  onManage: () => void;
  onSafety: () => void;
  safetyPending: boolean;
}) {
  const itemColor = item.color || accent;
  const ownedMemberCount =
    item.shareCount > 0
      ? item.shareCount
      : Math.max(0, (item.memberCount ?? 1) - 1);
  const relationMeta =
    item.relation === 'owned'
      ? ownedMemberCount > 0
        ? `내 캘린더 · ${ownedMemberCount}명과 공유 중`
        : `내 캘린더 · 활성 링크 ${item.activeInvitations.length}개`
      : item.isPending
      ? `${ownerLabel(item)}에게 받음 · 수락 대기`
      : `${ownerLabel(item)}에게 받음 · ${permissionLabel(
          item.permission,
        )} 권한`;
  const nextMeta = item.nextSchedule
    ? `${item.nextSchedule.title} · ${formatShortDate(
        item.nextSchedule.startAt,
      )} ${formatScheduleTimeRange(item.nextSchedule)}`
    : '예정된 다음 일정이 없어요';
  const calendarMode = contentModeLabel(item.contentMode);
  const calendarModeIcon =
    item.contentMode === 'SCHEDULE_AND_TRAVEL'
      ? ('navigate-outline' as const)
      : ('calendar-outline' as const);

  return (
    <CalendarGlassSurface
      prominent
      variant="card"
      tone="solidCard"
      style={[
        styles.shareCard,
        styles.calendarShareCard,
        { borderColor: colors.border },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.shareCardRail, { backgroundColor: itemColor }]}
      />
      <ShareInboxButton
        accessibilityLabel={`${item.title}, ${relationMeta}, ${calendarMode}, ${nextMeta}, 열기`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.shareCardOpenButton,
          styles.calendarCardOpenButton,
          { opacity: pressed ? 0.62 : 1 },
        ]}
      >
        <View style={styles.shareCardCopy}>
          <View style={styles.cardEyebrowRow}>
            <Ionicons
              accessible={false}
              name="people-outline"
              size={14}
              color={itemColor}
            />
            <Text
              style={[styles.cardEyebrow, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {relationMeta}
            </Text>
            <View style={styles.cardTopStatus}>
              <Ionicons
                accessible={false}
                name={calendarModeIcon}
                size={13}
                color={itemColor}
              />
              <Text
                style={[styles.cardTopStatusText, { color: itemColor }]}
                numberOfLines={1}
              >
                {calendarMode}
              </Text>
            </View>
          </View>
          <View style={styles.titleLine}>
            <Text
              style={[styles.shareCardTitle, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {item.isUnseen ? (
              <View
                accessibilityLabel="새 공유"
                style={[styles.unreadDot, { backgroundColor: accent }]}
              />
            ) : null}
          </View>
          <View style={styles.cardDetailLine}>
            <Ionicons
              accessible={false}
              name="time-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.cardDetailText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {nextMeta}
            </Text>
          </View>
        </View>
      </ShareInboxButton>

      <View style={styles.shareCardAction}>
        {item.relation === 'owned' ? (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 공유 관리`}
            onPress={onManage}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.textSecondary}
              />
            </ShareInboxDecoration>
          </ShareInboxButton>
        ) : item.isPending ? (
          <ShareInboxDecoration>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textDisabled}
            />
          </ShareInboxDecoration>
        ) : (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 신고 또는 사용자 차단`}
            accessibilityState={{
              busy: safetyPending,
              disabled: safetyPending,
            }}
            disabled={safetyPending}
            onPress={onSafety}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: safetyPending ? 0.42 : pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              {safetyPending ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Ionicons
                  name="ellipsis-horizontal"
                  size={20}
                  color={colors.textSecondary}
                />
              )}
            </ShareInboxDecoration>
          </ShareInboxButton>
        )}
      </View>
    </CalendarGlassSurface>
  );
}
