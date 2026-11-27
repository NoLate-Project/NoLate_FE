import BrandedLoader from "../../ui/BrandedLoader";
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  FavoritePlace,
  FavoritePlaceCategory,
} from '../../api/favoritePlaces';
import type { PlaceSearchItem } from '../../modules/map/routingService';
import { getFavoritePlaceCategoryDisplayName } from '../../modules/schedule/favoritePlaceSelection';
import { useTheme } from '../../modules/theme/ThemeContext';
import styles from './places.styles';
import {
  CATEGORY_COLOR_OPTIONS,
  isSameFavoritePlace as samePlace,
  type PlaceEditorSheet,
  type SearchMode,
} from './placesSettingsModel';

/** 내 장소 화면의 탭, 검색 시트, 장소·카테고리 편집 UI를 모은 프레젠테이션 구성 요소입니다. */
export function CategoryTab({
  label,
  count,
  selected,
  color,
  icon,
  colors,
  disabled,
  reduceMotionEnabled,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  color: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  colors: ReturnType<typeof useTheme>['colors'];
  disabled?: boolean;
  reduceMotionEnabled: boolean;
  onPress: () => void;
}) {
  const selectionProgress = useRef(
    new Animated.Value(selected ? 1 : 0),
  ).current;

  useEffect(() => {
    selectionProgress.stopAnimation();
    if (reduceMotionEnabled) {
      selectionProgress.setValue(selected ? 1 : 0);
      return;
    }
    const animation = Animated.timing(selectionProgress, {
      toValue: selected ? 1 : 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotionEnabled, selected, selectionProgress]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} 카테고리, 장소 ${count}개`}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryTab,
        {
          borderColor: selected ? color : colors.border,
          backgroundColor: selected ? `${color}18` : colors.surface,
          opacity: pressed || disabled ? 0.55 : 1,
        },
      ]}
    >
      <View style={[styles.categoryTabMark, { backgroundColor: `${color}20` }]}>
        {icon ? (
          <Ionicons name={icon} size={16} color={color} />
        ) : (
          <View style={[styles.categoryTabDot, { backgroundColor: color }]} />
        )}
      </View>
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={1.65}
        style={[
          styles.categoryTabLabel,
          { color: colors.textPrimary },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.categoryTabCount,
          { backgroundColor: selected ? `${color}20` : colors.surface2 },
        ]}
      >
        <Text
          maxFontSizeMultiplier={1.4}
          style={[
            styles.categoryTabCountText,
            { color: selected ? color : colors.textSecondary },
          ]}
        >
          {count}
        </Text>
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.categoryTabIndicator,
          {
            backgroundColor: color,
            opacity: selectionProgress,
            transform: [
              {
                scaleX: selectionProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.35, 1],
                }),
              },
            ],
          },
        ]}
      />
    </Pressable>
  );
}

/** 장소 설정 화면의 아이콘형 동작을 접근성 레이블과 누름 피드백을 포함해 렌더링합니다. */
export function IconAction({
  label,
  icon,
  disabled,
  destructive = false,
  visibleLabel,
  colors,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  destructive?: boolean;
  visibleLabel?: string;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        visibleLabel ? styles.namedPlaceAction : styles.iconAction,
        {
          backgroundColor: visibleLabel ? "transparent" : colors.surface2,
          opacity: disabled ? 0.3 : pressed ? 0.55 : 1,
        },
      ]}
    >
      <Ionicons
        accessible={false}
        name={icon}
        size={18}
        color={destructive ? '#EF4444' : colors.textSecondary}
      />
      {!!visibleLabel && <Text style={[styles.namedPlaceActionLabel, { color: destructive ? '#EF4444' : colors.textPrimary }]}>
        {visibleLabel}
      </Text>}
    </Pressable>
  );
}

/** 설정 시트의 제목, 닫기 동작, 선택적 보조 액션을 공통 헤더 형태로 구성합니다. */
export function SheetHeader({
  title,
  caption,
  colors,
  disabled,
  onClose,
  back = false,
}: {
  title: string;
  caption: string;
  colors: ReturnType<typeof useTheme>['colors'];
  disabled?: boolean;
  onClose: () => void;
  back?: boolean;
}) {
  const closeButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} 닫기`}
      disabled={disabled}
      onPress={onClose}
      style={({ pressed }) => [
        styles.sheetClose,
        {
          backgroundColor: back ? 'transparent' : colors.surface2,
          opacity: pressed || disabled ? 0.55 : 1,
        },
      ]}
    >
      <Ionicons name={back ? 'chevron-back-outline' : 'close'} size={21} color={colors.textPrimary} />
    </Pressable>
  );
  return (
    <View style={[styles.sheetHeader, back && styles.sheetBackHeader, { borderBottomColor: colors.border }]}>
      {back ? closeButton : null}
      <View style={styles.flexText}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.sheetTitle, { color: colors.textPrimary }]}>
          {title}
        </Text>
        <Text maxFontSizeMultiplier={1.8} lineBreakStrategyIOS="hangul-word" style={[styles.sheetCaption, { color: colors.textSecondary }]}>
          {caption}
        </Text>
      </View>
      {back ? null : closeButton}
    </View>
  );
}

