import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import styles from './inbox.styles';

import {
  type ShareLibraryFilter,
  type ShareLibraryRelation,
  type ShareLibrarySort,
  type ShareLibraryStatus,
  type ShareLibraryTab,
} from '../../src/modules/share/shareInboxPresentation';
import { type AppColors } from '../../src/modules/theme/ThemeContext';

import { DEFAULT_FILTER } from './shareInboxModel';

/** 현재 탭에 적용할 상태·관계·정렬 필터를 편집하는 하단 시트입니다. */
export function FilterSheet({
  visible,
  tab,
  filter,
  colors,
  accent,
  bottomInset,
  onClose,
  onApply,
}: {
  visible: boolean;
  tab: ShareLibraryTab;
  filter: ShareLibraryFilter;
  colors: AppColors;
  accent: string;
  bottomInset: number;
  onClose: () => void;
  onApply: (filter: ShareLibraryFilter) => void;
}) {
  const [draft, setDraft] = useState<ShareLibraryFilter>(filter);

  useEffect(() => {
    if (visible) setDraft(filter);
  }, [filter, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot} accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="필터 닫기"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View
          style={[
            styles.filterSheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: Math.max(bottomInset, 14) + 12,
            },
          ]}
        >
          <View
            style={[styles.sheetHandle, { backgroundColor: colors.border }]}
          />
          <View style={styles.sheetHeading}>
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>
              목록 필터
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setDraft({
                  ...DEFAULT_FILTER,
                  query: filter.query,
                })
              }
              style={styles.resetButton}
            >
              <Text style={[styles.resetButtonText, { color: accent }]}>
                초기화
              </Text>
            </Pressable>
          </View>

          <FilterGroup title="공유 관계" colors={colors}>
            <SegmentControl
              value={draft.relation}
              options={[
                ['all', '전체'],
                ['received', '받은 공유'],
                ['owned', '내가 공유'],
              ]}
              colors={colors}
              accent={accent}
              onChange={relation =>
                setDraft(current => ({
                  ...current,
                  relation: relation as ShareLibraryRelation,
                }))
              }
            />
          </FilterGroup>

          {tab === 'schedule' ? (
            <FilterGroup title="일정 상태" colors={colors}>
              <SegmentControl
                value={draft.status}
                options={[
                  ['all', '전체'],
                  ['routeNeeded', '경로 필요'],
                  ['departure', '출발 현황'],
                ]}
                colors={colors}
                accent={accent}
                onChange={status =>
                  setDraft(current => ({
                    ...current,
                    status: status as ShareLibraryStatus,
                  }))
                }
              />
            </FilterGroup>
          ) : null}

          <FilterGroup title="정렬" colors={colors}>
            <SortOption
              selected={draft.sort === 'upcoming'}
              title={tab === 'schedule' ? '가까운 일정순' : '다음 일정순'}
              description="다가오는 공유부터 표시"
              colors={colors}
              accent={accent}
              onPress={() =>
                setDraft(current => ({
                  ...current,
                  sort: 'upcoming',
                }))
              }
            />
            <SortOption
              selected={draft.sort === 'recent'}
              title="최근 공유순"
              description="새로 공유된 항목부터 표시"
              colors={colors}
              accent={accent}
              onPress={() =>
                setDraft(current => ({
                  ...current,
                  sort: 'recent',
                }))
              }
            />
          </FilterGroup>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onApply({
                ...draft,
                sort: draft.sort as ShareLibrarySort,
              })
            }
            style={({ pressed }) => [
              styles.applyButton,
              {
                backgroundColor: accent,
                opacity: pressed ? 0.76 : 1,
              },
            ]}
          >
            <Ionicons name="checkmark" size={19} color="#FFFFFF" />
            <Text style={styles.applyButtonText}>적용</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** 연관된 필터 선택지를 제목과 함께 묶어 표시합니다. */
function FilterGroup({
  title,
  colors,
  children,
}: {
  title: string;
  colors: AppColors;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={[styles.filterGroupTitle, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** 하나의 값만 선택할 수 있는 필터 세그먼트 목록을 렌더링합니다. */
function SegmentControl({
  value,
  options,
  colors,
  accent,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  colors: AppColors;
  accent: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={[styles.segmentControl, { backgroundColor: colors.surface2 }]}>
      {options.map(([optionValue, label]) => {
        const selected = optionValue === value;
        return (
          <Pressable
            key={optionValue}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(optionValue)}
            style={[
              styles.segmentOption,
              selected && {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentOptionText,
                { color: selected ? accent : colors.textSecondary },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 정렬 기준 한 항목의 선택 상태와 설명을 표시합니다. */
function SortOption({
  selected,
  title,
  description,
  colors,
  accent,
  onPress,
}: {
  selected: boolean;
  title: string;
  description: string;
  colors: AppColors;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.sortOption, { borderBottomColor: colors.border }]}
    >
      <View style={styles.sortCopy}>
        <Text style={[styles.sortTitle, { color: colors.textPrimary }]}>
          {title}
        </Text>
        <Text style={[styles.sortDescription, { color: colors.textSecondary }]}>
          {description}
        </Text>
      </View>
      <View
        style={[
          styles.radioCircle,
          {
            borderColor: selected ? accent : colors.border,
            backgroundColor: selected ? accent : undefined,
          },
          !selected && styles.transparentBackground,
        ]}
      >
        {selected ? (
          <Ionicons name="checkmark" size={13} color="#FFFFFF" />
        ) : null}
      </View>
    </Pressable>
  );
}
