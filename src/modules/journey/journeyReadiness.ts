import { automaticRecord, type AutomaticJourneySnapshot } from './automaticJourney';
import type { AutomaticJourneySyncState } from './automaticJourneyTrial';
import type { JourneyDiagnosticsSnapshot } from './journeyDiagnostics';

export type ReadinessCheck = { code: string; state: 'OBSERVED' | 'ATTENTION' | 'UNVERIFIED' | 'UNSUPPORTED' | 'PARTIAL'; detail: string };
const known = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value) ? value : 'UNKNOWN';
/** Read-only, token/identity/coordinate-free evidence. Never equates a diagnostic probe with navigation. */
export function journeyReadinessReport(native: AutomaticJourneySnapshot, sync: AutomaticJourneySyncState,
    probe: JourneyDiagnosticsSnapshot, nowSeconds: number): ReadinessCheck[] {
    const status = known(native.status, ['IDLE', 'ARMED', 'ACTIVE', 'STOPPED', 'EXPIRED']);
    const authorization = known(native.authorization, ['NOT_DETERMINED', 'RESTRICTED', 'DENIED', 'WHEN_IN_USE', 'ALWAYS']);
    const guidance = automaticRecord(native.guidance);
    const observed = guidance?.observedAt;
    const validUntil = guidance?.validUntil;
    const age = typeof observed === 'number' && Number.isFinite(observed) && Number.isFinite(nowSeconds) && observed <= nowSeconds
        ? Math.floor(nowSeconds - observed) : null;
    const fresh = age !== null && typeof validUntil === 'number' && Number.isFinite(validUntil) && validUntil > nowSeconds;
    const pending = Number.isSafeInteger(sync.pendingStopCount) && sync.pendingStopCount! >= 0 ? sync.pendingStopCount! : 0;
    return [
        { code: 'ENGINE', state: native.enabled ? 'OBSERVED' : 'ATTENTION', detail: `엔진 ${status} · 현재 구현은 시뮬레이터 전용` },
        { code: 'LOCATION_AUTH', state: ['DENIED', 'RESTRICTED'].includes(authorization) ? 'ATTENTION' : authorization === 'UNKNOWN' ? 'UNVERIFIED' : 'OBSERVED',
            detail: `엔진 위치 권한 ${authorization}` },
        { code: 'LOCATION_PRECISION', state: probe.enabled && probe.location.accuracyAuthorization === 'REDUCED' ? 'ATTENTION' : 'UNVERIFIED',
            detail: probe.enabled ? `OS 정확도 ${known(probe.location.accuracyAuthorization, ['FULL', 'REDUCED'])} · 실외 수신 품질은 별도 확인` : '진단 빌드 필요' },
        { code: 'GUIDANCE_FRESHNESS', state: status === 'ACTIVE' && !fresh ? 'ATTENTION' : fresh ? 'OBSERVED' : 'UNVERIFIED',
            detail: `안내 관측 ${age === null ? '없음' : `${age}초 전`} · ${fresh ? '유효 시간 내' : '새 안내 필요'} · GPS 정확성과는 별개` },
        { code: 'STOP_SYNC', state: pending || sync.status === 'BLOCKED' ? 'ATTENTION' : 'UNVERIFIED',
            detail: `서버 종료 대기 ${pending}건 · 큐 0건도 서버 종료 증명은 아님; 서버 receipt 확인 필요` },
        { code: 'LIVE_ACTIVITY', state: probe.enabled && !probe.liveActivity.activitiesEnabled ? 'ATTENTION' : 'UNVERIFIED',
            detail: `실시간 현황 허용 ${probe.enabled ? probe.liveActivity.activitiesEnabled ? 'ON' : 'OFF' : 'UNKNOWN'} · 잠금 화면 육안 확인 필요` },
        { code: 'APNS', state: 'UNVERIFIED', detail: `토큰 ${native.guidancePushTokenAvailable ? '발급됨' : '미발급'} · provider 수락/실제 수신/잠금 표시를 각각 확인; 토큰만으로 성공 판정 금지` },
        { code: 'VOICE_SILENT', state: 'UNVERIFIED', detail: '하드웨어 무음 상태 자동 판독 불가 · 음성 진단과 실제 안내 이벤트 연결은 별개; 명시적 안내 설정 및 실기기 청취 확인 필요' },
        // Implementation scope, not a verdict on this session. A live snapshot or diagnostic
        // success cannot attest real-provider integration, passenger position or release readiness.
        { code: 'TRANSIT_RIDE', state: 'PARTIAL', detail: '버스 자동 탑승·하차·환승 도보·도착은 Debug 시뮬레이터 시험 구현 · 합성 GPS/차량 검증과 실제 노선 검증은 별개' },
        { code: 'SUBWAY_NAVIGATION', state: 'UNSUPPORTED', detail: '열차 관측 조회만 구현 · 공식 역 대응/운행 자료 및 native 승객 결합 미연결 · 관측 열차를 내 위치로 표시하지 않음' },
        { code: 'DEVICE_RELEASE', state: 'UNSUPPORTED', detail: '자동 안내 runtime은 Debug 시뮬레이터 전용 · 실기기/Release 실행 경로 미연결 · 운영 ON만으로 해결되지 않음' },
        { code: 'PRODUCTION_ROUTE', state: 'UNVERIFIED', detail: '실제 로그인·일정·공급자·지도 연결 및 배터리/지하철 GPS 단절/재탐색 현장 시험 필요' },
    ];
}
