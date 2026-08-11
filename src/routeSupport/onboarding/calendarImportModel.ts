import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import {
  importCalendarSchedule,
  type SchedulePayload,
} from '../../api/schedule';
import { type RoutePathCoord } from '../../modules/map/routingService';
import { getCalendarImportSourceKey } from '../../modules/onboarding/calendarImportCategory';
import { extractCalendarRouteHints } from '../../modules/onboarding/calendarImportRouteEnrichment';
import {
  type CalendarProviderScanFailure,
  type CalendarScanProgress,
} from '../../modules/onboarding/calendarImportScan';
import {
  buildCalendarImportSource,
  type DeviceCalendarCandidate,
} from '../../modules/onboarding/deviceCalendarImport';
import type { Place, TravelMode } from '../../modules/schedule/types';

export type OnboardingStep =
  | 'intro'
  | 'provider'
  | 'permission'
  | 'scanning'
  | 'select'
  | 'enrich'
  | 'complete';

export const STEP_MOTION_DURATION_MS = 260;
export const FOOTER_MOTION_DURATION_MS = 220;

export type CalendarProviderId = 'device' | 'google';
export type CalendarConsentId =
  | 'device_access'
  | 'google_access'
  | 'candidate_review'
  | 'selected_schedule_storage';

export type CalendarProviderOption = {
  id: CalendarProviderId;
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  available: boolean;
  badge?: string;
};

export type CandidateSourceGroup = {
  key: string;
  title: string;
  color?: string;
  totalCount: number;
  selectedCount: number;
};

export type CalendarConsentItem = {
  id: CalendarConsentId;
  title: string;
  summary: string;
  detail: string[];
  required: boolean;
};

export const TRAVEL_MODES: Array<{
  value: TravelMode;
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
}> = [
  { value: 'TRANSIT', label: '대중교통', icon: 'train-outline' },
  { value: 'CAR', label: '자동차', icon: 'car-outline' },
  { value: 'WALK', label: '도보', icon: 'walk-outline' },
];

export const TRAVEL_MINUTES = [15, 30, 45, 60];

export const SCAN_MESSAGES = [
  '캘린더 연결 확인',
  '다가오는 일정 찾기',
  '가져올 일정 정리',
];

export const GOOGLE_AUTH_TIMEOUT_MS = 120_000;
export const GOOGLE_TOKEN_EXCHANGE_TIMEOUT_MS = 20_000;
export const SECURE_STORAGE_TIMEOUT_MS = 8_000;
export const PLACE_SEARCH_TIMEOUT_MS = 15_000;
export const ROUTE_SEARCH_TIMEOUT_MS = 25_000;
export const IMPORT_BATCH_SIZE = 3;
export const CANDIDATE_PAGE_SIZE = 20;
export const CURATION_PROGRESS_SEGMENT_COUNT = 6;

export const CURATION_APP_LOGO = require('../../../assets/curation/nolate-logo.png');
export const BRAND_BLUE = '#246BFE';

/** 외부 캘린더 후보와 사용자 선택값을 앱에서 저장 가능한 일정 생성 입력으로 변환합니다. */
export async function createImportedSchedule(
  candidate: DeviceCalendarCandidate,
  payload: SchedulePayload,
): Promise<{
  item: Awaited<ReturnType<typeof importCalendarSchedule>>['item'];
  created: boolean;
  notificationEnabled: boolean;
}> {
  const source = buildCalendarImportSource(candidate);
  try {
    const result = await importCalendarSchedule(payload, source);
    return {
      ...result,
      notificationEnabled:
        result.created && payload.notificationEnabled === true,
    };
  } catch (error) {
    if (
      payload.notificationEnabled !== true ||
      !isNotificationConfigurationError(error)
    ) {
      throw error;
    }

    // 구독 잔여량이 다른 기기에서 먼저 소비됐거나 서버 정책이 바뀐 경우에도
    // 일정 자체는 잃지 않도록 같은 payload를 알림만 끈 상태로 한 번 저장한다.
    const result = await importCalendarSchedule(
      {
        ...payload,
        notificationEnabled: false,
        notificationLeadMinutes: undefined,
        notificationIntervalMinutes: undefined,
      },
      source,
    );
    return { ...result, notificationEnabled: false };
  }
}

/** 가져오기 실패가 알림 설정 제약에서 발생했는지 안전하게 판별해 별도 안내 여부를 반환합니다. */
export function isNotificationConfigurationError(error: unknown): boolean {
  const message = getErrorMessage(error, '');
  return /(실시간 출발 알림|출발 알림|알림 일정|요금제|subscription)/i.test(
    message,
  );
}

