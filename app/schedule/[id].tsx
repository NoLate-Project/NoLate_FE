import React from "react";
import { useLocalSearchParams } from "expo-router";

import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { ScheduleDetailScreenContent } from "../../src/routeSupport/schedule/ScheduleDetailScreenContent";
import type { ScheduleDetailPreviewProps } from "../../src/routeSupport/schedule/scheduleDetailModel";
import { useScheduleDetailController } from "../../src/routeSupport/schedule/useScheduleDetailController";
import { useScreenFirstPaintPerformance } from "../../src/modules/performance/useScreenFirstPaintPerformance";
import ScreenFirstPaintShell from "../../src/modules/performance/ScreenFirstPaintShell";
import { useDeferredScreenContent } from "../../src/modules/performance/useDeferredScreenContent";

export default function ScheduleRoute() {
  useScreenFirstPaintPerformance('/schedule/[id]');
  const { mode } = useLocalSearchParams<{ id?: string; mode?: string }>();
  const contentReady = useDeferredScreenContent();

  if (!contentReady) {
    return (
      <ScreenFirstPaintShell
        title={mode === 'edit' ? '일정 수정' : '일정 상세'}
        backAccessibilityLabel="이전 화면으로 돌아가기"
        testID="schedule-detail-first-paint-shell"
      />
    );
  }

  if (mode === 'edit') {
    return <ScheduleEditScreen />;
  }
  return <ScheduleDetail />;
}

export function ScheduleDetail(props: ScheduleDetailPreviewProps = {}) {
  const controller = useScheduleDetailController(props);
  return <ScheduleDetailScreenContent controller={controller} />;
}
