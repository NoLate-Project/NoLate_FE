import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import {
  Animated,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';

import { formatScheduleFormDate } from '../../scheduleFormDate';
import styles from './ScheduleAddModal.styles';
import { FORM_ACCENT, formDateText, hhmmText } from './scheduleAddModalModel';
import type { ScheduleAddModalController } from './useScheduleAddModalController';

type Props = {
  /** 상위 훅이 관리하는 날짜, 시간, 피커 애니메이션 상태와 변경 이벤트입니다. */
  controller: ScheduleAddModalController;
};

/**
 * 일정 추가 폼의 종일 여부, 시작·종료 일시, 달력·시간 피커를 렌더링합니다.
 *
 * 값의 정합성과 피커 전환 애니메이션은 상위 컨트롤러가 담당합니다. 이 컴포넌트는
 * 사용자 입력을 해당 이벤트로 전달하고 현재 선택 상태를 접근성 속성과 시각 강조에
 * 일관되게 반영합니다.
 */
export default function ScheduleAddDateTimeSection({ controller }: Props) {
  const {
    allDay,
    calendarSelected,
    calendarTheme,
    colors,
    contentFade,
    displayPicker,
    endDay,
    endTime,
    formPlaceholderColor,
    handleAllDayChange,
    handleEndTimeEnabledChange,
    hasEndTime,
    heightAnim,
    isDisplayDate,
    isDisplayTime,
    mode,
    onDayPress,
    onTimeChange,
    outerOpacity,
    picker,
    pressedFieldColor,
    selectedFieldColor,
    startDay,
    startTime,
    togglePicker,
  } = controller;

  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>일시</Text>
      <View
        testID="schedule-add-time-card"
        style={[
          styles.compactSectionCard,
          { borderColor: colors.border, backgroundColor: colors.surface2 },
        ]}
      >
        <View style={styles.compactToggleRow}>
          <Text style={[styles.compactRowTitle, { color: colors.textPrimary }]}>
            종일
          </Text>
          <Switch
            accessibilityLabel="종일 일정"
            value={allDay}
            onValueChange={handleAllDayChange}
            trackColor={{ false: colors.border, true: FORM_ACCENT }}
            thumbColor="#FFFFFF"
            hitSlop={{ top: 8, right: 6, bottom: 8, left: 6 }}
            style={styles.toggleSwitch}
          />
        </View>

        <View
          style={[styles.compactDivider, { backgroundColor: colors.border }]}
        />
        <View style={styles.compactDateTimeRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`시작 날짜 ${formatScheduleFormDate(startDay)}`}
            accessibilityState={{ expanded: picker === 'startDate' }}
            onPress={() => togglePicker('startDate')}
            style={({ pressed }) => [
              styles.compactDatePressable,
              {
                backgroundColor:
                  picker === 'startDate'
                    ? selectedFieldColor
                    : pressed
                    ? pressedFieldColor
                    : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                styles.compactRowTitle,
                {
                  color:
                    picker === 'startDate' ? FORM_ACCENT : colors.textPrimary,
                },
              ]}
            >
              시작
            </Text>
            <Text
              style={[styles.compactRowSub, { color: colors.textSecondary }]}
            >
              {formDateText(startDay)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              allDay
                ? `마지막 날 ${formatScheduleFormDate(endDay)}`
                : `시작 시간 ${hhmmText(startTime)}`
            }
            accessibilityState={{
              expanded: picker === (allDay ? 'endDate' : 'startTime'),
            }}
            onPress={() => togglePicker(allDay ? 'endDate' : 'startTime')}
            style={({ pressed }) => [
              styles.compactValuePressable,
              {
                backgroundColor:
                  picker === (allDay ? 'endDate' : 'startTime')
                    ? selectedFieldColor
                    : pressed
                    ? pressedFieldColor
                    : 'transparent',
              },
            ]}
          >
            {allDay ? (
              <Text
                style={[
                  styles.compactValueCaption,
                  { color: colors.textSecondary },
                ]}
              >
                마지막 날
              </Text>
            ) : null}
            <Text
              style={[
                styles.compactRowValue,
                {
                  color:
                    picker === (allDay ? 'endDate' : 'startTime')
                      ? FORM_ACCENT
                      : colors.textPrimary,
                },
              ]}
            >
              {allDay ? formatScheduleFormDate(endDay) : hhmmText(startTime)}
            </Text>
            <Ionicons
              accessible={false}
              name="chevron-forward"
              size={16}
              color={
                picker === (allDay ? 'endDate' : 'startTime')
                  ? FORM_ACCENT
                  : formPlaceholderColor
              }
            />
          </Pressable>
        </View>

        {!allDay ? (
          <>
            <View
              style={[
                styles.compactDivider,
                { backgroundColor: colors.border },
              ]}
            />
            <View style={styles.compactToggleRow}>
              <Text
                style={[styles.compactRowTitle, { color: colors.textPrimary }]}
              >
                종료
              </Text>
              <Switch
                accessibilityLabel="종료 시각 설정"
                value={hasEndTime}
                onValueChange={handleEndTimeEnabledChange}
                trackColor={{ false: colors.border, true: FORM_ACCENT }}
                thumbColor="#FFFFFF"
                hitSlop={{ top: 8, right: 6, bottom: 8, left: 6 }}
                style={styles.toggleSwitch}
              />
            </View>
          </>
        ) : null}

        {!allDay && hasEndTime ? (
          <>
            <View
              style={[
                styles.compactDivider,
                { backgroundColor: colors.border },
              ]}
            />
            <View style={styles.compactDateTimeRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`종료 날짜 ${formatScheduleFormDate(
                  endDay,
                )}`}
                accessibilityState={{ expanded: picker === 'endDate' }}
                onPress={() => togglePicker('endDate')}
                style={({ pressed }) => [
                  styles.compactDatePressable,
                  {
                    backgroundColor:
                      picker === 'endDate'
                        ? selectedFieldColor
                        : pressed
                        ? pressedFieldColor
                        : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.compactRowTitle,
                    {
                      color:
                        picker === 'endDate' ? FORM_ACCENT : colors.textPrimary,
                    },
                  ]}
                >
                  종료 일시
                </Text>
                <Text
                  style={[
                    styles.compactRowSub,
                    { color: colors.textSecondary },
                  ]}
                >
                  {formDateText(endDay)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`종료 시간 ${hhmmText(endTime)}`}
                accessibilityState={{ expanded: picker === 'endTime' }}
                onPress={() => togglePicker('endTime')}
                style={({ pressed }) => [
                  styles.compactValuePressable,
                  {
                    backgroundColor:
                      picker === 'endTime'
                        ? selectedFieldColor
                        : pressed
                        ? pressedFieldColor
                        : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.compactRowValue,
                    {
                      color:
                        picker === 'endTime' ? FORM_ACCENT : colors.textPrimary,
                    },
                  ]}
                >
                  {hhmmText(endTime)}
                </Text>
                <Ionicons
                  accessible={false}
                  name="chevron-forward"
                  size={16}
                  color={
                    picker === 'endTime' ? FORM_ACCENT : formPlaceholderColor
                  }
                />
              </Pressable>
            </View>
          </>
        ) : null}
      </View>

      <Animated.View
        style={[
          styles.pickerContainer,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface2,
            maxHeight: heightAnim,
            opacity: outerOpacity,
            marginBottom: outerOpacity.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 14],
            }),
          },
        ]}
      >
        <Animated.View style={{ opacity: contentFade }}>
          {isDisplayDate && (
            <Calendar
              key={mode}
              current={calendarSelected}
              onDayPress={onDayPress}
              markedDates={{
                [calendarSelected]: {
                  selected: true,
                  selectedColor: colors.selectedDayBg,
                  selectedTextColor: colors.selectedDayText,
                },
              }}
              theme={calendarTheme}
            />
          )}
          {isDisplayTime && (
            <DateTimePicker
              value={displayPicker === 'startTime' ? startTime : endTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={mode === 'dark' ? 'dark' : 'light'}
              is24Hour
              onChange={onTimeChange}
            />
          )}
        </Animated.View>
      </Animated.View>
    </>
  );
}
