import React from "react";

import ScheduleMemoSheet from "../../modules/schedule/components/detail/ScheduleMemoSheet";
import ShareInvitationSheet from "../../modules/schedule/components/share/ShareInvitationSheet";
import { formatCompactScheduleRange } from "./scheduleDetailModel";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";

type ScheduleDetailAuxiliarySheetsProps = {
  presentation: ScheduleDetailPresentation;
};

/** 메모와 일정 공유 보조 시트의 표시 조건 및 닫기 동작을 연결한다. */
export function ScheduleDetailAuxiliarySheets({
  presentation,
}: ScheduleDetailAuxiliarySheetsProps) {
  const {
    canEditSchedule,
    insets,
    isPlainSchedule,
    item,
    memoSheetVisible,
    notesText,
    openScheduleEditor,
    setMemoSheetVisible,
    setShareSheetVisible,
    shareSheetVisible,
  } = presentation;

  return (
    <>
      <ScheduleMemoSheet
        visible={!isPlainSchedule && memoSheetVisible && Boolean(notesText)}
        title={item.title}
        notes={notesText ?? ''}
        bottomInset={insets.bottom}
        onEdit={canEditSchedule ? openScheduleEditor : undefined}
        onClose={() => setMemoSheetVisible(false)}
      />

      <ShareInvitationSheet
        visible={shareSheetVisible}
        resourceType="schedule"
        resourceId={item.id}
        title={item.title}
        subtitle={formatCompactScheduleRange(
          item.startAt,
          item.endAt,
          item.hasEndTime !== false,
          item.allDay === true,
        )}
        onClose={() => setShareSheetVisible(false)}
      />

    </>
  );
}
