import { type ScheduleCalendar } from '../../src/api/scheduleCalendars';
import {
  type ShareInbox,
  type ShareOutbox,
  type ShareResourceType,
} from '../../src/api/scheduleSharing';
import type {
  ScheduleItem,
  ScheduleShareContentMode,
  ScheduleSharePermission,
} from '../../src/modules/schedule/types';
import {
  type ShareLibraryFilter,
  type ShareLibraryItem,
  type ShareLibraryTab,
} from '../../src/modules/share/shareInboxPresentation';

export type ShareInboxViewData = {
  inbox: ShareInbox;
  outbox: ShareOutbox;
  schedules: ScheduleItem[];
  calendars: ScheduleCalendar[];
  seenKeys: string[];
  loadedAt: Date;
};

export const BRAND_BLUE = '#2F80FF';
export const ROUTE_AMBER = '#D78400';
export const DEPARTURE_GREEN = '#18A558';

export const DEFAULT_FILTER: ShareLibraryFilter = {
  query: '',
  relation: 'all',
  status: 'all',
  sort: 'upcoming',
};

export const GROUP_ORDER = ['오늘', '다가오는 일정', '지난 일정', '일정 정보'];

/** 외부 파라미터의 탭 값을 공유함에서 지원하는 안전한 탭 값으로 정규화합니다. */
export function normalizeTab(value?: string): ShareLibraryTab {
  if (value === 'calendar') return 'calendar';
  return 'schedule';
}

/** 알 수 없는 예외에서 사용자에게 표시할 수 있는 오류 문구를 추출합니다. */
export function getErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : '공유함을 불러오지 못했습니다.';
  if (/403|forbidden|status code/i.test(message)) {
    return '공유함을 불러올 권한을 확인할 수 없어요.';
  }
  if (/network|timeout/i.test(message)) {
    return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  return message;
}

/** 일정 공유 권한 코드를 화면에 노출할 한국어 라벨로 변환합니다. */
export function permissionLabel(permission: ScheduleSharePermission) {
  if (permission === 'OWNER') return '소유자';
  if (permission === 'EDITOR') return '편집';
  // COMMENTER는 현재 제품에 댓글 화면이 없으므로 보기 권한으로 안내한다.
  return '보기';
}

/** 캘린더 공유 범위 값을 간결한 한국어 설명으로 변환합니다. */
export function contentModeLabel(mode?: ScheduleShareContentMode) {
  return mode === 'SCHEDULE_AND_TRAVEL' ? '일정 + 각자 경로' : '일정만';
}

/** 공유 항목의 관계와 소유자 정보를 조합해 대표 소유자 이름을 반환합니다. */
export function ownerLabel(item: ShareLibraryItem) {
  return (
    item.ownerEmail?.trim() ||
    (Number.isSafeInteger(item.ownerMemberId)
      ? `회원 #${item.ownerMemberId}`
      : '알 수 없는 사용자')
  );
}

/** 차단·신고 API에 전달할 상대 사용자 식별자를 공유 관계에서 선택합니다. */
export function sharingSafetyOwnerId(item: ShareLibraryItem) {
  const ownerMemberId = item.ownerMemberId;
  if (
    !Number.isSafeInteger(ownerMemberId) ||
    !ownerMemberId ||
    ownerMemberId <= 0
  ) {
    return null;
  }
  return ownerMemberId;
}

/** 선택적 날짜 문자열을 유효한 Date로 바꾸고 잘못된 값은 undefined로 처리합니다. */
export function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 일정의 종일 여부와 기간을 반영해 날짜 구간을 읽기 쉽게 표시합니다. */
export function formatScheduleDate(item?: ScheduleItem) {
  const date = toDate(item?.startAt);
  if (!date) return '날짜 미정';
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getMonth() + 1}월 ${date.getDate()}일(${
    dayNames[date.getDay()]
  })`;
}

/** 일정의 시작·종료 시각과 종일 여부를 공유함용 시간 문구로 변환합니다. */
export function formatScheduleTimeRange(item?: ScheduleItem) {
  if (!item) return '시간 미정';
  if (item.allDay) return '종일';

  const start = toDate(item.startAt);
  if (!start) return '시간 미정';
  const startText = `${String(start.getHours()).padStart(2, '0')}:${String(
    start.getMinutes(),
  ).padStart(2, '0')}`;
  if (item.hasEndTime === false) return startText;

  const end = toDate(item.endAt);
  if (!end) return startText;
  const endText = `${String(end.getHours()).padStart(2, '0')}:${String(
    end.getMinutes(),
  ).padStart(2, '0')}`;
  return `${startText}-${endText}`;
}

/** 일정에 저장된 장소 후보 중 화면에 표시할 첫 번째 유효 장소명을 선택합니다. */
export function scheduleLocationLabel(item?: ScheduleItem) {
  if (!item) return '';
  if (item.origin?.name && item.destination?.name) {
    return `${item.origin.name} → ${item.destination.name}`;
  }
  return item.destination?.name || item.locationName || '';
}

/** 공유 항목 종류별 강조색을 선택하고 캘린더 색상이 없으면 대체색을 사용합니다. */
export function shareItemColor(item: ShareLibraryItem, fallback: string) {
  return item.schedule?.category?.color || item.color || fallback;
}

/** 선택적 날짜를 공유 목록에 적합한 짧은 월·일 형식으로 변환합니다. */
export function formatShortDate(value?: string | null) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/** 초대 만료 시각을 현재 시점 기준의 상대적인 안내 문구로 변환합니다. */
export function formatExpiration(value: string) {
  const date = toDate(value);
  if (!date) return '만료일 확인';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hour}:${minute}까지`;
}

/** 공유 리소스 타입을 일정·카테고리·캘린더 라벨로 변환합니다. */
export function resourceLabel(type: ShareResourceType) {
  if (type === 'SCHEDULE') return '일정';
  return type === 'CALENDAR' ? '공유 캘린더' : '캘린더';
}

/** 초대 작성기가 지원하는 리소스 타입으로 값을 제한합니다. */
export function resourceTypeForComposer(type: ShareResourceType) {
  if (type === 'SCHEDULE') return 'schedule' as const;
  if (type === 'CALENDAR') return 'calendar' as const;
  return 'category' as const;
}
