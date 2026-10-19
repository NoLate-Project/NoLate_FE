import test from 'node:test';
import assert from 'node:assert/strict';
import { probePedestrianProvider } from './journey-pedestrian-provider-probe.mjs';
const key = 'SYNTHETIC_KEY_NOT_A_CREDENTIAL';
const line = (index, coords) => ({ type: 'Feature', properties: { index }, geometry: { type: 'LineString', coordinates: coords } });
const response = () => ({ type: 'FeatureCollection', features: [line(0, [[126.978, 37.5665], [126.9785, 37.5665]]),
  line(1, [[126.9785, 37.5665], [126.979, 37.5665]])] });
test('missing key performs no network calls', async () => {
  assert.equal((await probePedestrianProvider({ fetcher() { throw Error('must not run'); } })).networkAttempts, 0);
});
test('exactly one fixed HTTPS request, no redirects, redacted summary only', async () => {
  let count = 0;
  const result = await probePedestrianProvider({ appKey: key, fetcher: async (url, options) => {
    count++; assert.equal(new URL(url).origin, 'https://apis.openapi.sk.com');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.appKey, key);
    assert.equal(options.body.get('sort'), 'index');
    return new Response(JSON.stringify(response()));
  } });
  assert.deepEqual(result, { status: 'RAW_GEOMETRY_CANDIDATE', networkAttempts: 1, navigationReady: false,
    lineCount: 2, rawLinePointCount: 4, deliveredPointCount: 3 });
  assert.equal(count, 1); assert.ok(!JSON.stringify(result).includes(key));
});
test('rejects malformed geometry without retaining raw coordinates', async () => {
  const raw = response(); raw.features[1].geometry.coordinates[0][0] += .00001;
  const result = await probePedestrianProvider({ appKey: key, fetcher: async () => new Response(JSON.stringify(raw)) });
  assert.equal(result.reason, 'DISCONNECTED_LINES'); assert.ok(!JSON.stringify(result).includes('126.978'));
});
test('transport exception cannot leak credentials or retry', async () => {
  let count = 0;
  assert.equal((await probePedestrianProvider({ appKey: key, fetcher: async () => { count++; throw Error(key); } })).status, 'TRANSPORT_FAILED');
  assert.equal(count, 1);
});
test('HTTP rejection does not read response content', async () => {
  assert.deepEqual(await probePedestrianProvider({ appKey: key, fetcher: async () => new Response(key, { status: 403 }) }),
    { status: 'HTTP_REJECTED', networkAttempts: 1, navigationReady: false, httpStatus: 403 });
});
test('oversized and invalid JSON bodies are rejected', async () => {
  for (const [body, status] of [['x'.repeat(1_048_577), 'RESPONSE_LIMIT'], [key, 'INVALID_RESPONSE']]) {
    assert.equal((await probePedestrianProvider({ appKey: key, fetcher: async () => new Response(body) })).status, status);
  }
});
