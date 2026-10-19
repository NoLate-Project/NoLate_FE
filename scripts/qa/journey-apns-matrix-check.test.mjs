import test from 'node:test';
import assert from 'node:assert/strict';
import { assessApnsSchemaMatrix, readApnsSchemaMatrix } from './journey-apns-matrix-check.mjs';
const state = { fixtureOnly: true, durableFixture: false, guidancePushRealProvider: true,
  guidancePushProviderSchemaAcceptedCounts: { '1': 1, '2': 1, '3': 1, '4': 1 },
  guidancePushProviderAttemptCount: 5, guidancePushAcceptedCount: 5, guidancePushProviderRejectedCount: 0,
  guidancePushEndAcceptedCount: 1, trapRequests: 0, trapAuthorizationSeen: false, lastState: 'STOPPED' };
test('complete actual provider matrix never claims device delivery', () => {
  assert.equal(assessApnsSchemaMatrix(state).verdict, 'PROVIDER_MATRIX_ACCEPTED');
  assert.equal(assessApnsSchemaMatrix(state).deviceDelivery, 'UNVERIFIED');
});
test('missing phase end rejected provider or trap cannot pass', () => {
  for (const patch of [{ guidancePushProviderSchemaAcceptedCounts: { '1': 1, '2': 1, '3': 1, '4': 0 } },
    { guidancePushEndAcceptedCount: 0 }, { lastState: 'ACTIVE' }, { guidancePushProviderRejectedCount: 1 },
    { trapRequests: 1 }, { trapAuthorizationSeen: true }]) assert.equal(assessApnsSchemaMatrix({ ...state, ...patch }).verdict, 'INCOMPLETE');
});
test('malformed and inflated counters fail closed without private field echo', () => {
  for (const patch of [{ fixtureOnly: false }, { durableFixture: true }, { guidancePushProviderAttemptCount: 0 },
    { guidancePushAcceptedCount: 0 }, { guidancePushProviderRejectedCount: NaN },
    { guidancePushProviderSchemaAcceptedCounts: { '1': 0, '2': 0, '3': 0, '4': -1 } }]) {
    assert.throws(() => assessApnsSchemaMatrix({ ...state, ...patch }));
  }
  assert.doesNotMatch(JSON.stringify(assessApnsSchemaMatrix({ ...state, token: 'secret', latitude: 37.7 })), /secret|latitude|37\.7/);
});
test('synthetic fixture has no provider matrix and cannot impersonate real delivery', () => {
  assert.equal(assessApnsSchemaMatrix({ ...state, guidancePushRealProvider: false, guidancePushAcceptedCount: 0,
    guidancePushProviderAttemptCount: 0, guidancePushEndAcceptedCount: 0,
    guidancePushProviderSchemaAcceptedCounts: { '1': 0, '2': 0, '3': 0, '4': 0 } }).verdict, 'INCOMPLETE');
});
test('reader uses fixed loopback no auth and rejects redirects and oversized responses', async () => {
  const reader = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:15544/__fixture/state'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers, undefined); return { ok: true, redirected: false, text: async () => JSON.stringify(state) };
  };
  assert.equal((await readApnsSchemaMatrix(reader)).verdict, 'PROVIDER_MATRIX_ACCEPTED');
  await assert.rejects(readApnsSchemaMatrix(async () => ({ ok: true, redirected: true })));
  await assert.rejects(readApnsSchemaMatrix(async () => ({ ok: true, redirected: false, text: async () => ' '.repeat(65537) })));
});