/** 장소 검색어의 공백과 대소문자를 정규화해 동일 검색을 재사용할 안정적인 캐시 키를 만듭니다. */
export function buildPlaceSearchCacheKey(
  query: string,
  center?: RoutePathCoord,
): string {
  return [
    query.trim().toLocaleLowerCase(),
    center ? center.lat.toFixed(4) : '',
    center ? center.lng.toFixed(4) : '',
  ].join(':');
}

/** 두 장소의 이름·주소·좌표를 비교해 가져오기 과정에서 동일한 위치인지 판별합니다. */
export function isSamePlace(a: Place, b: Place): boolean {
  if (
    typeof a.lat === 'number' &&
    typeof a.lng === 'number' &&
    typeof b.lat === 'number' &&
    typeof b.lng === 'number'
  ) {
    return (
      Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001
    );
  }
  return (
    `${a.name ?? ''}:${a.address ?? ''}`.trim().toLocaleLowerCase() ===
    `${b.name ?? ''}:${b.address ?? ''}`.trim().toLocaleLowerCase()
  );
}

/** 캘린더 후보에 경로 계산에 필요한 출발지·도착지·시간 정보가 갖춰졌는지 검사합니다. */
export function isCalendarRouteCandidate(
  candidate: DeviceCalendarCandidate,
): boolean {
  const startAt = new Date(candidate.startAt);
  return (
    !candidate.allDay &&
    Number.isFinite(startAt.getTime()) &&
    startAt.getTime() > Date.now() &&
    Boolean(extractCalendarRouteHints(candidate).destinationQuery)
  );
}

/** 현재 온보딩 단계 식별자를 애니메이션에서 사용할 연속 인덱스로 변환합니다. */
export function motionStepIndex(step: OnboardingStep): number {
  switch (step) {
    case 'intro':
      return 0;
    case 'provider':
      return 1;
    case 'permission':
      return 2;
    case 'scanning':
      return 3;
    case 'select':
      return 4;
    case 'enrich':
      return 5;
    case 'complete':
      return 6;
  }
}

