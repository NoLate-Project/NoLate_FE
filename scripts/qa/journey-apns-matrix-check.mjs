import { pathToFileURL } from 'node:url';

/** Read-only bounded provider receipts. Never claims OS delivery or echoes arbitrary fields. */
export function assessApnsSchemaMatrix(state) {
  if (state?.fixtureOnly !== true || state.durableFixture !== false) throw new Error('ISOLATED_APNS_MATRIX_REQUIRED');
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
  const raw = state.guidancePushProviderSchemaAcceptedCounts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== '1,2,3,4'
      || !Object.values(raw).every(count)) throw new Error('ISOLATED_APNS_MATRIX_INVALID');
  for (const key of ['guidancePushProviderAttemptCount', 'guidancePushAcceptedCount', 'guidancePushProviderRejectedCount',
    'guidancePushEndAcceptedCount', 'trapRequests']) if (!count(state[key])) throw new Error('ISOLATED_APNS_MATRIX_INVALID');
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  if (sum + state.guidancePushEndAcceptedCount > state.guidancePushAcceptedCount
      || state.guidancePushAcceptedCount > state.guidancePushProviderAttemptCount
      || state.guidancePushProviderRejectedCount > state.guidancePushProviderAttemptCount
      || typeof state.trapAuthorizationSeen !== 'boolean' || typeof state.guidancePushRealProvider !== 'boolean') {
    throw new Error('ISOLATED_APNS_MATRIX_INVALID');
  }
  const clean = state.guidancePushRealProvider && state.guidancePushProviderRejectedCount === 0
      && state.trapRequests === 0 && state.trapAuthorizationSeen === false;
  return { fixtureOnly: true, provider: state.guidancePushRealProvider ? 'REAL' : 'NONE',
    verdict: clean && Object.values(raw).every(n => n > 0) && state.guidancePushEndAcceptedCount > 0
      && state.lastState === 'STOPPED' ? 'PROVIDER_MATRIX_ACCEPTED' : 'INCOMPLETE',
    schemas: { v1: raw['1'], v2: raw['2'], v3: raw['3'], v4: raw['4'] },
    endAccepted: state.guidancePushEndAcceptedCount, deviceDelivery: 'UNVERIFIED' };
}
export async function readApnsSchemaMatrix(fetcher = fetch) {
  const response = await fetcher('http://127.0.0.1:15544/__fixture/state', {
    redirect: 'manual', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || response.redirected) throw new Error('ISOLATED_APNS_MATRIX_REJECTED');
  const body = await response.text();
  if (Buffer.byteLength(body) > 65536) throw new Error('ISOLATED_APNS_MATRIX_LIMIT');
  return assessApnsSchemaMatrix(JSON.parse(body));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) { console.error('Read-only fixed loopback check; no arguments supported.'); process.exitCode = 2; }
  else try { console.log(JSON.stringify(await readApnsSchemaMatrix())); }
  catch { console.error('ISOLATED_APNS_MATRIX_FAILED'); process.exitCode = 1; }
}
