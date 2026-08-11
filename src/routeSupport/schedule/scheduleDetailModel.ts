import type { RouteAlternativeOption } from "../../modules/map/tmapApi";
import type {
  ScheduleItem,
  ScheduleTravelPlanParticipant,
  TravelMode,
} from "../../modules/schedule/types";
import { fromISO } from "../../../lib/util/data";
import {
  MINUTE_MS,
  SECOND_MS,
  hhmmText,
  pad2,
  ymdText,
} from "./ScheduleDetailChrome";

/** 초 단위 출발 카운트다운을 분 단위의 간결한 남은 시간 문구로 변환한다. */
export function getDepartureRemainingLabel(
  state: DepartureDisplayState,
): string | undefined {
  if (state.kind !== 'countdown') return undefined;

  const remainingMinutes = Math.max(
    1,
    state.hours * 60 + state.minutes + (state.seconds > 0 ? 1 : 0),
  );
  if (remainingMinutes < 60) return `${remainingMinutes}분 남음`;

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes > 0 ? `${hours}시간 ${minutes}분 남음` : `${hours}시간 남음`;
}
export type SheetSnapMode = 'compact' | 'expanded';

export type ScheduleDetailPreviewProps = {
  /** Internal QA only. Production routes always resolve the item from the schedule store. */
  previewItem?: ScheduleItem;
  initialSheetMode?: SheetSnapMode;
  initialParticipantsExpanded?: boolean;
  previewNowMs?: number;
  previewCurrentMemberId?: number;
  onPreviewOpenEditor?: () => void;
};

export type DepartureDisplayState =
  | { kind: 'countdown'; hours: number; minutes: number; seconds: number }
  | {
      kind: 'status';
      text: string;
      tone: 'default' | 'completed' | 'disabled';
    };

/** 알 수 없는 오류 값을 사용자에게 표시 가능한 기본 메시지로 안전하게 정규화한다. */
export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '요청 처리에 실패했습니다.';

/** 중첩 좌표를 포함한 외부 응답에서 유효한 위도·경도를 찾아 지도 좌표 형태로 변환한다. */
export function mapCoordFromUnknown(
  value: unknown,
): { latitude: number; longitude: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const point = value as {
    lat?: unknown;
    lng?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    coord?: unknown;
  };
  if (point.coord) return mapCoordFromUnknown(point.coord);
  const lat = point.lat ?? point.latitude;
  const lng = point.lng ?? point.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  return { latitude: lat, longitude: lng };
}

/** 일정의 종일 여부와 종료 시각 유무, 날짜 경계를 고려해 카드용 짧은 기간 문구를 만든다. */
export function formatCompactScheduleRange(
  startAt: string,
  endAt: string,
  hasEndTime = true,
  allDay = false,
) {
  const start = fromISO(startAt);
  const shortDate = `${pad2(start.getMonth() + 1)}.${pad2(start.getDate())}`;
  if (allDay) return `${shortDate} · 종일`;
  if (!hasEndTime) return `${shortDate} · ${hhmmText(start)}`;
  const end = fromISO(endAt);
  const sameDay = ymdText(start) === ymdText(end);
  return sameDay
    ? `${shortDate} · ${hhmmText(start)}-${hhmmText(end)}`
    : `${shortDate} ${hhmmText(start)}-${pad2(end.getMonth() + 1)}.${pad2(
        end.getDate(),
      )} ${hhmmText(end)}`;
}

/** 저장된 이동수단 코드를 일정 상세에서 사용하는 한국어 표시명으로 변환한다. */
export function travelModeLabel(mode?: TravelMode) {
  switch (mode) {
    case 'CAR':
      return '자동차';
    case 'TRANSIT':
      return '대중교통';
    case 'WALK':
      return '도보';
    case 'BIKE':
      return '자전거';
    default:
      return '이동';
  }
}

/** 참여자 이메일·역할·회원 번호 우선순위로 안정적인 화면 표시명을 만든다. */
export function travelPlanParticipantLabel(
  participant: ScheduleTravelPlanParticipant,
): string {
  const emailName = participant.email?.split('@')[0]?.trim();
  if (emailName) return emailName;
  if (participant.role === 'OWNER') return '오너';
  return `참여자 ${participant.memberId}`;
}

/** 선택 경로 또는 저장된 이동 시간에서 대표 소요시간 문구를 만들고 정보가 없으면 기본 라벨을 사용한다. */
export function routeNumberText(
  route: RouteAlternativeOption | undefined,
  fallbackMinutes?: number,
) {
  const minutes = route?.minutes ?? fallbackMinutes;
  return typeof minutes === 'number' ? `${minutes}분` : '경로';
}

/** 명시된 출발 시각을 우선하고 없으면 일정 시작 시각에서 이동 시간을 빼 권장 출발 시각을 계산한다. */
export function getRecommendedDepartureAt(item: ScheduleItem): Date | undefined {
  if (item.departAt) {
    return fromISO(item.departAt);
  }

  if (typeof item.travelMinutes !== 'number') {
    return undefined;
  }

  const startAt = fromISO(item.startAt);
  return new Date(startAt.getTime() - item.travelMinutes * MINUTE_MS);
}

/** 출발 완료, 카운트다운, 알림 대기, 기한 경과 상태를 현재 시각에 맞는 단일 표시 모델로 결정한다. */
export function getDepartureDisplayState(
  departureAt: Date | undefined,
  item: ScheduleItem,
  nowMs: number,
  currentMemberDepartedAt?: string,
): DepartureDisplayState {
  if (currentMemberDepartedAt) {
    return {
      kind: 'status',
      text: `${hhmmText(fromISO(currentMemberDepartedAt))}에 출발 완료됨`,
      tone: 'completed',
    };
  }

  if (!departureAt) {
    return {
      kind: 'status',
      text: item.notificationEnabled ? '출발 알림 대기 중' : '출발 알림 꺼짐',
      tone: item.notificationEnabled ? 'default' : 'disabled',
    };
  }

  const diffSeconds = Math.ceil((departureAt.getTime() - nowMs) / SECOND_MS);

  if (diffSeconds > 0) {
    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;

    return { kind: 'countdown', hours, minutes, seconds };
  }

  return {
    kind: 'status',
    text: '출발해야 할 시간이 지났어요',
    tone: 'disabled',
  };
}