/** 장소 검색어 입력, 결과 목록, 로딩·빈 상태를 하나의 검색 시트로 렌더링합니다. */
export function SearchSheet({
  mode,
  active = true,
  standardLayout,
  dark,
  query,
  results,
  searchCompleted,
  favorites,
  defaultOrigin,
  searching,
  disabled,
  colors,
  onChangeQuery,
  onSearch,
  onSelectResult,
  onSelectFavorite,
  onClose,
}: {
  mode: SearchMode;
  active?: boolean;
  standardLayout: boolean;
  dark: boolean;
  query: string;
  results: PlaceSearchItem[];
  searchCompleted: boolean;
  favorites: FavoritePlace[];
  defaultOrigin: FavoritePlace | null;
  searching: boolean;
  disabled: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onChangeQuery: (query: string) => void;
  onSearch: () => void;
  onSelectResult: (place: PlaceSearchItem) => void;
  onSelectFavorite: (favorite: FavoritePlace) => void;
  onClose: () => void;
}) {
  const lastResult = useRef<number | null>(null);
  const resultButtons = useRef(new Map<number, View>());
  const searchIconColor = dark ? '#AAB2BE' : colors.textSecondary;
  const resultRuleColor = dark ? '#343943' : colors.border;
  useEffect(() => {
    const index = lastResult.current;
    if (!active || index === null) return;
    const frame = requestAnimationFrame(() => {
      const target = resultButtons.current.get(index);
      if (target) AccessibilityInfo.sendAccessibilityEvent?.(target, 'focus');
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const savedPlaces = mode === 'default' && favorites.length > 0 ? (
    <View style={styles.sheetSection}>
      <Text
        style={[
          styles.sheetSectionTitle,
          { color: colors.textSecondary },
        ]}
      >
        즐겨찾기에서 선택
      </Text>
      {favorites.map(favorite => {
        const selected = samePlace(defaultOrigin, favorite);
        return (
          <Pressable
            key={favorite.id ?? favorite.name}
            accessibilityRole="button"
            accessibilityLabel={`${favorite.name ?? '장소'}${
              selected ? ', 현재 기본주소' : ', 기본주소로 선택'
            }`}
            accessibilityState={{
              selected,
              disabled: selected || !favorite.id || disabled,
            }}
            disabled={selected || !favorite.id || disabled}
            onPress={() => onSelectFavorite(favorite)}
            style={({ pressed }) => [
              styles.sheetPlaceRow,
              {
                backgroundColor: colors.surface,
                borderColor: selected ? '#2563EB' : colors.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons
              name={selected ? 'home-outline' : 'star-outline'}
              size={20}
              color="#2563EB"
            />
            <View style={styles.flexText}>
              <Text
                numberOfLines={1}
                style={[styles.cardTitle, { color: colors.textPrimary }]}
              >
                {favorite.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.cardCaption,
                  { color: colors.textSecondary },
                ]}
              >
                {favorite.address}
              </Text>
            </View>
            {selected ? (
              <Text style={styles.selectedText}>현재 설정</Text>
            ) : (
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  ) : null;

  return (
    <>
      <SheetHeader
        title={mode === 'default' ? '기본주소 선택' : '즐겨찾기 추가'}
        caption={
          mode === 'default'
            ? '저장한 장소를 고르거나 새 주소를 검색하세요'
            : '장소명이나 주소로 검색하세요'
        }
        back={standardLayout}
        colors={colors}
        disabled={disabled}
        onClose={onClose}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.sheetContent}
      >
        {!standardLayout ? savedPlaces : null}

        <View style={styles.sheetSection}>
          <Text
            style={[styles.sheetSectionTitle, { color: colors.textSecondary }]}
          >
            {standardLayout ? '장소 검색' : '새 장소 검색'}
          </Text>
          <View
            style={[
              styles.searchBar,
              standardLayout && styles.searchCompactBar,
              {
                backgroundColor: dark ? '#111216' : colors.inputBackground,
                borderColor: dark ? '#2B2E35' : colors.inputBorder,
              },
            ]}
          >
            <Ionicons accessible={false} name="search-outline" size={standardLayout ? 18 : 20} color={searchIconColor} />
            <TextInput
              autoFocus
              accessibilityLabel="장소명 또는 주소 검색"
              value={query}
              editable={!searching && !disabled}
              onChangeText={text => {
                lastResult.current = null;
                onChangeQuery(text);
              }}
              onSubmitEditing={onSearch}
              returnKeyType="search"
              placeholder={standardLayout ? '장소명 또는 주소' : '장소명 또는 주소를 입력하세요'}
              placeholderTextColor={colors.inputPlaceholder}
              style={[styles.searchInput, { color: colors.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="장소 검색"
              accessibilityState={{ disabled: searching || disabled }}
              disabled={searching || disabled}
              onPress={onSearch}
              style={({ pressed }) => [
                styles.searchButton,
                standardLayout && styles.searchCompactButton,
                dark && styles.searchDarkButton,
                { opacity: pressed || searching || disabled ? 0.55 : 1 },
              ]}
            >
              {searching ? (
                <BrandedLoader size="inline" accessibilityLabel="장소 검색 중" />
              ) : (
                <Ionicons name="arrow-forward-outline" size={19} color={dark ? '#111216' : '#FFFFFF'} />
              )}
            </Pressable>
          </View>
          {(results.length > 0 || (standardLayout && searchCompleted)) ? (
            <View style={!standardLayout && styles.sheetSection}>
              {standardLayout && searchCompleted ? (
                <Text
                  accessibilityRole="header"
                  accessibilityLiveRegion="polite"
                  style={[styles.searchResultCount, { color: searchIconColor }]}
                >
                  {results.length ? `검색 결과 ${results.length}곳` : '검색 결과가 없어요'}
                </Text>
              ) : null}
              {results.map((result, index) => (
                <Pressable
                  key={`${result.provider ?? 'place'}-${
                    result.providerPlaceId ?? `${result.lat}-${result.lng}`
                  }-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${result.name}, ${result.address} 선택`}
                  disabled={disabled}
                  ref={node => {
                    if (node) resultButtons.current.set(index, node);
                    else resultButtons.current.delete(index);
                  }}
                  onPress={() => {
                    lastResult.current = index;
                    onSelectResult(result);
                  }}
                  style={({ pressed }) => [
                    styles.searchResult,
                    standardLayout && styles.searchCompactResult,
                    {
                      borderBottomColor: resultRuleColor,
                      opacity: pressed || disabled ? 0.55 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.searchResultIcon,
                      standardLayout && styles.searchCompactIcon,
                      { backgroundColor: dark ? '#22252B' : colors.surface2 },
                    ]}
                  >
                    <Ionicons
                      accessible={false}
                      name="location-outline"
                      size={standardLayout ? 16 : 20}
                      color={searchIconColor}
                    />
                  </View>
                  <View style={styles.flexText}>
                    <Text
                      numberOfLines={standardLayout ? 2 : 1}
                      lineBreakStrategyIOS={standardLayout ? 'hangul-word' : undefined}
                      style={[styles.cardTitle, { color: colors.textPrimary }]}
                    >
                      {result.name}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[styles.cardCaption, { color: searchIconColor }]}
                    >
                      {result.address}
                    </Text>
                  </View>
                  {!standardLayout ? (
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {standardLayout ? savedPlaces : null}
          {!searching && results.length === 0 && (!standardLayout || !searchCompleted) ? (
            <View style={styles.searchGuide}>
              <Ionicons
                name="map-outline"
                size={28}
                color={colors.textDisabled}
              />
              <Text
                style={[
                  styles.searchGuideText,
                  { color: colors.textSecondary },
                ]}
              >
                예: 서울역, 강남대로 396
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

/** 즐겨찾기 장소의 이름·주소·좌표·카테고리를 작성하거나 수정하는 폼을 렌더링합니다. */
export function PlaceEditor({
  sheet,
  categories,
  standardLayout,
  disabled,
  colors,
  onChange,
  onSave,
  onClose,
  onAddCategory,
}: {
  sheet: PlaceEditorSheet;
  categories: FavoritePlaceCategory[];
  standardLayout: boolean;
  disabled: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onChange: (
    updates: Partial<Pick<PlaceEditorSheet, 'label' | 'categoryId'>>,
  ) => void;
  onSave: () => void;
  onClose: () => void;
  onAddCategory?: () => void;
}) {
  const placeName = sheet.placeName ?? sheet.place.name ?? sheet.place.address ?? '선택한 장소';
  const address = sheet.place.address !== placeName ? sheet.place.address : undefined;
  return (
    <>
      <SheetHeader
        title={sheet.favoriteId ? '즐겨찾기 수정' : '즐겨찾기 저장'}
        caption={onAddCategory
          ? '장소 이름과 분류를 확인해 주세요'
          : sheet.place.address ?? sheet.place.name ?? '선택한 장소'}
        back={!!onAddCategory}
        colors={colors}
        disabled={disabled}
        onClose={onClose}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios' && standardLayout}
        contentContainerStyle={styles.editorContent}
      >
        {onAddCategory ? (
          <View style={[styles.sheetPlaceRow, styles.editorPlace, {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
          }]}>
            <Ionicons accessible={false} name="location-outline" size={20} color="#2563EB" />
            <View style={styles.flexText}>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {placeName}
              </Text>
              {address ? (
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.cardCaption, { color: colors.textSecondary }]}>
                  {address}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        <Text maxFontSizeMultiplier={1.8} style={[styles.inputLabel, { color: colors.textSecondary }]}>
          표시할 이름
        </Text>
        <TextInput
          accessibilityLabel="즐겨찾기 장소 이름"
          returnKeyType={standardLayout ? 'done' : undefined}
          submitBehavior={standardLayout ? 'blurAndSubmit' : undefined}
          maxFontSizeMultiplier={2}
          value={sheet.label}
          editable={!disabled}
          onChangeText={label => onChange({ label })}
          placeholder="예: 회사, 헬스장"
          placeholderTextColor={colors.inputPlaceholder}
          style={[
            styles.editorInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.textPrimary,
            },
          ]}
        />

        <Text maxFontSizeMultiplier={1.8} style={[styles.inputLabel, { color: colors.textSecondary }]}>
          즐겨찾기 카테고리
        </Text>
        <View style={styles.choiceWrap}>
          <ChoiceChip
            label="미분류"
            selected={!sheet.categoryId}
            color={onAddCategory ? '#2563EB' : '#64748B'}
            textColor={colors.textPrimary}
            disabled={disabled}
            onPress={() => onChange({ categoryId: undefined })}
          />
          {onAddCategory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="카테고리 추가"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onAddCategory}
              style={({ pressed }) => [
                styles.choiceChip,
                styles.addCategoryChip,
                { borderColor: colors.border, opacity: pressed || disabled ? 0.55 : 1 },
              ]}
            >
              <Ionicons accessible={false} name="add-outline" size={17} color={colors.textSecondary} />
              <Text style={[styles.choiceChipText, { color: colors.textSecondary }]}>카테고리 추가</Text>
            </Pressable>
          ) : null}
          {categories.map(category => (
            <ChoiceChip
              key={category.id ?? category.name}
              label={getFavoritePlaceCategoryDisplayName(category.name)}
              selected={sheet.categoryId === category.id}
              color={category.color}
              textColor={colors.textPrimary}
              disabled={disabled || !category.id}
              onPress={() => onChange({ categoryId: category.id })}
            />
          ))}
        </View>
        {!onAddCategory && categories.length === 0 ? (
          <Text maxFontSizeMultiplier={1.8} style={[styles.helperText, { color: colors.textSecondary }]}>
            카테고리는 내 장소 화면 상단에서 만들 수 있습니다.
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="즐겨찾기 저장"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onSave}
          style={({ pressed }) => [
            styles.editorSaveButton,
            { opacity: pressed || disabled ? 0.6 : 1 },
          ]}
        >
          {disabled ? (
            <BrandedLoader size="inline" accessibilityLabel="장소 저장 중" />
          ) : (
            <Ionicons name="checkmark-outline" size={20} color="#FFFFFF" />
          )}
          <Text maxFontSizeMultiplier={1.8} style={styles.editorSaveText}>저장</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

/** 장소 카테고리의 이름과 색상을 작성하고 저장·삭제 동작을 제공하는 편집기를 렌더링합니다. */
export function CategoryEditor({
  categoryId,
  standardCreate,
  name,
  color,
  disabled,
  colors,
  onChange,
  onSave,
  onClose,
}: {
  categoryId?: string;
  standardCreate: boolean;
  name: string;
  color: string;
  disabled: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onChange: (updates: { name?: string; color?: string }) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <SheetHeader
        title={categoryId ? '카테고리 수정' : '새 카테고리'}
        caption={standardCreate
          ? '즐겨찾기를 모아 볼 탭을 만들어요'
          : '즐겨찾기를 모아볼 탭의 이름과 색상이에요'}
        back={standardCreate}
        colors={colors}
        disabled={disabled}
        onClose={onClose}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.editorContent, standardCreate && styles.categoryCreateContent]}
      >
        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
          카테고리 이름
        </Text>
        <TextInput
          autoFocus={!standardCreate}
          accessibilityLabel="즐겨찾기 카테고리 이름"
          value={name}
          editable={!disabled}
          maxLength={24}
          onChangeText={nextName => onChange({ name: nextName })}
          placeholder="예: 회사, 운동, 가족"
          placeholderTextColor={colors.inputPlaceholder}
          style={[
            styles.editorInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.textPrimary,
            },
          ]}
        />
        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
          {standardCreate ? '색상' : '카테고리 색상'}
        </Text>
        <View style={[styles.colorChoices, standardCreate && styles.categoryCreateColors]}>
          {CATEGORY_COLOR_OPTIONS.map(({ color: candidate, label }) => {
            const selected = candidate === color;
            const selectionMark = selected ? (
              <Ionicons
                accessible={false}
                name={standardCreate ? 'checkmark-outline' : 'checkmark'}
                size={standardCreate ? 17 : 20}
                color="#FFFFFF"
              />
            ) : null;
            return (
              <Pressable
                key={candidate}
                accessibilityRole="radio"
                accessibilityLabel={standardCreate ? label : `색상 ${candidate}`}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => onChange({ color: candidate })}
                style={({ pressed }) => [
                  standardCreate ? styles.categoryColorTarget : styles.colorChoice,
                  {
                    backgroundColor: standardCreate ? undefined : candidate,
                    borderColor: !standardCreate && selected ? colors.textPrimary : 'transparent',
                    opacity: pressed || disabled ? 0.55 : 1,
                  },
                ]}
              >
                {standardCreate ? (
                  <View style={[
                    styles.categoryColorSwatch,
                    { backgroundColor: candidate, borderColor: selected ? colors.textPrimary : 'transparent' },
                  ]}>
                    {selectionMark}
                  </View>
                ) : selectionMark}
              </Pressable>
            );
          })}
        </View>
        {standardCreate ? (
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            이 색은 카테고리 탭과 장소 표식에 함께 사용돼요.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={standardCreate ? '카테고리 만들기' : '즐겨찾기 카테고리 저장'}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onSave}
          style={({ pressed }) => [
            styles.editorSaveButton,
            { opacity: pressed || disabled ? 0.6 : 1 },
          ]}
        >
          {disabled ? (
            <BrandedLoader size="inline" accessibilityLabel="카테고리 저장 중" />
          ) : (
            <Ionicons name={standardCreate ? 'checkmark-outline' : 'checkmark'} size={20} color="#FFFFFF" />
          )}
          <Text style={styles.editorSaveText}>{standardCreate ? '카테고리 만들기' : '저장'}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

/** 장소 설정에서 단일 선택값을 표현하고 선택 이벤트를 전달하는 재사용 칩을 렌더링합니다. */
export function ChoiceChip({
  label,
  selected,
  color,
  textColor,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  color: string;
  textColor: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceChip,
        {
          borderColor: selected ? color : 'rgba(120,120,128,0.24)',
          backgroundColor: selected ? `${color}1F` : 'transparent',
          opacity: pressed || disabled ? 0.55 : 1,
        },
      ]}
    >
      <View style={[styles.colorDot, { backgroundColor: color }]} />
      <Text style={[styles.choiceChipText, { color: textColor }]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={15} color={color} /> : null}
    </Pressable>
  );
}
