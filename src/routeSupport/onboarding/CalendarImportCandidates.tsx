import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ScheduleCategory } from '../../modules/schedule/types';
import { useTheme } from '../../modules/theme/ThemeContext';
import { createCalendarImportStyles } from './calendarImportStyles';

import { OptionChip } from './CalendarImportControls';
import {
  BRAND_BLUE,
  CalendarProviderOption,
  CandidateSourceGroup,
} from './calendarImportModel';

/** 캘린더 제공자 한 건의 연결 가능 여부와 선택 상태를 행으로 표시하고, 사용자의 선택 이벤트를 상위 단계로 전달합니다. */
export function ProviderOptionRow({
  provider,
  selected,
  onPress,
}: {
  provider: CalendarProviderOption;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: !provider.available }}
      accessibilityLabel={`${provider.title}, ${provider.description}`}
      disabled={!provider.available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.providerRow,
        selected && styles.providerRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.providerIconWrap,
          !provider.available && styles.providerIconMuted,
        ]}
      >
        <Ionicons
          name={provider.icon}
          size={22}
          color={provider.available ? colors.textPrimary : colors.textSecondary}
        />
      </View>
      <View style={styles.providerCopy}>
        <View style={styles.providerTitleRow}>
          <Text numberOfLines={1} style={styles.providerTitle}>
            {provider.title}
          </Text>
          {provider.badge ? (
            <View style={styles.providerBadge}>
              <Text style={styles.providerBadgeText}>{provider.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={2} style={styles.providerDescription}>
          {provider.description}
        </Text>
      </View>
      <View
        style={[styles.providerCheck, selected && styles.providerCheckSelected]}
      >
        {selected ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : null}
      </View>
    </Pressable>
  );
}

/** 가져오기 후보의 전체·선택 개수를 요약하고 일괄 선택 또는 해제 동작을 노출합니다. */
export function CandidateSelectionSummaryRow({
  totalCount,
  selectedCount,
  onPress,
}: {
  totalCount: number;
  selectedCount: number;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const partiallySelected = selectedCount > 0 && !allSelected;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`전체 일정, ${selectedCount}/${totalCount}개 선택`}
      accessibilityState={{
        checked: allSelected ? true : partiallySelected ? 'mixed' : false,
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectionSummaryRow,
        (allSelected || partiallySelected) &&
          styles.selectionSummaryRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.checkCircle,
          (allSelected || partiallySelected) && styles.checkCircleSelected,
        ]}
      >
        {allSelected ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : null}
        {partiallySelected ? (
          <Ionicons name="remove" size={14} color="#FFFFFF" />
        ) : null}
      </View>
      <View style={styles.selectionSummaryCopy}>
        <Text style={styles.selectionSummaryTitle}>전체 일정</Text>
        <Text style={styles.selectionSummaryDescription}>
          {allSelected
            ? `${totalCount}개 모두 가져오기`
            : `${selectedCount}/${totalCount}개 선택`}
        </Text>
      </View>
      <Text style={styles.selectionSummaryAction}>
        {allSelected ? '선택 해제' : '모두 선택'}
      </Text>
    </Pressable>
  );
}

/** 개별 일정 후보 목록의 펼침 상태를 표시하고 접근성 정보를 포함한 토글 이벤트를 전달합니다. */
export function IndividualScheduleDisclosure({
  expanded,
  totalCount,
  selectedCount,
  onPress,
}: {
  expanded: boolean;
  totalCount: number;
  selectedCount: number;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`개별 일정 조정, ${selectedCount}/${totalCount}개 선택`}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.individualScheduleDisclosure,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.individualScheduleDisclosureIcon}>
        <Ionicons name="list-outline" size={18} color={BRAND_BLUE} />
      </View>
      <View style={styles.individualScheduleDisclosureCopy}>
        <Text style={styles.individualScheduleDisclosureTitle}>
          개별 일정 조정
        </Text>
        <Text style={styles.individualScheduleDisclosureDescription}>
          필요한 일정만 하나씩 선택하거나 해제해요
        </Text>
      </View>
      <Text style={styles.individualScheduleDisclosureCount}>
        {selectedCount}개
      </Text>
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={colors.textSecondary}
      />
    </Pressable>
  );
}

