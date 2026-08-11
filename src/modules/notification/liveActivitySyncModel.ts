import type {
  LiveActivityAppearance,
  RegisterLiveActivityStartTokenPayload,
  RegisterLiveActivityUpdateTokenPayload,
  RetireLiveActivityPayload,
} from '../../api/notification';
import type {
  ActiveLiveActivity,
  LiveActivityCapabilities,
  LiveActivityPushTokenEvent,
  LiveActivityStateChangeEvent,
} from './liveActivity';

export const LIVE_ACTIVITY_TYPE = 'NoLateDepartureAttributes' as const;
export const LIVE_ACTIVITY_SCHEMA_VERSION = 1 as const;
export const LIVE_ACTIVITY_REGISTRATION_RETRY_DELAYS_MS = [
  1_500, 4_000, 15_000,
] as const;
export const LIVE_ACTIVITY_RETIREMENT_RETRY_DELAYS_MS = [
  1_500, 4_000, 15_000,
] as const;

type LiveActivitySyncSubscription = (handlers: {
  onPushToken: (event: LiveActivityPushTokenEvent) => void;
  onStateChange: (event: LiveActivityStateChangeEvent) => void;
}) => () => void;

export type LiveActivitySyncDependencies = {
  getDeviceId: () => Promise<string>;
  getCapabilities: () => Promise<LiveActivityCapabilities>;
  getActiveActivities: () => Promise<ActiveLiveActivity[]>;
  subscribeEvents: LiveActivitySyncSubscription;
  registerStartToken: (
    payload: RegisterLiveActivityStartTokenPayload,
  ) => Promise<void>;
  retireStartToken: (deviceId: string) => Promise<void>;
  registerUpdateToken: (
    activityId: string,
    payload: RegisterLiveActivityUpdateTokenPayload,
  ) => Promise<void>;
  retireActivity: (
    activityId: string,
    payload: RetireLiveActivityPayload,
  ) => Promise<void>;
  end: typeof import('./liveActivity')['endLiveActivity'];
  endAll: typeof import('./liveActivity')['endAllLiveActivities'];
  registrationRetryDelaysMs?: readonly number[];
  retirementRetryDelaysMs?: readonly number[];
  initialAppearance?: LiveActivityAppearance;
  onError?: (message: string, error: unknown) => void;
};

export type SyncLane = {
  revision: number;
  lastSucceeded?: string;
  tail: Promise<void>;
  cancelRetryWait?: () => void;
};

export type LiveActivitySession = {
  epoch: number;
  memberId: number;
  deviceId: string;
  appearance: LiveActivityAppearance;
  pushToStartToken?: string;
  pendingPushToStartToken?: string;
  canRegisterStartToken: boolean;
  unsubscribe: () => void;
  nativeEventRevision: number;
  nativeEventRevisionByKey: Map<string, number>;
  lanes: Map<string, SyncLane>;
  activeById: Map<string, ActiveLiveActivity>;
  latestGenerationByScheduleId: Map<string, number>;
  terminalActivityIds: Set<string>;
  endedScheduleIds: Set<string>;
  snapshotFlight?: Promise<void>;
};

export type PendingActivityRetirement = {
  memberId: number;
  deviceId: string;
  activityId: string;
  scheduleId: string;
};

export type LiveActivitySyncCoordinator = {
  activate: (memberId: number) => Promise<void>;
  resume: (memberId?: number) => Promise<void>;
  setAppearance: (appearance: LiveActivityAppearance) => Promise<void>;
  pause: () => void;
  clearForAccount: (memberId?: number) => Promise<void>;
  endSchedule: (scheduleId: string, memberId?: number) => Promise<void>;
};

/** 서버 API가 요구하는 양의 안전 정수 일정 ID로 문자열을 변환하고, 잘못된 값은 제외한다. */
export function scheduleIdAsNumber(scheduleId: string): number | undefined {
  if (!/^[1-9]\d*$/.test(scheduleId)) return undefined;
  const value = Number(scheduleId);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** 인증 회원 식별자가 Live Activity 동기화에 사용할 수 있는 양의 안전 정수인지 검사한다. */
export function validMemberId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 네이티브 토큰 이벤트를 시작 토큰 또는 Activity별 갱신 토큰 lane 키로 정규화한다. */
export function nativeEventKey(
  event: LiveActivityPushTokenEvent,
): string | undefined {
  if (event.kind === 'pushToStart') return 'start';
  return event.activityId ? `update:${event.activityId}` : undefined;
}

/** 시작 토큰과 화면 모드를 묶어 동일 등록 요청을 중복 전송하지 않는 비교값을 만든다. */
export function startRegistrationValue(
  pushToStartToken: string,
  appearance: LiveActivityAppearance,
): string {
  return `${appearance}:${pushToStartToken}`;
}

/** 회원·기기·Activity 조합을 서버 폐기 작업의 안정적인 중복 제거 키로 직렬화한다. */
export function retirementKey(
  memberId: number,
  deviceId: string,
  activityId: string,
): string {
  return `${memberId}:${deviceId}:${activityId}`;
}

/** 지정한 지연 목록만큼 비동기 작업을 재시도하고 모든 시도가 실패하면 마지막 오류를 전달한다. */
export async function retryBounded(
  task: () => Promise<void>,
  retryDelaysMs: readonly number[],
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      const retryDelayMs = retryDelaysMs[attempt];
      if (retryDelayMs === undefined) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}

/** lane에 예약된 재시도 대기를 해제하고 취소 함수를 비워 다음 작업이 안전하게 대체하게 한다. */
export function cancelRetryWait(lane: SyncLane): void {
  const cancel = lane.cancelRetryWait;
  lane.cancelRetryWait = undefined;
  cancel?.();
}

export type {
  LiveActivityAppearance,
  LiveActivityPushTokenEvent,
  LiveActivityStateChangeEvent,
};
