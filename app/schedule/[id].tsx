import React from "react";
import { useLocalSearchParams } from "expo-router";

import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { ScheduleDetailEditorTransition } from "../../src/routeSupport/schedule/ScheduleDetailEditorTransition";
import { ScheduleDetailScreenContent } from "../../src/routeSupport/schedule/ScheduleDetailScreenContent";
import type { ScheduleDetailPreviewProps } from "../../src/routeSupport/schedule/scheduleDetailModel";
import { useScheduleDetailController } from "../../src/routeSupport/schedule/useScheduleDetailController";
import { useScreenFirstPaintPerformance } from "../../src/modules/performance/useScreenFirstPaintPerformance";
import ScreenFirstPaintShell from "../../src/modules/performance/ScreenFirstPaintShell";
import { useDeferredScreenContent } from "../../src/modules/performance/useDeferredScreenContent";
import { useScheduleStore } from "../../src/modules/schedule/store";

export default function ScheduleRoute() {
  useScreenFirstPaintPerformance('/schedule/[id]');
  const { id, mode, entrySource } = useLocalSearchParams<{
    id?: string;
    mode?: string;
    entrySource?: string;
  }>();
  const contentReady = useDeferredScreenContent();
  const { state } = useScheduleStore();
  // Let the native fade reveal real content when the selected item is already loaded.
  const hasSearchDetail = entrySource === 'calendar-search'
    && mode !== 'edit' && id != null && state.itemsById[id] != null;

  if (!contentReady && !hasSearchDetail) {
    return (
      <ScreenFirstPaintShell
        title={mode === 'edit' ? '일정 수정' : '일정 상세'}
        backAccessibilityLabel="이전 화면으로 돌아가기"
        testID="schedule-detail-first-paint-shell"
      />
    );
  }

  return (
    <ScheduleDetailEditorTransition
      key={id}
      editing={mode === 'edit'}
      detail={<ScheduleDetail />}
      editor={<ScheduleEditScreen />}
    />
  );
}

export function ScheduleDetail(props: ScheduleDetailPreviewProps = {}) {
  const controller = useScheduleDetailController(props);
  return <ScheduleDetailScreenContent controller={controller} />;
}
