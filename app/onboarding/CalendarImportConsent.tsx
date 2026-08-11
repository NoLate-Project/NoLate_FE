import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '../../src/modules/theme/ThemeContext';
import { createCalendarImportStyles } from './calendarImportStyles';

import {
  BRAND_BLUE,
  CalendarConsentId,
  CalendarConsentItem,
  CURATION_PROGRESS_SEGMENT_COUNT,
  OnboardingStep,
} from './calendarImportModel';

/** 캘린더 조회·일정 생성에 필요한 동의 항목을 표시하고 필수 동의 상태 변경을 상위 흐름에 전달합니다. */
export function CalendarConsentChecklist({
  items,
  acceptedIds,
  expandedIds,
  allAccepted,
  onToggleAll,
  onToggleItem,
  onToggleDetail,
}: {
  items: CalendarConsentItem[];
  acceptedIds: Set<CalendarConsentId>;
  expandedIds: Set<CalendarConsentId>;
  allAccepted: boolean;
  onToggleAll: () => void;
  onToggleItem: (id: CalendarConsentId) => void;
  onToggleDetail: (id: CalendarConsentId) => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <View style={styles.consentCard}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allAccepted }}
        accessibilityLabel="필수 캘린더 연동 항목 모두 동의"
        onPress={onToggleAll}
        style={({ pressed }) => [
          styles.consentAllRow,
          pressed && styles.pressed,
        ]}
      >
        <ConsentCheck checked={allAccepted} />
        <View style={styles.consentCopy}>
          <Text style={styles.consentAllTitle}>필수 항목에 모두 동의해요</Text>
          <Text style={styles.consentDescription}>
            원본은 바꾸지 않고, 선택한 일정만 NoLate로 가져와요.
          </Text>
        </View>
      </Pressable>

      <View style={styles.consentItemList}>
        {items.map(item => {
          const checked = acceptedIds.has(item.id);
          const expanded = expandedIds.has(item.id);

          return (
            <View key={item.id} style={styles.consentItem}>
              <View style={styles.consentItemHeader}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={`${item.title} ${
                    item.required ? '필수' : '선택'
                  } 동의`}
                  onPress={() => onToggleItem(item.id)}
                  style={({ pressed }) => [
                    styles.consentItemToggle,
                    pressed && styles.pressed,
                  ]}
                >
                  <ConsentCheck checked={checked} compact />
                  <View style={styles.consentCopy}>
                    <View style={styles.consentTitleRow}>
                      <Text numberOfLines={1} style={styles.consentItemTitle}>
                        {item.title}
                      </Text>
                      {item.required ? (
                        <Text style={styles.consentRequired}>(필수)</Text>
                      ) : null}
                    </View>
                    <Text numberOfLines={2} style={styles.consentDescription}>
                      {item.summary}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${item.title} 상세 ${
                    expanded ? '접기' : '보기'
                  }`}
                  hitSlop={8}
                  onPress={() => onToggleDetail(item.id)}
                  style={({ pressed }) => [
                    styles.consentChevron,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={17}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>

              {expanded ? (
                <View style={styles.consentDetailList}>
                  {item.detail.map(line => (
                    <View key={line} style={styles.consentDetailRow}>
                      <Text style={styles.consentDetailBullet}>-</Text>
                      <Text style={styles.consentDetailText}>{line}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** 동의 항목 한 건의 선택 상태와 필수 여부를 접근성 가능한 체크 행으로 렌더링합니다. */
export function ConsentCheck({
  checked,
  compact,
}: {
  checked: boolean;
  compact?: boolean;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <View
      style={[
        compact ? styles.consentCheckCompact : styles.consentCheck,
        checked && styles.consentCheckSelected,
      ]}
    >
      {checked ? (
        <Ionicons name="checkmark" size={compact ? 13 : 15} color="#FFFFFF" />
      ) : null}
    </View>
  );
}

/** 현재 온보딩 단계와 전체 단계를 진행 막대와 설명 텍스트로 표시합니다. */
export function CurationProgress({ step }: { step: OnboardingStep }) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  const current = curationProgressValue(step);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="캘린더 가져오기 진행 상황"
      accessibilityValue={{
        min: 1,
        max: CURATION_PROGRESS_SEGMENT_COUNT,
        now: current,
        text: `${current}/${CURATION_PROGRESS_SEGMENT_COUNT}단계`,
      }}
      style={styles.curationProgress}
    >
      {Array.from({ length: CURATION_PROGRESS_SEGMENT_COUNT }, (_, index) => (
        <View
          key={index}
          style={[
            styles.curationProgressSegment,
            index < current && styles.curationProgressSegmentActive,
          ]}
        />
      ))}
    </View>
  );
}

/** 온보딩 단계의 의미와 완료 여부에 맞는 아이콘을 선택해 표시합니다. */
export function StepIcon({
  name,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <View style={styles.stepIcon}>
      <Ionicons name={name} size={28} color={BRAND_BLUE} />
    </View>
  );
}

/** 현재 단계 인덱스를 0~1 범위의 진행률로 정규화해 진행 막대 너비 계산에 사용합니다. */
function curationProgressValue(step: OnboardingStep): number {
  switch (step) {
    case 'intro':
      return 1;
    case 'provider':
      return 2;
    case 'permission':
    case 'scanning':
      return 3;
    case 'select':
      return 4;
    case 'enrich':
      return 5;
    case 'complete':
      return 6;
  }
}

/** 캘린더 가져오기 소개 문구 한 건을 아이콘, 제목, 설명이 있는 행으로 렌더링합니다. */
export function IntroPoint({ label }: { label: string }) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <View style={styles.introPoint}>
      <Ionicons name="checkmark-circle" size={18} color={BRAND_BLUE} />
      <Text style={styles.introPointText}>{label}</Text>
    </View>
  );
}
