import { journeyJSONRequest } from './journeyJSONRequest';
import { journeyAuthentication } from './automaticJourneyAuthentication';
import { automaticRecord } from './automaticJourney';

export const walkingContractCases = ['complete', 'owner', 'revision', 'route', 'expired', 'gap', 'source',
    'http-complete', 'http-edited', 'http-revoked', 'http-redirect', 'http-large', 'http-timeout'] as const;
export type WalkingContractCase = typeof walkingContractCases[number];
const reasons = ['TRANSIT_ADMISSION_PENDING', 'OWNER_CHANGED', 'REVISION_CHANGED', 'SAVED_ROUTE_CHANGED',
    'EXPIRED', 'DISCONNECTED_LINES', 'UNSUPPORTED_SAVED_ROUTE', 'TRANSIT_ADMISSION_PENDING', 'SAVED_ROUTE_CHANGED',
    'OWNER_CHANGED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'] as const;
export type WalkingContractSummary = {
    status: 'BOUND' | 'BLOCKED'; reason: typeof reasons[number]; walkCount: number; pointCount: number; providerCalls: number;
    authorityReads?: number;
};
/** Diagnostic response only, never route geometry, admission, authentication, or persisted state. */
export function walkingContractSummary(value: unknown, selected: WalkingContractCase): WalkingContractSummary {
    const raw = automaticRecord(value);
    const index = walkingContractCases.indexOf(selected);
    const bound = selected === 'complete' || selected === 'http-complete';
    const http = selected.startsWith('http-');
    const calls = ['owner', 'source'].includes(selected) ? 0 : ['gap', 'http-redirect', 'http-large', 'http-timeout'].includes(selected) ? 1 : 2;
    const reads = calls === 2 ? 2 : 1;
    if (index < 0 || raw?.fixtureOnly !== true || raw.case !== selected || raw.navigationReady !== false ||
        raw.transitProvider !== 'odsay' || raw.walkProvider !== 'tmap' || raw.reason !== reasons[index] ||
        raw.status !== (bound ? 'BOUND' : 'BLOCKED') ||
        raw.walkCount !== (bound ? 2 : 0) || raw.pointCount !== (bound ? 6 : 0) || raw.providerCalls !== calls ||
        http && (raw.authorityReads !== reads || raw.redirectTrapCalls !== 0))
        throw new Error('INVALID_WALKING_CONTRACT_RESPONSE');
    return { status: raw.status as WalkingContractSummary['status'], reason: raw.reason as WalkingContractSummary['reason'],
        walkCount: raw.walkCount as number, pointCount: raw.pointCount as number, providerCalls: raw.providerCalls as number,
        ...(http ? { authorityReads: reads } : {}) };
}

/** Explicit dev-only loopback test. Test issuer token stays in this call's memory; no real auth
 * storage/native bridge, cookies, redirects, route updates, GPS, APNs or provider access. */
export async function loadWalkingContractTrial(selected: WalkingContractCase): Promise<WalkingContractSummary> {
    if (!__DEV__ || !walkingContractCases.includes(selected)) throw new Error('WALKING_CONTRACT_UNAVAILABLE');
    const root = automaticRecord(await journeyJSONRequest('http://127.0.0.1:15544/__fixture/context'));
    if (root?.fixtureOnly !== true || root.apiOrigin !== 'http://127.0.0.1:15544' || root.memberId !== 7 ||
        root.guidancePushRealProvider !== false) throw new Error('WALKING_CONTRACT_UNAVAILABLE');
    const auth = journeyAuthentication(root.accessToken, root.apiOrigin, root.memberId);
    const url = `http://127.0.0.1:15544/__fixture/walking-contract?case=${selected}`;
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 4000);
    try {
        const request: RequestInit & { redirect: 'error' } = { method: 'GET', credentials: 'omit', redirect: 'error', signal: abort.signal,
            headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json' } };
        const response = await fetch(url, request);
        if (!response.ok || response.redirected || response.url && response.url !== url) throw new Error('WALKING_CONTRACT_UNAVAILABLE');
        const body = await response.text();
        if (body.length > 2048) throw new Error('INVALID_WALKING_CONTRACT_RESPONSE');
        return walkingContractSummary(JSON.parse(body), selected);
    } finally { clearTimeout(timer); }
}
