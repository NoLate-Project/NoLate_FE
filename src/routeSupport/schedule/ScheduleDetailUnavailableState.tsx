import React from "react";
import { Pressable, Text, View } from "react-native";

import { BrandedLoadingState } from "../../ui/BrandedLoader";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import type { ScheduleDetailController } from "./useScheduleDetailController";

type ScheduleDetailUnavailableStateProps = {
  controller: ScheduleDetailController;
};

/** 일정이 아직 준비되지 않았을 때 로딩 또는 오류·재시도 화면을 선택해 표시한다. */
export function ScheduleDetailUnavailableState({
  controller,
}: ScheduleDetailUnavailableStateProps) {
  const { colors, goBack, insets, item, loadError, loading, setRetryKey } =
    controller;
  if (!item) {
    if (loading) {
      return (
        <View
          style={[styles.loadingScreen, { backgroundColor: colors.background }]}
        >
          <BrandedLoadingState
            fill
            size="full"
            variant="schedule"
            accessibilityLabel="일정을 불러오고 있어요"
            title="일정을 불러오고 있어요"
            caption="일정과 이동 정보를 확인하고 있어요"
          />
        </View>
      );
    }

    return (
      <View
        style={[
          styles.missingScreen,
          { backgroundColor: colors.background, paddingTop: insets.top + 16 },
        ]}
      >
        <Ionicons
          name="calendar-outline"
          size={36}
          color={colors.textSecondary}
        />
        <Text style={[styles.missingTitle, { color: colors.textPrimary }]}>
          일정을 불러오지 못했어요
        </Text>
        <Text style={[styles.missingCaption, { color: colors.textSecondary }]}>
          {loadError ?? '삭제되었거나 접근할 수 없는 일정이에요.'}
        </Text>
        <View style={styles.missingActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 화면으로 돌아가기"
            onPress={goBack}
            style={[
              styles.missingSecondaryButton,
              { borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>
              돌아가기
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="일정 다시 불러오기"
            onPress={() => setRetryKey(value => value + 1)}
            style={styles.missingRetryButton}
          >
            <Ionicons name="refresh" size={17} color="#FFFFFF" />
            <Text style={styles.missingRetryText}>다시 시도</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return null;
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
