import React from "react";

import { useScreenContentReadyPerformance } from "../../modules/performance/useScreenContentReadyPerformance";
import { ScheduleDetailLayout } from "./ScheduleDetailLayout";
import { ScheduleDetailUnavailableState } from "./ScheduleDetailUnavailableState";
import {
  buildScheduleDetailPresentation,
} from "./scheduleDetailPresentationModel";
import type { ScheduleDetailController } from "./useScheduleDetailController";

type ScheduleDetailScreenContentProps = {
  controller: ScheduleDetailController;
};

/**
 * 일정 상세 컨트롤러의 상태를 로딩·오류 화면 또는 계산이 끝난 상세 레이아웃으로 분기한다.
 * 정상 화면에 필요한 파생값은 별도 프레젠테이션 모델에서 계산해 라우트 조립 책임을 최소화한다.
 */
export function ScheduleDetailScreenContent({
  controller,
}: ScheduleDetailScreenContentProps) {
  const presentation = buildScheduleDetailPresentation(controller);
  useScreenContentReadyPerformance(
    "schedule.detail_content_ready",
    "/schedule/[id]",
    Boolean(presentation),
  );
  if (!presentation) {
    return <ScheduleDetailUnavailableState controller={controller} />;
  }

  return <ScheduleDetailLayout presentation={presentation} />;
}
