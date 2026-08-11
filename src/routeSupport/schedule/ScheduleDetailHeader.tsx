import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import CalendarGlassSurface from "../../modules/schedule/components/calendar/CalendarGlassSurface";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";

type ScheduleDetailHeaderProps = {
  presentation: ScheduleDetailPresentation;
};

/** 일정 제목, 공유·수정 동작과 현재 경로 요약을 상단 유리 헤더에 표시한다. */
export function ScheduleDetailHeader({
  presentation,
}: ScheduleDetailHeaderProps) {
  const {
    canEditSchedule,
    canManageSchedule,
    colors,
    goBack,
    hasDetailedRoute,
    hasRouteSummary,
    insets,
    internalPreviewItem,
    isDark,
    isPlainSchedule,
    item,
    openScheduleEditor,
    plainHeaderHeight,
    primaryText,
    routeTitle,
    setShareSheetVisible,
    sheetBorder,
    showTopRouteBar,
    topCardAccentText,
    topCardControlBg,
    travelText,
  } = presentation;

  return (
      <View style={styles.topOverlay}>
        <CalendarGlassSurface
          variant="sheet"
          tone="flat"
          style={[
            styles.topHeaderGlass,
            isPlainSchedule && styles.plainPageHeader,
            {
              paddingTop: insets.top + 6,
              borderBottomColor: sheetBorder,
              ...(isPlainSchedule ? { height: plainHeaderHeight } : null),
            },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              styles.panelOpaqueBackdrop,
              isPlainSchedule
                ? { backgroundColor: colors.background }
                : isDark
                ? styles.panelOpaqueBackdropDark
                : styles.panelOpaqueBackdropLight,
            ]}
          />
          <View style={styles.topHeaderRow}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="이전 화면으로 돌아가기"
              style={({ pressed }) => [
                styles.topHeaderIconButton,
                {
                  backgroundColor: pressed ? topCardControlBg : 'transparent',
                  opacity: pressed ? 0.58 : 1,
                },
              ]}
            >
              <Ionicons name="chevron-back" size={21} color={primaryText} />
            </Pressable>

            <View
              style={[
                styles.topHeaderContent,
                isPlainSchedule && styles.plainTopHeaderContent,
              ]}
            >
              <View
                style={[
                  styles.topHeaderTitleRow,
                  isPlainSchedule && styles.plainTopHeaderTitleRow,
                ]}
              >
                {!isPlainSchedule ? (
                  <View style={styles.topHeaderKindBadge}>
                    <Ionicons
                      name="calendar-clear-outline"
                      size={13}
                      color={topCardAccentText}
                    />
                    <Text
                      style={[
                        styles.topHeaderKindText,
                        { color: topCardAccentText },
                      ]}
                    >
                      일정
                    </Text>
                  </View>
                ) : null}
                <Text
                  style={[
                    styles.topHeaderTitle,
                    isPlainSchedule && styles.plainTopHeaderTitle,
                    { color: primaryText },
                  ]}
                  numberOfLines={1}
                >
                  {isPlainSchedule ? '일정 상세' : item.title}
                </Text>
              </View>
            </View>

            {(canManageSchedule || canEditSchedule) && (
              <View
                style={[
                  styles.topHeaderActions,
                  isPlainSchedule && styles.plainTopHeaderActions,
                ]}
              >
                {canManageSchedule ? (
                  <Pressable
                    onPress={() => {
                      if (!internalPreviewItem) setShareSheetVisible(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="일정 공유"
                    style={({ pressed }) => [
                      styles.topHeaderIconButton,
                      {
                        backgroundColor: pressed
                          ? topCardControlBg
                          : 'transparent',
                        opacity: pressed ? 0.58 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name="share-social-outline"
                      size={20}
                      color={primaryText}
                    />
                  </Pressable>
                ) : null}
                {canEditSchedule ? (
                  <Pressable
                    onPress={openScheduleEditor}
                    accessibilityRole="button"
                    accessibilityLabel="일정 수정"
                    style={({ pressed }) => [
                      styles.topHeaderIconButton,
                      {
                        backgroundColor: pressed
                          ? isPlainSchedule
                            ? isDark
                              ? 'rgba(75,157,255,0.14)'
                              : 'rgba(41,121,255,0.08)'
                            : topCardControlBg
                          : 'transparent',
                        opacity: pressed ? 0.58 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        isPlainSchedule ? 'pencil-outline' : 'create-outline'
                      }
                      size={isPlainSchedule ? 19 : 20}
                      color={isPlainSchedule ? topCardAccentText : primaryText}
                    />
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          {showTopRouteBar ? (
            <View
              style={[
                styles.topHeaderRouteBar,
                { borderTopColor: sheetBorder },
              ]}
            >
              <View style={styles.topHeaderRouteBarMain}>
                <Ionicons
                  name={
                    hasDetailedRoute ? 'navigate-outline' : 'location-outline'
                  }
                  size={13}
                  color={topCardAccentText}
                />
                <Text
                  style={[styles.topHeaderRouteBarText, { color: primaryText }]}
                  numberOfLines={1}
                >
                  {routeTitle}
                </Text>
              </View>
              {hasRouteSummary ? (
                <View style={styles.topHeaderTravelPill}>
                  <Text
                    style={[
                      styles.topHeaderTravelText,
                      { color: topCardAccentText },
                    ]}
                    numberOfLines={1}
                  >
                    {travelText}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </CalendarGlassSurface>
      </View>

  );
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
