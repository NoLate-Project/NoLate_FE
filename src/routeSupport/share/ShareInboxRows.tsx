import BrandedLoader from "../../ui/BrandedLoader";
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import styles from './inbox.styles';

import {
  ShareInboxButton,
  ShareInboxDecoration,
} from '../../modules/share/ShareInboxAccessibility';
import { type ShareLibraryItem } from '../../modules/share/shareInboxPresentation';
import { type AppColors } from '../../modules/theme/ThemeContext';

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
  standardText,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  accent: string;
  colors: AppColors;
  standardText: boolean;
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
        standardText && styles.tabButtonStandard,
        selected && {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        { opacity: pressed ? 0.68 : 1 },
      ]}
    >
      <View style={styles.tabLabelRow}>
        <Text
          maxFontSizeMultiplier={1.8}
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
  arrivalStyle,
  onOpen,
  openButtonRef,
  onManage,
  onSafety,
  safetyPending,
}: {
  item: ShareLibraryItem;
  colors: AppColors;
  accent: string;
  arrivalStyle?: StyleProp<ViewStyle>;
  onOpen: () => void;
  openButtonRef?: React.Ref<View>;
  onManage: () => void;
  onSafety: () => void;
  safetyPending: boolean;
}) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const itemColor = shareItemColor(item, accent);
  const location = scheduleLocationLabel(item.schedule);
  const dateTime = `${formatScheduleDate(
    item.schedule,
  )} · ${formatScheduleTimeRange(item.schedule)}`;
  const scheduleMeta = [dateTime, location].filter(Boolean).join(' · ');
  const relationMeta =
    item.relation === 'owned'
      ? item.shareCount > 0
        ? `내가 공유 · ${item.shareCount}명`
        : `활성 링크 · ${item.activeInvitations.length}개`
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
  return (
    <Animated.View style={[styles.shareListRow, { borderColor: colors.border }, arrivalStyle]}>
      <ShareInboxButton
        ref={openButtonRef}
        testID={`share-inbox-schedule-${item.resourceId}`}
        accessibilityLabel={`${item.title}, ${scheduleMeta}, ${relationMeta}${item.isUnseen ? ', 새 공유' : ''}${
          cardStatus ? `, ${cardStatus.label}` : ''
        }, 열기`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.shareListOpenButton,
          { opacity: pressed ? 0.62 : 1 },
        ]}
      >
        <View style={styles.titleLine}>
          <Text
            style={[styles.shareCardTitle, { color: colors.textPrimary }]}
            numberOfLines={largeText ? undefined : 1}
            maxFontSizeMultiplier={2}
            lineBreakStrategyIOS="hangul-word"
          >
            {item.title}
          </Text>
          {item.isUnseen ? (
            <View style={[styles.unreadDot, { backgroundColor: accent }]} />
          ) : null}
        </View>
        <View style={styles.shareListDetails}>
          <ShareInboxDecoration style={[styles.shareListRail, { backgroundColor: itemColor }]} />
          <View style={styles.shareCardCopy}>
            <Text
              style={[styles.scheduleTimeRange, { color: colors.textPrimary }]}
              maxFontSizeMultiplier={2}
              lineBreakStrategyIOS="hangul-word"
            >
              {dateTime}
            </Text>
            {location || cardStatus ? (
              <View style={[styles.scheduleCardBottomLine, largeText && styles.cardStacked]}>
                {location ? (
                  <View style={[styles.scheduleCardLocation, largeText && styles.stackedCardLine]}>
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
                      numberOfLines={largeText ? undefined : 1}
                      maxFontSizeMultiplier={2}
                      lineBreakStrategyIOS="hangul-word"
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
                      numberOfLines={largeText ? undefined : 1}
                      maxFontSizeMultiplier={2}
                      lineBreakStrategyIOS="hangul-word"
                    >
                      {cardStatus.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text
              style={[styles.shareListRelation, { color: colors.textSecondary }]}
              numberOfLines={largeText ? undefined : 1}
              maxFontSizeMultiplier={2}
              lineBreakStrategyIOS="hangul-word"
            >
              {relationMeta}
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
              name="chevron-forward-outline"
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
                <BrandedLoader size="inline" accessibilityLabel="신고 또는 차단 처리 중" />
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
    </Animated.View>
  );
}

/** 공유 캘린더의 멤버 관계와 공유 범위를 한 행으로 표시합니다. */
export function CalendarShareRow({
  item,
  colors,
  accent,
  onOpen,
  openButtonRef,
  onManage,
  onSafety,
  safetyPending,
}: {
  item: ShareLibraryItem;
  colors: AppColors;
  accent: string;
  onOpen: () => void;
  openButtonRef?: React.Ref<View>;
  onManage: () => void;
  onSafety: () => void;
  safetyPending: boolean;
}) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const itemColor = item.color || accent;
  const ownedMemberCount =
    item.shareCount > 0
      ? item.shareCount
      : Math.max(0, (item.memberCount ?? 1) - 1);
  const relationMeta = item.relation === 'owned'
    ? ownedMemberCount > 0
      ? `내 캘린더 · ${ownedMemberCount}명과 공유 중`
      : `내 캘린더 · 활성 링크 ${item.activeInvitations.length}개`
    : item.isPending ? '받은 캘린더 · 수락 대기' : `받은 캘린더 · ${permissionLabel(item.permission)} 권한`;
  const nextMeta = item.nextSchedule
    ? `${item.nextSchedule.title} · ${formatShortDate(
        item.nextSchedule.startAt,
      )} ${formatScheduleTimeRange(item.nextSchedule)}`
    : null;
  const calendarMode = contentModeLabel(item.contentMode);
  const owner = item.relation === 'owned' ? undefined : ownerLabel(item);

  return (
    <View style={[styles.shareListRow, { borderColor: colors.border }]}>
      <ShareInboxButton
        ref={openButtonRef}
        testID={`share-inbox-calendar-${item.resourceId}`}
        accessibilityLabel={[item.title, calendarMode, relationMeta, owner, nextMeta, item.isUnseen && '새 공유', '열기'].filter(Boolean).join(', ')}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.shareListOpenButton,
          styles.calendarShareOpenButton,
          { opacity: pressed ? 0.62 : 1 },
        ]}
      >
        <View style={styles.shareListDetails}>
          <ShareInboxDecoration style={[styles.shareListRail, { backgroundColor: itemColor }]} />
          <View style={styles.shareCardCopy}>
            <View style={styles.titleLine}>
              <Text
                style={[styles.shareCardTitle, { color: colors.textPrimary }]}
                numberOfLines={largeText ? undefined : 1}
                maxFontSizeMultiplier={2}
                lineBreakStrategyIOS="hangul-word"
              >
                {item.title}
              </Text>
              {item.isUnseen ? (
                <View style={[styles.unreadDot, { backgroundColor: accent }]} />
              ) : null}
            </View>
            <Text
              style={[styles.shareListRelation, { color: colors.textSecondary }]}
              maxFontSizeMultiplier={2}
              lineBreakStrategyIOS="hangul-word"
            >
              {calendarMode} · {relationMeta}
            </Text>
            {nextMeta ? (
              <View style={styles.cardDetailLine}>
                <Ionicons
                  accessible={false}
                  name="time-outline"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text
                  style={[styles.cardDetailText, { color: colors.textSecondary }]}
                  numberOfLines={largeText ? undefined : 1}
                  maxFontSizeMultiplier={2}
                  lineBreakStrategyIOS="hangul-word"
                >
                  {nextMeta}
                </Text>
              </View>
            ) : null}
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
              name="chevron-forward-outline"
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
                <BrandedLoader size="inline" accessibilityLabel="신고 또는 차단 처리 중" />
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
    </View>
  );
}
