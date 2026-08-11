import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { type PlaceSearchItem } from '../../src/modules/map/routingService';
import { type DeviceCalendarCandidate } from '../../src/modules/onboarding/deviceCalendarImport';
import { hasFavoriteDepartureCoords } from '../../src/modules/schedule/favoriteDeparture';
import type { Place } from '../../src/modules/schedule/types';
import { useTheme } from '../../src/modules/theme/ThemeContext';
import { createCalendarImportStyles } from './calendarImportStyles';

import {
  BRAND_BLUE,
  formatCandidateDate,
  isSamePlace,
} from './calendarImportModel';

/** 가져오기 후보 일정 한 건의 핵심 정보와 선택 상태를 표시하고 선택 토글을 전달합니다. */
export function CandidateRow({
  candidate,
  selected,
  onPress,
}: {
  candidate: DeviceCalendarCandidate;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${candidate.title}, ${formatCandidateDate(
        candidate,
      )}${candidate.locationName ? `, ${candidate.locationName}` : ''}`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.candidateRow,
        candidate.requiresTimeReview && styles.candidateRowReview,
        selected && styles.candidateRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[styles.checkCircle, selected && styles.checkCircleSelected]}
      >
        {selected ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : null}
      </View>
      <View style={styles.candidateBody}>
        <View style={styles.candidateTitleRow}>
          <Text numberOfLines={1} style={styles.candidateTitle}>
            {candidate.title}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.candidateMeta}>
          {formatCandidateDate(candidate)}
          {candidate.locationName ? ` · ${candidate.locationName}` : ''}
        </Text>
        <View style={styles.calendarSourceRow}>
          <View
            style={[
              styles.calendarSourceDot,
              {
                backgroundColor: candidate.calendarColor ?? colors.textDisabled,
              },
            ]}
          />
          <Text numberOfLines={1} style={styles.calendarSourceText}>
            {candidate.calendarTitle}
            {candidate.requiresTimeReview ? ' · 시간 확인 필요' : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** 가져온 일정에 적용할 기본 출발지를 선택·초기화할 수 있는 제어 영역을 렌더링합니다. */
export function DefaultOriginPicker({
  favorites,
  selected,
  query,
  results,
  searching,
  error,
  onQueryChange,
  onSearch,
  onSelect,
}: {
  favorites: Place[];
  selected?: Place;
  query: string;
  results: PlaceSearchItem[];
  searching: boolean;
  error: string | null;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelect: (place: Place) => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <View style={styles.defaultOriginWrap}>
      {favorites.length > 0 ? (
        <View style={styles.chipRow}>
          {favorites.slice(0, 5).map(place => (
            <OptionChip
              key={`${place.lat}:${place.lng}:${
                place.name ?? place.address ?? 'place'
              }`}
              label={place.name?.trim() || place.address?.trim() || '출발지'}
              icon="location-outline"
              active={Boolean(selected && isSamePlace(selected, place))}
              onPress={() => onSelect(place)}
            />
          ))}
        </View>
      ) : null}

      <View
        style={[
          styles.originSearchRow,
          selected && styles.originSearchRowSelected,
        ]}
      >
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          onSubmitEditing={onSearch}
          editable={!searching}
          returnKeyType="search"
          autoCorrect={false}
          placeholder="집, 회사 또는 도로명 주소 검색"
          placeholderTextColor={colors.textDisabled}
          style={styles.originSearchInput}
          accessibilityLabel="기본 출발지 검색"
        />
        <Pressable
          disabled={searching || !query.trim()}
          accessibilityRole="button"
          accessibilityLabel="출발지 검색"
          onPress={onSearch}
          style={({ pressed }) => [
            styles.originSearchButton,
            (searching || !query.trim()) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {searching ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      {selected && hasFavoriteDepartureCoords(selected) ? (
        <View style={styles.selectedOriginRow}>
          <Ionicons name="checkmark-circle" size={17} color={BRAND_BLUE} />
          <View style={styles.selectedOriginCopy}>
            <Text numberOfLines={1} style={styles.selectedOriginTitle}>
              {selected.name?.trim() || '선택한 출발지'}
            </Text>
            {selected.address ? (
              <Text numberOfLines={1} style={styles.selectedOriginAddress}>
                {selected.address}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {results.length > 0 ? (
        <View style={styles.originResultList}>
          {results.map((place, index) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${place.name || '장소'}, ${
                place.address || '주소 정보 없음'
              } 선택`}
              key={`${place.providerPlaceId ?? place.name}:${place.lat}:${
                place.lng
              }`}
              onPress={() => onSelect(place)}
              style={({ pressed }) => [
                styles.originResultRow,
                index > 0 && styles.originResultRowDivider,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="location-outline"
                size={18}
                color={colors.textSecondary}
              />
              <View style={styles.originResultCopy}>
                <Text numberOfLines={1} style={styles.originResultTitle}>
                  {place.name}
                </Text>
                <Text numberOfLines={1} style={styles.originResultAddress}>
                  {place.address}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.originSearchError}>{error}</Text> : null}
    </View>
  );
}

/** 짧은 선택지의 활성·비활성 상태를 칩으로 표시하고 누름 이벤트를 상위 제어기에 전달합니다. */
export function OptionChip({
  label,
  active,
  onPress,
  icon,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
  color?: string;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionChip,
        active && styles.optionChipActive,
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={active ? '#FFFFFF' : colors.textSecondary}
        />
      ) : color ? (
        <View style={[styles.optionColorDot, { backgroundColor: color }]} />
      ) : null}
      <Text
        style={[styles.optionChipText, active && styles.optionChipTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** 온보딩의 주요 진행 동작을 로딩·비활성 상태와 함께 일관된 버튼으로 렌더링합니다. */
export function PrimaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.primaryButtonText,
          disabled && styles.primaryButtonTextDisabled,
        ]}
      >
        {label}
      </Text>
      <Ionicons
        name="arrow-forward"
        size={18}
        color={disabled ? colors.textDisabled : '#FFFFFF'}
      />
    </Pressable>
  );
}

/** 주요 흐름을 방해하지 않는 보조 동작을 투명 배경 버튼으로 렌더링합니다. */
export function GhostButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostButton,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.ghostButtonText, disabled && styles.disabledText]}>
        {label}
      </Text>
    </Pressable>
  );
}
