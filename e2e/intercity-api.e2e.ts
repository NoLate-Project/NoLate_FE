/** Opt-in local API E2E. Does not count as a native screen E2E. */
jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));

const { readFileSync, writeFileSync } = require('fs') as {
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, content: string): void;
};
const http = require('http');
import captured from './evidence/intercity-2026-10-12/tmap-response.json';
import { parseTransitOptionsFromTmap } from '../src/modules/map/tmapApi';
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from '../src/modules/schedule/routeInfo';
import { isTransitRideKind } from '../src/modules/map/transitModes';
import { hasPersistableScheduleRoute } from '../src/modules/schedule/scheduleRouteTiming';

jest.setTimeout(90000);

function call(path: string, method = 'GET', body?: unknown, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 5522, path, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (response: {
      statusCode?: number;
      setEncoding(encoding: string): void;
      on(event: string, listener: (chunk: string) => void): void;
    }) => {
      let raw = '';
      // Decode across network chunks; Korean characters can span two chunks.
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(raw);
          if ((response.statusCode ?? 500) >= 400 || result.success !== true) {
            reject(new Error(`Local API ${method} ${path} status ${response.statusCode}`));
          } else resolve(result.data);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Local API timeout')));
    req.end(data);
  });
}

test('captured live TMAP → current FE model → real POST → DB → real GET → restored FE model', async () => {
  const credentials = JSON.parse(readFileSync(process.env.INTERCITY_E2E_CREDENTIALS!, 'utf8'));
  expect(credentials.email).toMatch(/^xcuitest-.*@example\.test$/);
  const auth = await call('/api/member/auth/login', 'POST', {
    email: credentials.email, password: credentials.password,
  });
  expect(auth.id).toBe(credentials.memberId);
  const token = auth.accessToken;
  const categories = await call('/api/schedule-categories', 'GET', undefined, token);
  const category = categories[0];
  expect(category).toBeDefined();
  const options = parseTransitOptionsFromTmap(captured);
  const evidence: unknown[] = [];
  for (const kind of ['EXPRESS_BUS', 'TRAIN'] as const) {
    const candidate = options.find(option => option.transitLegs?.some(leg => leg.kind === kind) &&
      option.transitLegs.filter(leg => isTransitRideKind(leg.kind)).every(leg => leg.serviceAvailable === true))!;
    expect(candidate).toBeDefined();
    const option = { ...candidate, mode: 'TRANSIT' as const };
    const origin = { name: '서울남부 E2E', lat: 37.4849, lng: 127.0167 };
    const destination = { name: '공주 E2E', lat: 36.4600, lng: 127.1246 };
    const departure = new Date(Date.now() + 86400000);
    const routeInfo = buildRouteInfoFromAlternative(option, origin, destination, departure);
    const route = { ...option, schemaVersion: 2, routeInfo };
    const payload = {
      title: `Intercity API E2E ${kind}`, startAt: routeInfo.arrivalTime,
      departAt: routeInfo.departureTime, allDay: false, hasEndTime: false,
      travelMode: 'TRANSIT', travelMinutes: option.minutes, origin, destination,
      category: { id: category.id, name: category.name, color: category.color },
      route, notificationEnabled: false,
    };
    const created = await call('/api/schedules', 'POST', payload, token);
    const id = created.id;
    expect(id).toBeDefined();
    try {
      const reloaded = await call(`/api/schedules/${id}`, 'GET', undefined, token);
      expect(reloaded.route).toEqual(JSON.parse(JSON.stringify(route)));
      expect(reloaded.notificationEnabled).toBe(false);
      expect(hasPersistableScheduleRoute(reloaded.route, reloaded.travelMinutes, origin, destination)).toBe(true);
      const restored = getRouteInfoFromRoute(reloaded.route)!;
      expect(restored.steps.filter(step => isTransitRideKind(step.type)).map(step => step.type))
        .toEqual(option.transitLegs!.filter(leg => isTransitRideKind(leg.kind)).map(leg => leg.kind));
      expect(restored.timeBasis).toBe('estimated');
      evidence.push({ kind, scheduleId: id, rideKinds: restored.steps.filter(step => isTransitRideKind(step.type)).map(step => step.type),
        source: 'CAPTURED_LIVE_TMAP', api: 'REAL_LOCAL_POST_GET', timeBasis: restored.timeBasis, passed: true });
    } finally {
      // This run's synthetic member and newly created schedule only; never touch other data.
      await call(`/api/schedules/${id}`, 'DELETE', undefined, token);
    }
  }
  const output = process.env.INTERCITY_E2E_OUTPUT!;
  expect(output.startsWith('/private/tmp/nolate-intercity-')).toBe(true);
  writeFileSync(output, JSON.stringify({ nativeUI: false, cases: evidence }, null, 2));
});
