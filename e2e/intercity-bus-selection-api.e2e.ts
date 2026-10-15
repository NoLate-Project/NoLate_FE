/** Opt-in local API test of a captured real intercity-bus response; not a screen E2E. */
jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));

const { readFileSync, writeFileSync } = require('fs');
const http = require('http');
import { parseTmapRoadRouteResponse, parseTransitOptionsFromTmap } from '../src/modules/map/tmapApi';
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

import { buildIntercityJourney } from '../src/modules/schedule/intercityJourney';
import { resolveSelectedRouteTiming } from '../src/modules/schedule/scheduleRouteTiming';
import type { Place } from '../src/modules/schedule/types';
const https = require('https');

function walk(from: Place, to: Place): Promise<any> {
    const propertyPath = process.env.INTERCITY_BUS_E2E_TMAP_PROPERTIES;
    expect(propertyPath).toMatch(/^\/private\/tmp\/nolate-intercity-/);
    const properties = readFileSync(propertyPath, 'utf8');
    const key = properties.split('\n').find((line: string) => line.startsWith('routing.tmap.app-key='))?.split('=').slice(1).join('=').trim();
    expect(key).toBeTruthy();
    const payload = new URLSearchParams({ startX: String(from.lng), startY: String(from.lat), endX: String(to.lng), endY: String(to.lat), startName: from.name ?? "출발", endName: to.name ?? "도착", reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json', {
            method: 'POST', headers: { appKey: key, 'Content-Type': 'application/x-www-form-urlencoded' },
        }, (response: any) => {
            let raw = ''; response.setEncoding('utf8'); response.on('data', (chunk: string) => { raw += chunk; });
            response.on('end', () => {
                if (response.statusCode !== 200) { reject(new Error(`Live pedestrian API status ${response.statusCode}`)); return; }
                try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid pedestrian response')); }
            });
        });
        req.on('error', () => reject(new Error('Pedestrian API connection failed')));
        req.setTimeout(20000, () => req.destroy(new Error('Pedestrian API timeout'))); req.end(payload);
    });
}

