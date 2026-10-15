/** Opt-in local API test of a captured real intercity-bus response; not a screen E2E. */
jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));

const { readFileSync, writeFileSync } = require('fs');
const http = require('http');
import { parseTmapRoadRouteResponse, parseTransitOptionsFromTmap } from '../src/modules/map/tmapApi';
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from '../src/modules/schedule/routeInfo';
import { hasPersistableScheduleRoute } from '../src/modules/schedule/scheduleRouteTiming';
import { getImportedTicket, ticketRideService, type ImportedTicket } from '../src/modules/schedule/importedTicket';
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
    const propertyPath = process.env.TICKET_COMPLETION_TMAP_PROPERTIES;
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

test.each(['IOS_SHARE_TEXT', 'IOS_SHARE_PDF'] as const)('reviewed bus %s → duplicate protection → live connections → fixed schedule restore', async source => {
    const root = process.env.TICKET_COMPLETION_E2E_ROOT!;
    expect(root).toMatch(/^\/private\/tmp\/nolate-ticket-completion-/);
    const credentials = JSON.parse(readFileSync(`${root}/credentials-api.json`, 'utf8'));
    expect(credentials.email).toMatch(/^xcuitest-ticket-completion-api-.*@example\.test$/);
    const auth = await call('/api/member/auth/login', 'POST', { email: credentials.email, password: credentials.password });
    expect(auth.id).toBe(credentials.memberId); const token = auth.accessToken;
    const date = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
    const following = new Date(Date.now() + 9 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
    const ticket: ImportedTicket = { version: 1, id: `ticket:${source === 'IOS_SHARE_TEXT' ? '12345678' : '22345678'}-1234-1234-1234-123456789012`, kind: 'INTERCITY_BUS', source, verification: 'USER_CONFIRMED', bookingStatus: 'UNVERIFIED', departureName: '인천공항2터미널', arrivalName: '청주', departureAt: `${date}T23:00:00+09:00`, arrivalAt: `${following}T01:25:00+09:00`, grade: source === 'IOS_SHARE_TEXT' ? '우등' : '심야우등', confirmedAt: new Date().toISOString() };
    const category = (await call('/api/schedule-categories', 'GET', undefined, token)).find((row: any) => row.shared !== true);
    const initial = { title: 'Bus Ticket Completion API E2E', startAt: ticket.arrivalAt, endAt: ticket.arrivalAt, allDay: false, hasEndTime: false, travelMode: 'TRANSIT', origin: { name: ticket.departureName }, destination: { name: ticket.arrivalName }, category: { id: category.id, title: category.title, color: category.color }, route: { schemaVersion: 3, importedTicket: ticket }, notificationEnabled: false, routeSetupRequired: true };
    // Member creation fence serializes concurrent duplicate shares, including independent ticket UUIDs.
    const replay = { ...initial, route: { ...initial.route, importedTicket: { ...ticket, id: 'ticket:33345678-1234-1234-1234-123456789012', source: 'IOS_SHARE_IMAGE' } } };
    const concurrent = await Promise.allSettled([call('/api/schedules', 'POST', initial, token), call('/api/schedules', 'POST', replay, token)]);
    expect(concurrent.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter(item => item.status === 'rejected')).toHaveLength(1);
    const created = (concurrent.find(item => item.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    const storedTicket = getImportedTicket(created.route)!;
    expect(storedTicket).toBeDefined();
    const pending = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
    expect(pending.travelPlanStatus).toBe('NOT_CONFIGURED');
    const responsePath = process.env.TICKET_COMPLETION_RESPONSE!;
    expect(responsePath).toMatch(/^\/private\/tmp\/nolate-intercity-/);
    const captured = JSON.parse(readFileSync(responsePath, 'utf8'));
    const original = parseTransitOptionsFromTmap(captured).find(option => {
        const rides = option.transitLegs?.filter(leg => isTransitRideKind(leg.kind));
        return rides?.length === 1 && rides[0].kind === 'INTERCITY_BUS' && rides[0].lineName?.includes('인천공항T2-청주');
    })!;
    expect(original).toBeDefined();
    const origin = { name: '인천국제공항 제2여객터미널 E2E', lat: 37.46792821, lng: 126.43237916 };
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
    try {
        const targetArrivalAt = `${following}T03:00:00+09:00`;
        const connected = await buildIntercityJourney({ option: { ...original, mode: 'TRANSIT', importedTicket: storedTicket }, legIndex: original.transitLegs!.findIndex(leg => leg.kind === 'INTERCITY_BUS'), origin, destination,
            selection: { service: ticketRideService(storedTicket), fetchedAt: storedTicket.confirmedAt, boardingBufferMinutes: 15, alightingBufferMinutes: 5, mappingConfirmed: true }, targetArrivalAt, search });
        expect(requests.length).toBeGreaterThanOrEqual(2);
        const routeInfo = buildRouteInfoFromAlternative(connected, origin, destination);
        expect(resolveSelectedRouteTiming({ routeInfo, targetArrivalAt }).departureAt.toISOString()).toBe(connected.intercityJourney!.departureAt);
        const route = { ...connected, schemaVersion: 3, routeInfo };
        const personal = { departAt: routeInfo.departureTime, travelMinutes: connected.minutes, travelMode: 'TRANSIT', origin, destination, route, notificationEnabled: false };
        await call(`/api/schedules/${created.id}`, 'PUT', { ...initial, ...personal, startAt: targetArrivalAt, endAt: targetArrivalAt, routeSetupRequired: false }, token);
        const saved = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
        expect(saved.route).toEqual(JSON.parse(JSON.stringify(route))); expect(saved.travelPlanStatus).toBe('READY'); expect(saved.notificationEnabled).toBe(false);
        const restored = getRouteInfoFromRoute(saved.route)!; expect(restored.timeBasis).toBe('anchored_journey');
        const status = await call(`/api/schedules/${created.id}/departure-status`, 'GET', undefined, token);
        expect(Date.parse(status.recommendedDepartureAt)).toBe(Date.parse(routeInfo.departureTime));
        expect(status.stale).toBe(true); expect(status.confidence).toBe('LOW');
        expect(hasPersistableScheduleRoute(saved.route, saved.travelMinutes, origin, destination)).toBe(true);
        expect(restored.steps.find(step => step.type === 'INTERCITY_BUS')!.intercityService).toEqual(ticketRideService(storedTicket));
        await expect(call('/api/schedules', 'POST', replay, token)).rejects.toThrow(': 400');
        await expect(call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', { ...personal, departAt: new Date(Date.parse(routeInfo.departureTime) + 60000).toISOString() }, token)).rejects.toThrow(': 400');
        const mismatch = JSON.parse(JSON.stringify(route)); mismatch.importedTicket.grade = '일반';
        await expect(call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', { ...personal, route: mismatch }, token)).rejects.toThrow(': 400');
        const unchanged = await call(`/api/schedules/${created.id}`, 'GET', undefined, token); expect(unchanged.route).toEqual(JSON.parse(JSON.stringify(route)));
        writeFileSync(`${root}/api-${source}.json`, JSON.stringify({ passed: true, nativeUI: false, input: 'SYNTHETIC_REVIEWED_BUS_TICKET', initialRoute: 'CAPTURED_REAL_TMAP', connections: 'LIVE_TMAP_PEDESTRIAN', tagoRequests: 0, requests, route, concurrentDuplicateRejected: true, duplicateAfterConnectionRejected: true, shiftedDepartureRejected: true, mismatchedGradeRejected: true, departureStatusPreservesAnchor: true, departureConfidence: status.confidence }, null, 2));
    } finally { await call(`/api/schedules/${created.id}`, 'DELETE', undefined, token); }
    const reimported = await call('/api/schedules', 'POST', initial, token);
    await call(`/api/schedules/${reimported.id}`, 'DELETE', undefined, token);
    expect(await call('/api/schedules', 'GET', undefined, token)).toHaveLength(0);
});
