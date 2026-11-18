import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useWindowDimensions } from "react-native";

import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { ScheduleDetailEditorTransition, type ScheduleDetailEditResult } from "../../src/routeSupport/schedule/ScheduleDetailEditorTransition";
import { ScheduleDetailScreenContent } from "../../src/routeSupport/schedule/ScheduleDetailScreenContent";
import type { ScheduleDetailPreviewProps } from "../../src/routeSupport/schedule/scheduleDetailModel";
import { useScheduleDetailController } from "../../src/routeSupport/schedule/useScheduleDetailController";
import { useScreenFirstPaintPerformance } from "../../src/modules/performance/useScreenFirstPaintPerformance";
import ScreenFirstPaintShell from "../../src/modules/performance/ScreenFirstPaintShell";
import { useDeferredScreenContent } from "../../src/modules/performance/useDeferredScreenContent";
import { useScheduleStore } from "../../src/modules/schedule/store";
import InboxDestinationTransition from "../../src/routeSupport/share/InboxDestinationTransition";

export default function ScheduleRoute() {
  useScreenFirstPaintPerformance('/schedule/[id]');
  const { id, mode, entrySource, notificationInboxKey } = useLocalSearchParams<{
    id?: string;
    mode?: string;
    entrySource?: string;
    notificationInboxKey?: string;
  }>();
  const contentReady = useDeferredScreenContent();
  const { fontScale } = useWindowDimensions();
  const { state } = useScheduleStore();
  const [editResult, setEditResult] = useState<ScheduleDetailEditResult | null>(null);
  // Show real content on the first frame when the selected item is already loaded.
  const hasListDetail = (entrySource === 'calendar-search' || entrySource === 'share-inbox' || entrySource === 'notification-inbox')
    && mode !== 'edit' && id != null && state.itemsById[id] != null;

  const content = !contentReady && !hasListDetail ? (
    <ScreenFirstPaintShell
      title={mode === 'edit' ? '일정 수정' : '일정 상세'}
      backAccessibilityLabel="이전 화면으로 돌아가기"
      testID="schedule-detail-first-paint-shell"
    />
  ) : (
    <ScheduleDetailEditorTransition
      key={id}
      editing={mode === 'edit'}
      editResult={editResult?.updated.id === id ? editResult : null}
      detail={<ScheduleDetail />}
      editor={<ScheduleEditScreen onSaved={(previous, updated) => setEditResult({ previous, updated })} />}
    />
  );
  return fontScale <= 1.35 && (entrySource === 'share-inbox' || entrySource === 'notification-inbox') ? (
    <InboxDestinationTransition source={entrySource === 'share-inbox' ? 'share' : 'notification'}
      editing={mode === 'edit'} notificationInboxKey={notificationInboxKey}>
      {content}
    </InboxDestinationTransition>
  ) : content;
}

export function ScheduleDetail(props: ScheduleDetailPreviewProps = {}) {
  const controller = useScheduleDetailController(props);
  return <ScheduleDetailScreenContent controller={controller} />;
}
