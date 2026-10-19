import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';

const origin = 'http://127.0.0.1:15544';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Explicit single-pinned-lane loopback termination. No credential files, token arguments or raw output. */
export async function endPinnedJourneyFixture(fetcher = fetch) {
    const request = async (path, init = {}) => {
        const response = await fetcher(`${origin}${path}`, { ...init, redirect: 'manual', signal: globalThis.AbortSignal.timeout(8000) });
        if (!response.ok || response.redirected) throw new Error('ISOLATED_APNS_END_REJECTED');
        const text = await response.text();
        if (Buffer.byteLength(text) > 65536) throw new Error('ISOLATED_APNS_END_RESPONSE_LIMIT');
        return JSON.parse(text);
    };
    const context = await request('/__fixture/context');
    if (context.fixtureOnly !== true || context.guidancePushRealProvider !== true || context.apiOrigin !== origin
        || context.memberId !== 7 || typeof context.accessToken !== 'string' || context.accessToken.length > 8192
        || !/^[A-Za-z0-9_.-]+$/.test(context.accessToken)) throw new Error('ISOLATED_APNS_END_CONTEXT_INVALID');
    // Test issuer token remains in memory. It is never returned, printed or written to disk.
    const headers = { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json' };
    const pinned = await request('/__fixture/push-binding', { headers });
    const b = pinned.data;
    if (pinned.fixtureOnly !== true || !b || b.scheduleId !== '9001' || !uuid.test(b.sessionId) || !uuid.test(b.clientOwnerId)
        || !Number.isSafeInteger(b.generation) || b.generation < 1 || !Number.isSafeInteger(b.routeRevision) || b.routeRevision < 1
        || !/^[0-9a-f]{64}$/.test(b.routeInputDigest)) throw new Error('ISOLATED_APNS_END_BINDING_INVALID');
    const response = await request(`/api/schedules/9001/automatic-journey/${b.sessionId}/live-activity/end`, {
        method: 'POST', headers, body: JSON.stringify({ generation: b.generation, routeRevision: b.routeRevision,
            clientOwnerId: b.clientOwnerId, routeInputDigest: b.routeInputDigest }),
    });
    const data = response.data;
    if (response.success !== true || !data || data.sessionId !== b.sessionId || data.state !== 'STOPPED'
        || data.providerAccepted !== true || data.deviceVerified !== false || typeof data.duplicate !== 'boolean'
        || !Number.isSafeInteger(data.timestamp) || data.timestamp <= 0) throw new Error('ISOLATED_APNS_END_RECEIPT_INVALID');
    return { fixtureOnly: true, state: 'STOPPED', providerAccepted: true, deviceVerified: false,
        duplicate: data.duplicate, event: 'END' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.slice(2).join(' ') !== '--send-end') {
        console.error('Only explicit --send-end for the fixed loopback pinned trial is supported.'); process.exitCode = 2;
    } else {
        try { console.log(JSON.stringify(await endPinnedJourneyFixture())); }
        catch { console.error('ISOLATED_APNS_END_FAILED'); process.exitCode = 1; }
    }
}
