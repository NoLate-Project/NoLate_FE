import {automaticRecord} from './automaticJourney';
import {journeyJSONRequest} from './journeyJSONRequest';

export const subwayDiagnosticCases = [
    ['complete', '정상 열차 관측'], ['multiple', '복수 열차 관측'], ['direction', '반대 방면 차단'],
    ['stale', '오래된 관측 차단'], ['partial', '일부 목록 차단'], ['edited', '조회 중 경로 변경'],
    ['revoked', '조회 중 로그인 철회'], ['catalog-missing', '역 매핑 근거 없음'], ['redirect', '리다이렉트 차단'],
    ['raw-missing', '저장 원본 역 ID 없음'],
    ['catalog-branches', '분기·종착역 후보 분리'], ['catalog-express', '급행 정차 순서 대조'],
    ['catalog-ambiguous', '중복 운행 패턴 차단'], ['catalog-unmapped', '중간 역 대응 누락 차단'],
    ['catalog-expired', '운행 catalog 만료 차단'],
    ['catalog-loop-shadow', '순환 구간 모호성 우회 차단'],
    ['automatic-complete', '자동 세션 관측 연결'], ['automatic-stopped', '조회 중 자동 세션 취소'],
    ['automatic-replaced', '조회 중 자동 세션 교체'], ['automatic-revoked', '자동 세션 로그인 철회'],
    ['automatic-edited', '자동 세션 경로 변경'], ['automatic-generation', '이전 자동 세대 차단'],
] as const;
export type SubwayDiagnosticCase = typeof subwayDiagnosticCases[number][0];
const statuses = new Set(['TRAIN_REFERENCES_ONLY', 'SERVICE_PATTERN_OR_FRESHNESS_MISMATCH',
    'TRAIN_OBSERVATIONS_UNAVAILABLE', 'SAVED_ROUTE_CHANGED', 'OWNER_CHANGED', 'STATION_CROSSWALK_REQUIRED',
    'PROVIDER_UNAVAILABLE', 'RAW_SUBWAY_IDENTIFIERS_REQUIRED','SERVICE_PATTERN_AMBIGUOUS','CATALOG_UNAVAILABLE','AUTOMATIC_SESSION_UNAVAILABLE']);
export interface SubwayObservationDiagnostic {
    case: SubwayDiagnosticCase; status: string; matchingTrainCount: number; providerCalls: number; authorityReads: number;
}

export function parseSubwayObservationDiagnostic(raw: unknown, selected: SubwayDiagnosticCase): SubwayObservationDiagnostic {
    const value = automaticRecord(raw);
    const count = (key: string, max: number): number => {
        const n = value?.[key]; if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) throw new Error('INVALID_SUBWAY_DIAGNOSTIC');
        return n;
    };
    if (!value || value.schemaVersion !== 1 || value.fixtureOnly !== true || value.realProvider !== false || value.gpsUsed !== false
        || value.case !== selected || value.navigationReady !== false || value.passengerBoardingConfirmed !== false
        || value.passengerPosition !== null || value.passengerRemainingStops !== null || value.redirectTrapCalls !== 0
        || typeof value.status !== 'string' || !statuses.has(value.status)) throw new Error('INVALID_SUBWAY_DIAGNOSTIC');
    const matchingTrainCount = count('matchingTrainCount', 500), providerCalls = count('providerCalls', 1), authorityReads = count('authorityReads', 2);
    if (value.status !== 'TRAIN_REFERENCES_ONLY' && matchingTrainCount !== 0 || authorityReads < 1
        || ['STATION_CROSSWALK_REQUIRED', 'RAW_SUBWAY_IDENTIFIERS_REQUIRED'].includes(value.status)
        && (providerCalls !== 0 || authorityReads !== 2)
        || value.status === 'SERVICE_PATTERN_AMBIGUOUS' && (providerCalls !== 1 || authorityReads !== 2)
        || value.status === 'TRAIN_REFERENCES_ONLY' && (matchingTrainCount < 1 || authorityReads !== 2 || providerCalls !== 1))
        throw new Error('INVALID_SUBWAY_DIAGNOSTIC');
    return {case: selected, status: value.status, matchingTrainCount, providerCalls, authorityReads};
}

/** Fixed loopback/test-source harness. No authentication storage, provider key, native GPS or activity call. */
export async function loadSubwayObservationDiagnostic(selected: SubwayDiagnosticCase): Promise<SubwayObservationDiagnostic> {
    if (!subwayDiagnosticCases.some(([key]) => key === selected)) throw new Error('INVALID_SUBWAY_DIAGNOSTIC');
    return parseSubwayObservationDiagnostic(await journeyJSONRequest('http://127.0.0.1:15547/__fixture/subway-check', {case: selected}), selected);
}