test('live TAGO overnight INTERCITY_BUS → live walking connections → database restore with fixed service times', async () => {
    for (const key of ['INTERCITY_BUS_E2E_CREDENTIALS', 'INTERCITY_BUS_E2E_RESPONSE', 'INTERCITY_BUS_E2E_PLACES', 'INTERCITY_BUS_E2E_OUTPUT']) {
        expect(process.env[key]).toMatch(/^\/private\/tmp\/nolate-intercity-bus-selection-/);
    }
    const credentials = JSON.parse(readFileSync(process.env.INTERCITY_BUS_E2E_CREDENTIALS, 'utf8'));
    expect(credentials.email).toMatch(/^xcuitest-intercity-bus-selection-api-.*@example\.test$/);
    const auth = await call('/api/member/auth/login', 'POST', { email: credentials.email, password: credentials.password });
    expect(auth.id).toBe(credentials.memberId); const token = auth.accessToken;
    const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const page = await call(`/api/intercity/services?kind=INTERCITY_BUS&departureId=NAI2238202&arrivalId=NAI2839701&date=${date}`, 'GET', undefined, token);
    expect(page.status).toBe('AVAILABLE');
    const service = page.items.find((row: any) => row.departureAt.slice(11, 16) === '23:00' && Date.parse(row.departureAt) > Date.now() + 20 * 60000);
    expect(service).toBeDefined(); expect(service.bookingStatus).toBe('UNCONFIRMED');
    expect(service.arrivalAt.slice(0, 10)).not.toBe(service.serviceDate);
    const captured = JSON.parse(readFileSync(process.env.INTERCITY_BUS_E2E_RESPONSE, 'utf8'));
    const original = parseTransitOptionsFromTmap(captured).find(option => {
        const rides = option.transitLegs?.filter(leg => isTransitRideKind(leg.kind));
        return rides?.length === 1 && rides[0].kind === 'INTERCITY_BUS' && rides[0].lineName?.includes('인천공항T2-청주');
    });
    expect(original).toBeDefined();
    const places = Object.values(JSON.parse(readFileSync(process.env.INTERCITY_BUS_E2E_PLACES, 'utf8'))) as Place[];
    const origin = places[0];
    // A second real POI returned by the terminal query, so both external walks are exercised.
    const destination = { name: '청주시외버스터미널 환승주차장', lat: 36.62509886, lng: 127.43350618 };
    const requests: any[] = [];
    const search = async (from: Place, to: Place, mode: 'TRANSIT' | 'WALK', options: { departureAt: Date; searchFutureService: false }) => {
        expect(mode).toBe('WALK'); expect(options.searchFutureService).toBe(false);
        const response = await walk(from, to); const parsed = parseTmapRoadRouteResponse(response);
        const seconds = response.features.find((f: any) => Number.isInteger(f.properties?.totalTime))?.properties.totalTime;
        expect(seconds).toBeGreaterThan(0); expect(parsed.pathCoords!.length).toBeGreaterThanOrEqual(2);
        requests.push({ origin: from, destination: to, departureAt: options.departureAt.toISOString(), seconds });
        return [{ id: `live-walk-${requests.length}`, mode: 'WALK' as const, source: 'api' as const, provider: 'tmap' as const, minutes: Math.ceil(seconds / 60), totalDurationSeconds: seconds, pathCoords: parsed.pathCoords, distanceMeters: parsed.distanceMeters }];
    };
    const targetArrivalAt = new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 27 * 3600000).toISOString();
    const connected = await buildIntercityJourney({ option: { ...original!, mode: 'TRANSIT' }, legIndex: original!.transitLegs!.findIndex(leg => leg.kind === 'INTERCITY_BUS'), origin, destination,
        selection: { service, fetchedAt: page.fetchedAt, boardingBufferMinutes: 15, alightingBufferMinutes: 5, mappingConfirmed: true }, targetArrivalAt, search });
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const routeInfo = buildRouteInfoFromAlternative(connected, origin, destination);
    expect(resolveSelectedRouteTiming({ routeInfo, targetArrivalAt }).departureAt.toISOString()).toBe(connected.intercityJourney!.departureAt);
    const route = { ...connected, schemaVersion: 3, routeInfo };
    const categories = await call('/api/schedule-categories', 'GET', undefined, token); const category = categories.find((row: any) => row.shared !== true);
    const created = await call('/api/schedules', 'POST', { title: 'Overnight Intercity Bus Selection API E2E', startAt: targetArrivalAt, departAt: routeInfo.departureTime, allDay: false, hasEndTime: false, travelMode: 'TRANSIT', travelMinutes: connected.minutes, origin, destination, category: { id: category.id, title: category.title, color: category.color }, route, notificationEnabled: false }, token);
    try {
        const saved = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
        expect(saved.route).toEqual(JSON.parse(JSON.stringify(route))); expect(saved.travelPlanStatus).toBe('READY'); expect(saved.notificationEnabled).toBe(false);
        const restored = getRouteInfoFromRoute(saved.route)!; expect(restored.timeBasis).toBe('anchored_journey');
        expect(hasPersistableScheduleRoute(saved.route, saved.travelMinutes, origin, destination)).toBe(true);
        const ride = restored.steps.find(step => step.type === 'INTERCITY_BUS')!; expect(ride.intercityService).toEqual(service);
        expect(restored.steps.filter(step => step.type === 'TRANSFER')).toHaveLength(2);
        const personal = { departAt: routeInfo.departureTime, travelMinutes: connected.minutes, travelMode: 'TRANSIT', origin, destination, route, notificationEnabled: false };
        await call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', personal, token);
        await expect(call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', { ...personal, departAt: new Date(Date.parse(routeInfo.departureTime) + 60000).toISOString() }, token)).rejects.toThrow(': 400');
        const unchanged = await call(`/api/schedules/${created.id}`, 'GET', undefined, token); expect(Date.parse(unchanged.departAt)).toBe(Date.parse(routeInfo.departureTime));
        writeFileSync(process.env.INTERCITY_BUS_E2E_OUTPUT, JSON.stringify({ passed: true, nativeUI: false, timetable: 'LIVE_TAGO', initialRoute: 'CAPTURED_REAL_TMAP', connections: 'LIVE_TMAP_PEDESTRIAN', scheduleId: created.id, selectedService: service, requests, route, shiftedDepartureRejected: true, cleanup: 'Only this API case schedule deleted' }, null, 2));
    } finally { await call(`/api/schedules/${created.id}`, 'DELETE', undefined, token); }
});
