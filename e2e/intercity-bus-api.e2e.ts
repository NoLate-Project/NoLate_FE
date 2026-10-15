/** Opt-in local API test of a captured real intercity-bus response; not a screen E2E. */
jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));

const { readFileSync, writeFileSync } = require('fs');
const http = require('http');
import { parseTransitOptionsFromTmap } from '../src/modules/map/tmapApi';
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from '../src/modules/schedule/routeInfo';
import { hasPersistableScheduleRoute } from '../src/modules/schedule/scheduleRouteTiming';
import { isTransitRideKind } from '../src/modules/map/transitModes';

jest.setTimeout(60000);

function call(path: string, method = 'GET', body?: unknown, token?: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port: 5524, path, method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        }, (response: any) => {
            let raw = ''; response.setEncoding('utf8');
            response.on('data', (chunk: string) => { raw += chunk; });
            response.on('end', () => {
                try {
                    const envelope = JSON.parse(raw);
                    if (response.statusCode >= 400 || envelope.success !== true) {
                        reject(new Error(`Local bus API ${method} ${path}: ${response.statusCode}`));
                    } else resolve(envelope.data);
                } catch (error) { reject(error); }
            });
        });
        request.on('error', reject);
        request.setTimeout(15000, () => request.destroy(new Error('Local bus API timeout')));
        request.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

test('live TMAP type22 → INTERCITY_BUS → normal authenticated save → database read → FE restore', async () => {
    const paths = ['INTERCITY_BUS_E2E_CREDENTIALS', 'INTERCITY_BUS_E2E_RESPONSE', 'INTERCITY_BUS_E2E_PLACES', 'INTERCITY_BUS_E2E_OUTPUT'] as const;
    for (const key of paths) expect(process.env[key]).toMatch(/^\/private\/tmp\/nolate-intercity-bus-/);
    const credentials = JSON.parse(readFileSync(process.env.INTERCITY_BUS_E2E_CREDENTIALS, 'utf8'));
    expect(credentials.email).toMatch(/^xcuitest-intercity-bus-api-.*@example\.test$/);
    const captured = JSON.parse(readFileSync(process.env.INTERCITY_BUS_E2E_RESPONSE, 'utf8'));
    const places = Object.values(JSON.parse(readFileSync(process.env.INTERCITY_BUS_E2E_PLACES, 'utf8'))) as { name: string; lat: number; lng: number }[];
    const [origin, destination] = places;
    const raw = captured.metaData.plan.itineraries.find((route: any) => route.legs.some((leg: any) =>
        leg.mode === 'EXPRESSBUS' && leg.type === 22 && leg.service === 1));
    expect(raw).toBeDefined();
    const options = parseTransitOptionsFromTmap({ metaData: { plan: { itineraries: [raw] } } });
    expect(options).toHaveLength(1);
    const option = { ...options[0], mode: 'TRANSIT' as const };
    const bus = option.transitLegs!.filter(leg => leg.kind === 'INTERCITY_BUS');
    expect(bus).toHaveLength(1);
    expect(bus[0].lineName).toContain('동서울-속초');
    expect(bus[0].serviceAvailable).toBe(true);
    expect(option.transitLegs!.filter(leg => isTransitRideKind(leg.kind)).map(leg => leg.kind)).toEqual(['INTERCITY_BUS']);
    const auth = await call('/api/member/auth/login', 'POST', { email: credentials.email, password: credentials.password });
    expect(auth.id).toBe(credentials.memberId);
    const token = auth.accessToken;
    const categories = await call('/api/schedule-categories', 'GET', undefined, token);
    const category = categories.find((item: any) => item.shared !== true);
    expect(category).toBeDefined();
    const departure = new Date(); departure.setDate(departure.getDate() + 1); departure.setHours(10, 0, 0, 0);
    const routeInfo = buildRouteInfoFromAlternative(option, origin, destination, departure);
    const route = { ...option, schemaVersion: 2, routeInfo };
    const saved = await call('/api/schedules', 'POST', {
        title: 'Intercity Bus API E2E', startAt: routeInfo.arrivalTime, departAt: routeInfo.departureTime,
        allDay: false, hasEndTime: false, travelMode: 'TRANSIT', travelMinutes: option.minutes,
        origin, destination, category: { id: category.id, title: category.title, color: category.color },
        route, notificationEnabled: false,
    }, token);
    try {
        const reloaded = await call(`/api/schedules/${saved.id}`, 'GET', undefined, token);
        expect(reloaded.route).toEqual(JSON.parse(JSON.stringify(route)));
        expect(reloaded.notificationEnabled).toBe(false);
        expect(reloaded.travelPlanStatus).toBe('READY');
        expect(hasPersistableScheduleRoute(reloaded.route, reloaded.travelMinutes, origin, destination)).toBe(true);
        const restored = getRouteInfoFromRoute(reloaded.route)!;
        expect(restored.steps.filter(step => isTransitRideKind(step.type)).map(step => step.type)).toEqual(['INTERCITY_BUS']);
        expect(restored.timeBasis).toBe('estimated');
        const ride = restored.steps.find(step => step.type === 'INTERCITY_BUS')!;
        expect(ride.durationMinutes).toBeGreaterThan(0);
        writeFileSync(process.env.INTERCITY_BUS_E2E_OUTPUT, JSON.stringify({ passed: true,
            source: 'CAPTURED_REAL_TMAP_TYPE22_SERVICE1', nativeUI: false, scheduleId: saved.id,
            routeName: bus[0].lineName, rawRideMode: 'EXPRESSBUS', rawRideType: 22,
            savedKind: 'INTERCITY_BUS', restoredKinds: restored.steps.map(step => step.type),
            timingBasis: restored.timeBasis, notificationEnabled: reloaded.notificationEnabled,
            travelPlanStatus: reloaded.travelPlanStatus, cleanup: 'Only the schedule created by this API case is deleted',
        }, null, 2));
    } finally { await call(`/api/schedules/${saved.id}`, 'DELETE', undefined, token); }
});
