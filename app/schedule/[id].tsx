import React from "react";
import { useLocalSearchParams } from "expo-router";

import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { ScheduleDetailScreenContent } from "../../src/routeSupport/schedule/ScheduleDetailScreenContent";
import type { ScheduleDetailPreviewProps } from "../../src/routeSupport/schedule/scheduleDetailModel";
import { useScheduleDetailController } from "../../src/routeSupport/schedule/useScheduleDetailController";

export default function ScheduleRoute() {
  const { mode } = useLocalSearchParams<{ id?: string; mode?: string }>();

  if (mode === 'edit') {
    return <ScheduleEditScreen />;
  }
  return <ScheduleDetail />;
}

export function ScheduleDetail(props: ScheduleDetailPreviewProps = {}) {
  const controller = useScheduleDetailController(props);
  return <ScheduleDetailScreenContent controller={controller} />;
}