/** 원본 캘린더별 후보 수와 선택 상태를 표시하며 해당 그룹의 일괄 선택 동작을 처리합니다. */
export function CandidateSourceRow({
  group,
  active,
  onPress,
}: {
  group: CandidateSourceGroup;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  const partiallySelected = group.selectedCount > 0 && !active;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${group.title}, ${group.selectedCount}/${group.totalCount}개 선택`}
      accessibilityState={{
        checked: active ? true : group.selectedCount > 0 ? 'mixed' : false,
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceGroupButton,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.checkCircle,
          (active || partiallySelected) && styles.checkCircleSelected,
        ]}
      >
        {active ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : null}
        {partiallySelected ? (
          <Ionicons name="remove" size={14} color="#FFFFFF" />
        ) : null}
      </View>
      <View
        style={[
          styles.sourceGroupDot,
          { backgroundColor: group.color ?? colors.textDisabled },
        ]}
      />
      <View style={styles.sourceGroupCopy}>
        <Text numberOfLines={1} style={styles.sourceGroupText}>
          {group.title}
        </Text>
        <Text style={styles.sourceGroupCount}>
          {group.selectedCount}/{group.totalCount}개 선택
        </Text>
      </View>
    </Pressable>
  );
}

/** 가져온 일정을 저장할 카테고리 배정 영역의 요약과 펼침 상태를 렌더링합니다. */
export function CategoryAssignmentDisclosure({
  expanded,
  sourceCount,
  overrideCount,
  onPress,
}: {
  expanded: boolean;
  sourceCount: number;
  overrideCount: number;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  const description =
    overrideCount > 0
      ? `${overrideCount}개 캘린더에 다른 카테고리를 적용했어요`
      : `${sourceCount}개 캘린더 모두 기본 카테고리를 사용해요`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`캘린더별 카테고리, ${description}`}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryAssignmentDisclosure,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.categoryAssignmentDisclosureIcon}>
        <Ionicons name="albums-outline" size={18} color={BRAND_BLUE} />
      </View>
      <View style={styles.categoryAssignmentDisclosureCopy}>
        <Text style={styles.categoryAssignmentDisclosureTitle}>
          캘린더별 카테고리
        </Text>
        <Text
          numberOfLines={2}
          style={styles.categoryAssignmentDisclosureDescription}
        >
          {description}
        </Text>
      </View>
      {overrideCount > 0 ? (
        <Text style={styles.categoryAssignmentDisclosureCount}>
          {overrideCount}개 변경
        </Text>
      ) : null}
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={colors.textSecondary}
      />
    </Pressable>
  );
}

/** 원본 캘린더와 대상 카테고리의 매핑 한 건을 표시하고 카테고리 변경 이벤트를 전달합니다. */
export function CategoryAssignmentRow({
  group,
  categories,
  category,
  expanded,
  usesDefault,
  last,
  onToggle,
  onSelect,
}: {
  group: CandidateSourceGroup;
  categories: readonly ScheduleCategory[];
  category?: ScheduleCategory;
  expanded: boolean;
  usesDefault: boolean;
  last: boolean;
  onToggle: () => void;
  onSelect: (categoryId: string) => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <View
      style={[
        styles.categoryAssignmentItem,
        !last && styles.categoryAssignmentItemDivider,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${group.title}, ${group.selectedCount}개 일정, ${
          category?.title ?? '카테고리 확인 필요'
        }, ${usesDefault ? '기본 카테고리 사용' : '개별 설정'}`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.categoryAssignmentRow,
          pressed && styles.pressed,
        ]}
      >
        <View
          style={[
            styles.categoryAssignmentSourceIcon,
            { backgroundColor: group.color ?? colors.textDisabled },
          ]}
        />
        <View style={styles.categoryAssignmentSourceCopy}>
          <Text numberOfLines={1} style={styles.categoryAssignmentSourceTitle}>
            {group.title}
          </Text>
          <Text
            style={[
              styles.categoryAssignmentSourceCount,
              !usesDefault && styles.categoryAssignmentSourceCountCustom,
            ]}
          >
            {group.selectedCount}개 일정 ·{' '}
            {usesDefault ? '기본값' : '개별 설정'}
          </Text>
        </View>
        <View style={styles.categoryAssignmentValue}>
          {category ? (
            <View
              style={[
                styles.categoryAssignmentValueDot,
                { backgroundColor: category.color },
              ]}
            />
          ) : null}
          <Text numberOfLines={1} style={styles.categoryAssignmentValueText}>
            {category?.title ?? '확인 필요'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textSecondary}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.categoryAssignmentOptions}>
          {categories.map(item => (
            <OptionChip
              key={item.id}
              label={item.title}
              active={item.id === category?.id}
              color={item.color}
              onPress={() => onSelect(item.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 캘린더 가져오기 결과의 성공·건너뜀·실패 수를 사용자에게 읽기 쉬운 요약으로 표시합니다. */
export function ImportResultSummary({
  importedCount,
  alreadyImportedCount,
  preparedRouteCount,
  notificationReadyCount,
  failedImportCount,
}: {
  importedCount: number;
  alreadyImportedCount: number;
  preparedRouteCount: number;
  notificationReadyCount: number;
  failedImportCount: number;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  const failureColor = mode === 'dark' ? '#FF6961' : '#D92D20';
  const rows: Array<{
    label: string;
    value: string;
    icon: ComponentProps<typeof Ionicons>['name'];
    tone?: 'neutral' | 'failure';
  }> = [];

  if (importedCount > 0) {
    rows.push({
      label: '새로 가져온 일정',
      value: `${importedCount}개`,
      icon: 'calendar-outline',
    });
  }
  if (alreadyImportedCount > 0) {
    rows.push({
      label: '중복 없이 유지한 일정',
      value: `${alreadyImportedCount}개`,
      icon: 'shield-checkmark-outline',
      tone: 'neutral',
    });
  }
  if (preparedRouteCount > 0) {
    rows.push({
      label: '경로 준비',
      value: `${preparedRouteCount}개`,
      icon: 'navigate-outline',
    });
  }
  if (notificationReadyCount > 0) {
    rows.push({
      label: '출발 알림 준비',
      value: `${notificationReadyCount}개`,
      icon: 'notifications-outline',
    });
  }
  if (failedImportCount > 0) {
    rows.push({
      label: '확인이 필요한 일정',
      value: `${failedImportCount}개`,
      icon: 'alert-circle-outline',
      tone: 'failure',
    });
  }

  if (rows.length === 0) return null;

  return (
    <View accessibilityLabel="가져오기 결과" style={styles.importResultSummary}>
      {rows.map((row, index) => {
        const iconColor =
          row.tone === 'failure'
            ? failureColor
            : row.tone === 'neutral'
            ? colors.textSecondary
            : BRAND_BLUE;

        return (
          <View
            key={row.label}
            style={[
              styles.importResultRow,
              index > 0 && styles.importResultRowDivider,
            ]}
          >
            <View style={styles.importResultIcon}>
              <Ionicons name={row.icon} size={17} color={iconColor} />
            </View>
            <Text style={styles.importResultLabel}>{row.label}</Text>
            <Text
              style={[
                styles.importResultValue,
                row.tone === 'failure' && { color: failureColor },
              ]}
            >
              {row.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** 온보딩 섹션의 제목과 선택적 보조 설명을 일관된 타이포그래피로 렌더링합니다. */
export function SectionTitle({ label }: { label: string }) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  return <Text style={styles.sectionTitle}>{label}</Text>;
}
