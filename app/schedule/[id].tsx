import React from "react";
import { useLocalSearchParams } from "expo-router";

import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { ScheduleDetailScreenContent } from "./ScheduleDetailScreenContent";
import type { ScheduleDetailPreviewProps } from "./scheduleDetailModel";
import { useScheduleDetailController } from "./useScheduleDetailController";

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
