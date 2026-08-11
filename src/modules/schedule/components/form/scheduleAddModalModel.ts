import React from 'react';

import { ADD_HANDOFF_MOTION } from '../../addHandoffMotion';
import { formatScheduleFormDate } from '../../scheduleFormDate';
import type {
  Place,
  ScheduleCategory,
  ScheduleItem,
  ScheduleParseResult,
} from '../../types';

export type Props = {
  visible: boolean;
  prewarm?: boolean;
  onClose: () => void;
  onSubmit: (payload: Omit<ScheduleItem, 'id'>) => void | Promise<void>;
  categories: ScheduleCategory[];
  defaultDay: string;
  initialValues?: ScheduleParseResult | null;
  categoryError?: string | null;
  categoryLoading?: boolean;
  onRetryCategories?: () => void;
  onManageCategories?: () => void;
  onCloseStart?: () => void;
  presentation?: 'sheet' | 'morph';
  sourceTopOffset?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceRightOffset?: number;
  closeTargetWidth?: number;
  onMorphReady?: () => void;
  morphPresenterRef?: React.MutableRefObject<ScheduleAddMorphPresenter | null>;
};

export type ScheduleAddMorphPresenter = () => boolean;

export type CloseSheetOptions = {
  notifyCloseStart?: boolean;
};

export const PREWARM_PRESENTATION_OPACITY = 0.001;

/** 숫자를 두 자리 문자열로 채워 날짜·시간 포맷 함수에서 일관되게 사용합니다. */
export const pad2 = (n: number) => String(n).padStart(2, '0');

// 기준 날짜 객체의 연월일을 입력 문자열로 교체한다.
/** 기존 Date의 시각 정보는 유지하면서 YYYY-MM-DD 문자열의 연·월·일만 적용합니다. */
export function setYmd(base: Date, ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(base);
  next.setFullYear(y, m - 1, d);
  return next;
}

// 날짜 객체와 시간 객체를 하나의 일정 시각으로 합친다.
/** 날짜 값의 연·월·일과 시간 값의 시·분을 결합한 새로운 Date를 반환합니다. */
export function mergeDateTime(datePart: Date, timePart: Date) {
  const d = new Date(datePart);
  d.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
  return d;
}

/** Date의 로컬 시각을 24시간제 HH:mm 문자열로 변환합니다. */
export function hhmmText(d: Date) {
  const hour = d.getHours();
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${pad2(
    d.getMinutes(),
  )}`;
}

/** 폼의 날짜를 오늘·내일 또는 월·일 형식의 짧은 사용자 문구로 변환합니다. */
export function formDateText(d: Date) {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${formatScheduleFormDate(d)} (${weekdays[d.getDay()]})`;
}

export const SHEET_HIDDEN_Y = 900;
export const SHEET_CLOSE_DISTANCE = 118;
export const SHEET_CLOSE_VELOCITY = 0.85;
export const SHEET_VELOCITY_PROJECTION = 120;
export const MORPH_OPEN_START_PROGRESS = 0;
export const MORPH_OPEN_DURATION_MS = ADD_HANDOFF_MOTION.manualOpenMs;
export const MORPH_SOURCE_WIDTH = 238;
export const MORPH_SOURCE_HEIGHT = 164;
export const MORPH_CLOSE_TARGET_WIDTH = 150;
export const MORPH_CLOSE_TARGET_HEIGHT = 44;
export const MORPH_TARGET_FALLBACK_HEIGHT = 580;
export const SHEET_TARGET_HEIGHT_RATIO = 0.7;
export const SHEET_TARGET_MAX_HEIGHT = 600;
export const FORM_ACCENT = '#246BFE';
export const DATE_H = 312;
export const TIME_H = 216;
export const CATEGORY_PICKER_MARGIN = 12;

export type PickerType = 'startDate' | 'endDate' | 'startTime' | 'endTime';

/** 피커 식별자가 날짜 선택 종류인지 타입 가드 형태로 판별합니다. */
export const isDateType = (t: PickerType | null): boolean =>
  t === 'startDate' || t === 'endDate';

/** 피커 종류에 맞는 펼침 높이를 반환해 전환 애니메이션 목표값으로 사용합니다. */
export const pickerTargetH = (t: PickerType | null): number =>
  t !== null && isDateType(t) ? DATE_H : TIME_H;

/** 시트의 수직 위치를 열린 위치와 숨김 위치 사이로 제한합니다. */
export const clampSheetY = (value: number) =>
  Math.min(Math.max(value, 0), SHEET_HIDDEN_Y);

/** 장소 객체에 길찾기에 사용할 수 있는 유한한 위도·경도가 모두 있는지 검사합니다. */
export const hasPlaceCoords = (place: Place | null | undefined) =>
  typeof place?.lat === 'number' &&
  Number.isFinite(place.lat) &&
  typeof place.lng === 'number' &&
  Number.isFinite(place.lng);

/** 선택 문자열의 공백을 제거하고 빈 값은 undefined로 정규화합니다. */
export function cleanOptionalText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/** 장소의 이름과 주소 중 화면에 표시할 우선값을 선택해 반환합니다. */
export function getDisplayPlaceText(place?: Place | null) {
  return (
    cleanOptionalText(place?.name) ?? cleanOptionalText(place?.address) ?? ''
  );
}

/** 문자열 목록의 빈 값과 중복을 제거하면서 원래 순서를 유지합니다. */
export function uniqueNonBlank(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

// 새 일정을 입력하고 저장하는 바텀시트 화면을 렌더링한다.
