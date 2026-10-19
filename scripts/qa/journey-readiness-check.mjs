import { pathToFileURL } from 'node:url';

const counters = ['prepareCount', 'departureCount', 'activationCount', 'cancelCount', 'authenticatedRequests',
    'rejectedRequests', 'validationRequests', 'arrivalRequests', 'refreshRequests', 'guidancePushAcceptedCount', 'trapRequests'];
/** Test listener only. Never reads /context, credentials, device data, or production APIs. */
export function assessJourneyFixtureState(raw, expectStopped = false) {
    if (!raw || raw.fixtureOnly !== true) throw new Error('NOT_AN_ISOLATED_JOURNEY_FIXTURE');
    const state = ['NONE', 'ARMED', 'ACTIVE', 'STOPPED', 'EXPIRED', 'CANCELLED'].includes(raw.lastState) ? raw.lastState : 'UNKNOWN';
    const counts = Object.fromEntries(counters.map(key => [key,
        Number.isSafeInteger(raw[key]) && raw[key] >= 0 && raw[key] <= 1_000_000 ? raw[key] : null]));
    const safe = counts.trapRequests === 0 && raw.trapAuthorizationSeen === false;
    const complete = counters.every(key => counts[key] !== null) && typeof raw.guidancePushRealProvider === 'boolean';
    return { schemaVersion: 1, fixtureOnly: true, lastState: state, counts,
        guidancePushRealProvider: typeof raw.guidancePushRealProvider === 'boolean' ? raw.guidancePushRealProvider : null,
        trapAuthorizationSeen: typeof raw.trapAuthorizationSeen === 'boolean' ? raw.trapAuthorizationSeen : null,
        verdict: complete && safe && state !== 'UNKNOWN' && (!expectStopped || state === 'STOPPED') ? 'OBSERVED_EXPECTATION_MET' : 'ATTENTION',
        apnsDelivery: 'UNVERIFIED', productionNavigation: 'UNVERIFIED' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--expect-stopped')) {
        console.error('Only --expect-stopped is supported; listener is fixed to loopback 15544.'); process.exitCode = 2;
    } else {
        try {
            const response = await fetch('http://127.0.0.1:15544/__fixture/state', { redirect: 'manual', signal: AbortSignal.timeout(3000) });
            if (!response.ok || response.redirected) throw new Error('ISOLATED_FIXTURE_UNAVAILABLE');
            const body = await response.text(); if (Buffer.byteLength(body) > 8192) throw new Error('FIXTURE_RESPONSE_LIMIT');
            const result = assessJourneyFixtureState(JSON.parse(body), args.includes('--expect-stopped'));
            console.log(JSON.stringify(result, null, 2));
            if (result.verdict !== 'OBSERVED_EXPECTATION_MET') process.exitCode = 1;
        } catch { console.error('ISOLATED_FIXTURE_CHECK_UNAVAILABLE'); process.exitCode = 1; }
    }
}
