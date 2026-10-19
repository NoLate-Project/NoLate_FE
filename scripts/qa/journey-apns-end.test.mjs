import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endPinnedJourneyFixture } from './journey-apns-end.mjs';

const binding = { scheduleId: '9001', sessionId: 'aa67598a-6c84-4d0d-8d25-134e0c01c12e', generation: 1, routeRevision: 1,
    clientOwnerId: 'bb67598a-6c84-4d0d-8d25-134e0c01c12e', routeInputDigest: 'a'.repeat(64) };
const context = { fixtureOnly: true, guidancePushRealProvider: true, apiOrigin: 'http://127.0.0.1:15544', memberId: 7, accessToken: 'synthetic.issuer.token' };
function harness(contextChange = {}, bindingChange = {}, receiptChange = {}) {
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push({ url, options });
        const response = calls.length === 1 ? { ...context, ...contextChange } : calls.length === 2
            ? { fixtureOnly: true, data: { ...binding, ...bindingChange } }
            : { success: true, data: { sessionId: binding.sessionId, state: 'STOPPED', timestamp: 1000, providerAccepted: true, deviceVerified: false, duplicate: false, ...receiptChange } };
        return { ok: true, redirected: false, text: async () => JSON.stringify(response) };
    };
    return { calls, fetcher };
}
test('end is explicit pinned loopback only and result never exposes issuer or routing tokens', async () => {
    const h = harness(); const result = await endPinnedJourneyFixture(h.fetcher);
    assert.equal(h.calls.length, 3);
    assert.ok(h.calls.every(c => c.url.startsWith('http://127.0.0.1:15544/') && c.options.redirect === 'manual'));
    assert.deepEqual(JSON.parse(h.calls[2].options.body), { generation: 1, routeRevision: 1, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest });
    assert.equal(result.event, 'END'); assert.equal(result.deviceVerified, false);
    assert.ok(!JSON.stringify(result).includes(context.accessToken));
});
test('wrong project listener identity fixture type or unsafe header stops before END', async () => {
    for (const change of [{ apiOrigin: 'https://production.invalid' }, { fixtureOnly: false }, { memberId: 8 },
        { guidancePushRealProvider: false }, { accessToken: 'secret\nheader' }, { accessToken: '' }]) {
        const h = harness(change); await assert.rejects(endPinnedJourneyFixture(h.fetcher)); assert.equal(h.calls.length, 1);
    }
});
test('unsafe session target or mismatched pinned schedule is rejected', async () => {
    for (const change of [{ sessionId: '../other' }, { scheduleId: '9002' }, { generation: 0 }, { routeRevision: 1.5 }, { routeInputDigest: 'bad' }]) {
        const h = harness({}, change); await assert.rejects(endPinnedJourneyFixture(h.fetcher)); assert.equal(h.calls.length, 2);
    }
});
test('provider acceptance is not inferred from nonterminal or wrong-session receipt', async () => {
    for (const change of [{ state: 'ACTIVE' }, { providerAccepted: false }, { deviceVerified: true }, { timestamp: 0 }, { sessionId: binding.clientOwnerId }]) {
        await assert.rejects(endPinnedJourneyFixture(harness({}, {}, change).fetcher));
    }
});
test('redirect or oversized response never follows or logs provider material', async () => {
    await assert.rejects(endPinnedJourneyFixture(async () => ({ ok: false, redirected: true })));
    await assert.rejects(endPinnedJourneyFixture(async () => ({ ok: true, redirected: false, text: async () => 'x'.repeat(65537) })));
});