/** 캘린더 후보의 시작·종료 시각과 종일 여부를 한국어 일정 요약 문자열로 변환합니다. */
export function formatCandidateDate(
  candidate: DeviceCalendarCandidate,
): string {
  if (candidate.allDay) return '종일';

  const date = new Date(candidate.startAt);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}월 ${day}일 ${hour}:${minute}`;
}

/** 알 수 없는 예외 값을 사용자에게 표시 가능한 안전한 오류 메시지로 정규화합니다. */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 스캔 상태와 처리량을 진행 문구·비율·완료 여부로 변환해 화면 표현을 단순화합니다. */
export function getScanProgressPresentation(
  progress: CalendarScanProgress,
  deviceProviderLabel: string,
): { stage: 0 | 1; message: string } {
  switch (progress) {
    case 'device-permission':
      return {
        stage: 0,
        message: `${deviceProviderLabel} 접근 권한을 확인하고 있어요`,
      };
    case 'device-events':
      return {
        stage: 1,
        message: `${deviceProviderLabel}의 다가오는 일정을 확인하고 있어요`,
      };
    case 'google-auth':
      return { stage: 0, message: 'Google 계정 연결을 기다리고 있어요' };
    case 'google-events':
      return {
        stage: 1,
        message: 'Google Calendar의 다가오는 일정을 확인하고 있어요',
      };
  }
}

/** 제공자별 스캔 실패 목록을 중복 없이 합쳐 사용자가 이해할 수 있는 안내 문장으로 만듭니다. */
export function formatCalendarScanFailures(
  failures: CalendarProviderScanFailure[],
): string {
  return failures
    .map(failure => `${failure.providerLabel}: ${failure.message}`)
    .join('\n');
}

/** 기기 권한과 제공자 지원 상태를 선택 UI에서 사용할 옵션 목록으로 변환합니다. */
export function buildCalendarProviderOptions(
  deviceProviderLabel: string,
): CalendarProviderOption[] {
  const deviceDescription =
    Platform.OS === 'ios'
      ? '이 iPhone의 캘린더 일정'
      : '이 Android 기기의 캘린더 일정';

  return [
    {
      id: 'device',
      title: deviceProviderLabel,
      description: deviceDescription,
      icon: Platform.OS === 'ios' ? 'logo-apple' : 'phone-portrait-outline',
      available: true,
    },
    {
      id: 'google',
      title: 'Google Calendar',
      description: 'Google 계정에 저장된 일정',
      icon: 'logo-google',
      available: true,
    },
  ];
}

/** 지원 기능과 사용자 선택에 맞춰 필요한 동의 항목과 필수 여부를 구성합니다. */
export function buildCalendarConsentItems(
  selectedProviderIds: Set<CalendarProviderId>,
  deviceProviderLabel: string,
): CalendarConsentItem[] {
  const items: CalendarConsentItem[] = [];

  if (selectedProviderIds.has('device')) {
    items.push({
      id: 'device_access',
      title: `${deviceProviderLabel} 접근`,
      summary: '캘린더 목록과 다가오는 일정 정보를 읽어요.',
      required: true,
      detail: [
        '캘린더 이름, 일정 제목, 시작/종료 시간, 장소, 메모, 종일 여부를 가져올 일정 목록에 보여줍니다.',
        '선택한 일정의 장소와 메모는 이동 경로를 찾는 데 사용합니다.',
        '기존 캘린더 일정은 수정하거나 삭제하지 않습니다.',
        '기기 권한은 iOS/Android 설정에서 언제든 철회할 수 있습니다.',
      ],
    });
  }

  if (selectedProviderIds.has('google')) {
    items.push({
      id: 'google_access',
      title: 'Google Calendar 연동',
      summary: 'Google에 연결한 뒤 일정을 읽기만 해요.',
      required: true,
      detail: [
        'Google Calendar에서 캘린더 목록과 다가오는 일정을 읽기만 합니다.',
        '선택한 일정의 장소와 메모는 이동 경로를 찾는 데 사용합니다.',
        'Google 연결 정보는 이 기기에 안전하게 저장되며 NoLate 서버에는 저장하지 않습니다.',
        'Google 계정 보안 설정에서 연동 권한을 철회할 수 있습니다.',
      ],
    });
  }

  items.push(
    {
      id: 'candidate_review',
      title: '가져올 일정 확인',
      summary: '캘린더별로 확인하고 필요한 일정만 조정해요.',
      required: true,
      detail: [
        '다가오는 일정은 전체 선택 상태로 먼저 보여드립니다.',
        '캘린더 단위로 선택하거나 개별 일정을 펼쳐 조정할 수 있습니다.',
        '종일 일정이나 시간이 분명하지 않은 일정은 확인이 필요하다고 표시합니다.',
        '장소나 메모에서 이동 정보를 찾지 못한 일정도 직접 확인할 수 있도록 남겨둡니다.',
      ],
    },
    {
      id: 'selected_schedule_storage',
      title: '선택한 일정 저장',
      summary: '선택한 일정만 NoLate에 저장해요.',
      required: true,
      detail: [
        '캘린더 전체 내용은 NoLate 서버에 저장하지 않습니다.',
        '직접 선택한 일정의 제목, 시간, 장소, 메모, 카테고리, 경로와 알림 설정만 저장합니다.',
        '저장된 일정은 NoLate 일정 화면에서 수정하거나 삭제할 수 있습니다.',
      ],
    },
  );

  return items;
}

/** 여러 제공자에서 수집한 후보를 안정적인 식별자로 병합하고 중복 일정을 제거합니다. */
export function mergeCalendarCandidates(
  candidates: DeviceCalendarCandidate[],
): DeviceCalendarCandidate[] {
  const seen = new Set<string>();

  return candidates
    .filter(candidate => {
      const key = [
        candidate.title.trim().toLowerCase(),
        candidate.startAt,
        candidate.endAt,
        candidate.locationName?.trim().toLowerCase() ?? '',
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareCandidatesForDisplay);
}

/** 후보 일정을 시작 시각과 제목 기준으로 정렬하기 위한 안정적인 비교 결과를 반환합니다. */
export function compareCandidatesForDisplay(
  a: DeviceCalendarCandidate,
  b: DeviceCalendarCandidate,
): number {
  if (a.requiresTimeReview !== b.requiresTimeReview) {
    return a.requiresTimeReview ? 1 : -1;
  }

  return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}

/** 후보 일정을 원본 캘린더별 그룹으로 묶고 각 그룹의 선택 통계를 계산합니다. */
export function buildCandidateSourceGroups(
  candidates: DeviceCalendarCandidate[],
  selectedIds: Set<string>,
): CandidateSourceGroup[] {
  const groups = new Map<string, CandidateSourceGroup>();

  for (const candidate of candidates) {
    const sourceKey = getCalendarImportSourceKey(candidate);
    const current = groups.get(sourceKey);
    if (current) {
      current.totalCount += 1;
      if (selectedIds.has(candidate.id)) current.selectedCount += 1;
      continue;
    }

    groups.set(sourceKey, {
      key: sourceKey,
      title: candidate.calendarTitle,
      color: candidate.calendarColor,
      totalCount: 1,
      selectedCount: selectedIds.has(candidate.id) ? 1 : 0,
    });
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.title.localeCompare(b.title, 'ko'),
  );
}
