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

jest.setTimeout(180000);

function call(path: string, method = 'GET', body?: unknown, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 5524, path, method,
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

import { buildIntercityJourney } from '../src/modules/schedule/intercityJourney';
import { resolveSelectedRouteTiming } from '../src/modules/schedule/scheduleRouteTiming';
import type { Place } from '../src/modules/schedule/types';
import { getImportedTicket, ticketRideService, type ImportedTrainTicket } from '../src/modules/schedule/importedTicket';

test('reviewed ticket import → live TMAP connections → database restore with fixed ticket times', async () => {
  const credentials = JSON.parse(readFileSync(process.env.INTERCITY_E2E_CREDENTIALS!, 'utf8'));
  expect(credentials.email).toMatch(/^xcuitest-.*@example\.test$/);
  const auth = await call('/api/member/auth/login', 'POST', { email: credentials.email, password: credentials.password });
  const token = auth.accessToken;
  const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
  const ticket: ImportedTrainTicket = { version: 1, id: 'ticket:12345678-1234-1234-1234-123456789012', kind: 'TRAIN', source: 'IOS_SHARE_IMAGE', verification: 'USER_CONFIRMED', bookingStatus: 'UNVERIFIED', departureName: '수서', arrivalName: '공주', departureAt: `${tomorrow}T12:20:00+09:00`, arrivalAt: `${tomorrow}T13:12:00+09:00`, trainNumber: '615', grade: 'SRT', confirmedAt: new Date().toISOString() };
  const categories = await call('/api/schedule-categories', 'GET', undefined, token);
  const category = categories.find((item: any) => item.shared !== true);
  const initial = { title: 'Ticket Import API E2E', startAt: ticket.arrivalAt, endAt: ticket.arrivalAt, hasEndTime: false, allDay: false, origin: { name: ticket.departureName }, destination: { name: ticket.arrivalName }, category: { id: category.id, title: category.title, color: category.color }, travelMode: 'TRANSIT', notificationEnabled: false, routeSetupRequired: true, route: { schemaVersion: 3, importedTicket: ticket } };
  const created = await call('/api/schedules', 'POST', initial, token);
  try {
    const pending = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
    expect(getImportedTicket(pending.route)).toEqual(ticket);
    expect(pending.travelPlanStatus).toBe('NOT_CONFIGURED');
    expect(pending.notificationEnabled).toBe(false);
    const targetArrivalAt = `${tomorrow}T20:00:00+09:00`;
    await call(`/api/schedules/${created.id}`, 'PUT', { ...initial, startAt: targetArrivalAt, endAt: targetArrivalAt }, token);
    const editedPending = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
    expect(getImportedTicket(editedPending.route)).toEqual(ticket);
    expect(editedPending.travelPlanStatus).toBe('NOT_CONFIGURED');
    expect(Date.parse(editedPending.startAt)).toBe(Date.parse(targetArrivalAt));
    const original = parseTransitOptionsFromTmap(captured).find(option => option.transitLegs?.some(leg => leg.kind === 'TRAIN'))!;
    const origin = { name: '서울남부터미널 E2E', lat: 37.4849, lng: 127.0167 };
    const destination = { name: '공주터미널 E2E', lat: 36.4600, lng: 127.1246 };
    let connectionRequests = 0;
    const search = async (from: Place, to: Place, mode: 'TRANSIT' | 'WALK', options: { departureAt: Date; searchFutureService: false }) => {
      expect(mode).toBe('TRANSIT'); connectionRequests++;
      const searchDttm = new Date(options.departureAt.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace(/[-T:]/g, '');
      const response = await call('/api/routes/transit', 'POST', { startX: String(from.lng), startY: String(from.lat), endX: String(to.lng), endY: String(to.lat), count: 10, lang: 0, format: 'json', searchDttm }, token);
      return parseTransitOptionsFromTmap(response).map(option => ({ ...option, mode: 'TRANSIT' as const, transitDepartureAt: options.departureAt.toISOString(), transitServiceState: 'unknown' as const }));
    };
    const connected = await buildIntercityJourney({ option: { ...original, mode: 'TRANSIT', importedTicket: ticket }, legIndex: original.transitLegs!.findIndex(leg => leg.kind === 'TRAIN'), origin, destination, selection: { service: ticketRideService(ticket), fetchedAt: ticket.confirmedAt, boardingBufferMinutes: 15, alightingBufferMinutes: 5, mappingConfirmed: true }, targetArrivalAt, search });
    const routeInfo = buildRouteInfoFromAlternative(connected, origin, destination);
    const route = { ...connected, schemaVersion: 3, routeInfo };
    await call(`/api/schedules/${created.id}`, 'PUT', { ...initial, startAt: targetArrivalAt, endAt: targetArrivalAt, origin, destination, travelMinutes: connected.minutes, departAt: routeInfo.departureTime, routeSetupRequired: false, route }, token);
    const restored = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
    expect(getImportedTicket(restored.route)).toEqual(ticket);
    expect(getRouteInfoFromRoute(restored.route)!.intercityJourney?.service.timingBasis).toBe('TICKET');
    const personal = { departAt: routeInfo.departureTime, travelMinutes: connected.minutes, travelMode: 'TRANSIT', origin, destination, route, notificationEnabled: false };
    await call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', personal, token);
    await expect(call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', { ...personal, departAt: new Date(Date.parse(routeInfo.departureTime) + 60000).toISOString() }, token)).rejects.toThrow('status 400');
    const altered = JSON.parse(JSON.stringify(route)); altered.importedTicket.trainNumber = '616';
    await expect(call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', { ...personal, route: altered }, token)).rejects.toThrow('status 400');
    const output = process.env.INTERCITY_E2E_OUTPUT!;
    expect(output.startsWith('/private/tmp/nolate-ticket-import-')).toBe(true);
    writeFileSync(output, JSON.stringify({ passed: true, nativeUI: false, input: 'SYNTHETIC_REVIEWED_TICKET', connections: 'LIVE_TMAP', connectionRequests, tagoRequests: 0, pendingDeadlineEdited: true, pendingTravelPlanStatus: editedPending.travelPlanStatus, ticket, route, shiftedDepartureRejected: true, mismatchedTicketRejected: true }, null, 2));
  } finally { await call(`/api/schedules/${created.id}`, 'DELETE', undefined, token); }
});

test.each([['TRAIN', 'NATH30000', 'NATH20438'], ['EXPRESS_BUS', 'NAEK010', 'NAEK320']] as const)('live TAGO %s selection + live TMAP connections → schedule DB → restored anchored journey', async (kind, departureId, arrivalId) => {
  const credentials = JSON.parse(readFileSync(process.env.INTERCITY_E2E_CREDENTIALS!, 'utf8'));
  expect(credentials.email).toMatch(/^xcuitest-.*@example\.test$/);
  const auth = await call('/api/member/auth/login', 'POST', { email: credentials.email, password: credentials.password });
  expect(auth.id).toBe(credentials.memberId);
  const token = auth.accessToken;
  const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
  const page = await call(`/api/intercity/services?kind=${kind}&departureId=${departureId}&arrivalId=${arrivalId}&date=${tomorrow}`, 'GET', undefined, token);
  expect(page.status).toBe('AVAILABLE');
  const service = page.items.find((item: any) => item.departureAt.slice(11, 16) >= '11:00' && item.departureAt.slice(11, 16) <= '14:00');
  expect(service).toBeDefined();
  const original = parseTransitOptionsFromTmap(captured).find(option => option.transitLegs?.some(leg => leg.kind === kind))!;
  const origin = { name: '서울남부터미널 E2E', lat: 37.4849, lng: 127.0167 };
  const destination = { name: '공주터미널 E2E', lat: 36.4600, lng: 127.1246 };
  const requests: any[] = [];
  const search = async (from: Place, to: Place, mode: 'TRANSIT' | 'WALK', options: { departureAt: Date; searchFutureService: false }) => {
    expect(mode).toBe('TRANSIT');
    const dttm = new Date(options.departureAt.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace(/[-T:]/g, '');
    const response = await call('/api/routes/transit', 'POST', { startX: String(from.lng), startY: String(from.lat), endX: String(to.lng), endY: String(to.lat), count: 10, lang: 0, format: 'json', searchDttm: dttm }, token);
    const parsed = parseTransitOptionsFromTmap(response).map(option => ({ ...option, mode: 'TRANSIT' as const, transitDepartureAt: options.departureAt.toISOString(), transitServiceState: option.transitLegs?.some(leg => leg.serviceAvailable === false) ? 'not_operating' as const : 'unknown' as const }));
    requests.push({ departureAt: options.departureAt.toISOString(), candidateCount: parsed.length });
    return parsed;
  };
  const targetArrivalAt = `${tomorrow}T20:00:00+09:00`;
  const option = await buildIntercityJourney({ option: { ...original, mode: 'TRANSIT' }, legIndex: original.transitLegs!.findIndex(leg => leg.kind === kind), origin, destination, selection: { service, fetchedAt: page.fetchedAt, boardingBufferMinutes: 15, alightingBufferMinutes: 5, mappingConfirmed: true }, targetArrivalAt, search });
  const routeInfo = buildRouteInfoFromAlternative(option, origin, destination);
  expect(resolveSelectedRouteTiming({ routeInfo, targetArrivalAt }).departureAt.toISOString()).toBe(option.intercityJourney!.departureAt);
  const route = { ...option, schemaVersion: 3, routeInfo };
  const categories = await call('/api/schedule-categories', 'GET', undefined, token);
  const category = categories[0];
  const payload = { title: 'Intercity Selection API E2E', startAt: targetArrivalAt, departAt: routeInfo.departureTime, allDay: false, hasEndTime: false, travelMode: 'TRANSIT', travelMinutes: option.minutes, origin, destination, category: { id: category.id, name: category.name, color: category.color }, route, notificationEnabled: false };
  const created = await call('/api/schedules', 'POST', payload, token);
  try {
    const reloaded = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
    expect(reloaded.route).toEqual(JSON.parse(JSON.stringify(route)));
    expect(Date.parse(reloaded.departAt)).toBe(Date.parse(routeInfo.departureTime));
    expect(reloaded.notificationEnabled).toBe(false);
    const restored = getRouteInfoFromRoute(reloaded.route)!;
    expect(restored.timeBasis).toBe('anchored_journey');
    expect(hasPersistableScheduleRoute(reloaded.route, reloaded.travelMinutes, origin, destination)).toBe(true);
    expect(restored.steps.filter(step => isTransitRideKind(step.type)).map(step => step.type)).toEqual(option.transitLegs!.filter(leg => isTransitRideKind(leg.kind)).map(leg => leg.kind));
    expect(restored.steps.find(step => step.type === kind)!.intercityService).toEqual(service);
    expect(restored.steps.filter(step => step.type === 'TRANSFER')).toHaveLength(2);
    const personal = { departAt: new Date(Date.parse(routeInfo.departureTime) + 3600000).toISOString(), travelMinutes: option.minutes, travelMode: 'TRANSIT', origin, destination, route, notificationEnabled: false };
    const validPlan = await call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', { ...personal, departAt: routeInfo.departureTime }, token);
    expect(Date.parse(validPlan.departAt)).toBe(Date.parse(routeInfo.departureTime));
    await expect(call(`/api/schedules/${created.id}/travel-plans/my`, 'PUT', personal, token)).rejects.toThrow('status 400');
    const unchanged = await call(`/api/schedules/${created.id}`, 'GET', undefined, token);
    expect(Date.parse(unchanged.departAt)).toBe(Date.parse(routeInfo.departureTime));
    const evidence = { nativeUI: false, timetable: 'LIVE_TAGO', connections: 'LIVE_TMAP', selectedService: service, requests, route, api: 'REAL_LOCAL_POST_DB_GET', shiftedDepartureRejected: true, passed: true };
    const output = process.env.INTERCITY_E2E_OUTPUT!.replace(/\.json$/, `-${kind}.json`);
    expect(output.startsWith('/private/tmp/nolate-intercity-')).toBe(true);
    writeFileSync(output, JSON.stringify(evidence, null, 2));
  } finally { await call(`/api/schedules/${created.id}`, 'DELETE', undefined, token); }
});
