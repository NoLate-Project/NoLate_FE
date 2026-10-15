jest.mock('../src/routeSupport/schedule/RouteSelectAnimatedControls', () => ({ ROUTE_SEGMENT_FALLBACK_COLORS: { walk: '#aaa', etc: '#bbb' } }));
jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));
import { buildRouteDropdownSummaryItems, buildRouteProgressSegments } from '../src/routeSupport/schedule/routeSelectRouteModel';
import { buildIntercityJourney } from '../src/modules/schedule/intercityJourney';
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from '../src/modules/schedule/routeInfo';
import { reconcileScheduleRouteTiming, resolveSelectedRouteTiming } from '../src/modules/schedule/scheduleRouteTiming';
import { buildRouteInfoFromNormalizedRoute } from '../src/modules/schedule/routePlanner/routePlannerRouteInfo';
import { normalizeRouteAlternativeToSegments } from '../src/modules/schedule/routePlanner/routeTransitGeometryBuilder';
import type { RouteAlternativeOption } from '../src/modules/map/tmapApiCore';
import type { IntercityService } from '../src/api/intercityTimetable';
const now = new Date('2026-10-12T08:00:00+09:00');
const origin = { name: '출발', lat: 37.48, lng: 127.01 };
const destination = { name: '목적지', lat: 36.46, lng: 127.12 };
const service: IntercityService = { id: 'tago:test', kind: 'TRAIN', departureId: 'NATH30000', arrivalId: 'NATH20438', departureName: '수서', arrivalName: '공주', departureAt: '2026-10-12T11:00:00+09:00', arrivalAt: '2026-10-12T12:00:00+09:00', serviceDate: '2026-10-12', grade: 'KTX', trainNumber: '123', fare: 21600, timingBasis: 'TIMETABLE', bookingStatus: 'UNCONFIRMED' };
const option: RouteAlternativeOption = { id: 'original', mode: 'TRANSIT', source: 'api', provider: 'tmap', minutes: 110, transitLegs: [
    { kind: 'BUS', label: '접근', durationSeconds: 1200 },
    { kind: 'TRAIN', label: '원래 추정 열차', durationSeconds: 3600, startName: '수서', endName: '공주', startCoord: { lat: 37.487, lng: 127.101 }, endCoord: { lat: 36.332, lng: 127.139 }, boardingPlatform: 'old', startID: 'old-provider-id', pathCoords: [{ lat: 37.487, lng: 127.101 }, { lat: 36.332, lng: 127.139 }], pathCoordsIsExact: true },
    { kind: 'BUS', label: '도착 후', durationSeconds: 1800 },
] };
const selection = { service, fetchedAt: now.toISOString(), boardingBufferMinutes: 15, alightingBufferMinutes: 5, mappingConfirmed: true };
function connection(durationSeconds = 1200): RouteAlternativeOption {
    return { id: 'connection', mode: 'TRANSIT', source: 'api', provider: 'tmap', totalDurationSeconds: durationSeconds, transitServiceState: 'unknown', transitLegs: [{ kind: 'BUS', label: '연결 버스', durationSeconds, startName: 'A', endName: 'B' }] };
}
function args(search = jest.fn().mockResolvedValue([connection()])) { return { option, legIndex: 1, origin, destination, selection, search, now, targetArrivalAt: '2026-10-12T14:00:00+09:00' }; }

test('chosen service anchors approach, boarding preparation and egress without claiming a booking or total fare', async () => {
    const input = args(); const route = await buildIntercityJourney(input);
    expect(input.search).toHaveBeenCalledTimes(2);
    expect(input.search.mock.calls[0][3]).toEqual({ departureAt: new Date('2026-10-12T10:25:00+09:00'), searchFutureService: false });
    expect(input.search.mock.calls[1][3].departureAt).toEqual(new Date('2026-10-12T12:05:00+09:00'));
    expect(route.intercityJourney!.arrivalAt).toBe('2026-10-12T03:25:00.000Z');
    const fixed = route.transitLegs!.find(leg => leg.kind === 'TRAIN')!;
    expect(Date.parse(fixed.startDateTime!)).toBe(Date.parse(service.departureAt));
    expect(fixed.intercityService).toEqual(service);
    expect(fixed.boardingPlatform).toBeUndefined(); expect(fixed.startID).toBeUndefined();
    expect(fixed.pathCoordsIsExact).toBe(false);
    expect(route.transitLegs!.filter(leg => leg.journeyPhase === 'BUFFER').map(leg => leg.durationSeconds)).toEqual([900, 300]);
    expect(route.providerTimeBasis).toBe('route_estimate'); expect(route.fareWon).toBeUndefined();
    expect(option.transitLegs![1].boardingPlatform).toBe('old');
});

test('bounded re-query uses an earlier real request when the approach misses the boarding deadline', async () => {
    const search = jest.fn().mockResolvedValueOnce([connection(1800)]).mockResolvedValueOnce([connection(1740)]).mockResolvedValueOnce([connection(900)]);
    const route = await buildIntercityJourney(args(search));
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls[1][3].departureAt).toEqual(new Date('2026-10-12T10:14:00+09:00'));
    expect(route.transitLegs![1].durationSeconds).toBe(1020);
});

test('serialization, map normalization, schedule selection and an appointment edit preserve the fixed service', async () => {
    const route = await buildIntercityJourney(args());
    const info = buildRouteInfoFromAlternative(route, origin, destination);
    const normalizedInfo = buildRouteInfoFromNormalizedRoute(info, normalizeRouteAlternativeToSegments(route));
    const stored = JSON.parse(JSON.stringify({ ...route, schemaVersion: 3, routeInfo: normalizedInfo }));
    const restored = getRouteInfoFromRoute(stored)!;
    expect(restored.timeBasis).toBe('anchored_journey');
    expect(restored.steps.find(step => step.type === 'TRAIN')!.intercityService).toEqual(service);
    expect(restored.steps.filter(step => step.type === 'TRANSFER')).toHaveLength(2);
    const timing = resolveSelectedRouteTiming({ routeInfo: restored, targetArrivalAt: '2026-10-12T20:00:00+09:00' });
    expect(timing.departureAt.toISOString()).toBe(route.intercityJourney!.departureAt);
    const edit = reconcileScheduleRouteTiming({ route: stored, departAt: restored.departureTime, plannedArrivalAt: '2026-10-12T14:00:00+09:00', nextArrivalAt: '2026-10-12T10:00:00+09:00' });
    expect(edit.route).toBe(stored); expect(edit.departAt).toBe(restored.departureTime);
});

test.each([
    ['mapping not confirmed', { mappingConfirmed: false }],
    ['no boarding margin', { boardingBufferMinutes: 0 }],
    ['negative alighting margin', { alightingBufferMinutes: -1 }],
    ['stale timetable', { fetchedAt: '2026-10-12T07:00:00+09:00' }],
    ['invalid provider timestamp', { fetchedAt: 'invalid' }],
])('%s fails before provider calls', async (_, changes) => {
    const input = args(); input.selection = { ...selection, ...changes };
    await expect(buildIntercityJourney(input)).rejects.toThrow(); expect(input.search).not.toHaveBeenCalled();
});

test.each(['fallback', 'future_hop', 'closed', 'intercity_connection', 'missing_duration', 'unexplained_seconds'] as const)('rejects %s connections without replacing the selected service', async kind => {
    let value = connection();
    if (kind === 'fallback') value = { ...value, source: 'fallback' };
    if (kind === 'future_hop') value.transitDepartureTimeSource = 'next_service_search';
    if (kind === 'closed') value.transitServiceState = 'not_operating';
    if (kind === 'intercity_connection') value.transitLegs![0].kind = 'TRAIN';
    if (kind === 'missing_duration') value.totalDurationSeconds = undefined;
    if (kind === 'unexplained_seconds') value.totalDurationSeconds = 1210;
    await expect(buildIntercityJourney(args(jest.fn().mockResolvedValue([value])))).rejects.toThrow();
});

test('does not apply a route that arrives after the appointment', async () => {
    await expect(buildIntercityJourney({ ...args(), targetArrivalAt: '2026-10-12T12:10:00+09:00' })).rejects.toThrow('일정 시작');
});
test('keeps overnight dates and second precision', async () => {
    const route = await buildIntercityJourney({ ...args(), selection: { ...selection, service: { ...service, departureAt: '2026-10-12T23:30:00+09:00', arrivalAt: '2026-10-13T01:00:37+09:00' } }, targetArrivalAt: '2026-10-13T03:00:00+09:00' });
    expect(route.intercityJourney!.arrivalAt).toBe('2026-10-12T16:25:37.000Z');
    expect(route.transitLegs!.find(leg => leg.kind === 'TRAIN')!.durationSeconds).toBe(5437);
});
test('missing station coordinates and multiple intercity rides require a different route', async () => {
    const input = args();
    await expect(buildIntercityJourney({ ...input, option: { ...option, transitLegs: [...option.transitLegs!, option.transitLegs![1]] } })).rejects.toThrow('한 개');
    await expect(buildIntercityJourney({ ...input, option: { ...option, transitLegs: option.transitLegs!.map((leg, index) => index === 1 ? { ...leg, startCoord: undefined } : leg) } })).rejects.toThrow('좌표');
    expect(input.search).not.toHaveBeenCalled();
});

test('boarding buffers have preparation labels without becoming walking or rides', async () => {
    const route = await buildIntercityJourney(args());
    const dropdown = buildRouteDropdownSummaryItems(route, origin.name, destination.name);
    expect(dropdown.filter(item => item.kind === 'TRANSFER').map(item => item.title)).toEqual(['탑승 준비·대기 (준비 15분 포함) · 15분', '하차 후 여유 · 5분']);
    expect(dropdown.find(item => item.kind === 'TRAIN')!.subtitle).toContain('11:00 → 12:00 · 예매 미확인');
    expect(buildRouteProgressSegments(route).filter(item => item.kind === 'TRANSFER').every(item => !item.isRide && !item.lineLabel)).toBe(true);
});
test('walking connection attribution survives composition', async () => {
    const board = option.transitLegs![1].startCoord!;
    const end = option.transitLegs![1].endCoord!;
    const search = jest.fn().mockResolvedValue([{ id: 'walk', mode: 'WALK', source: 'api', provider: 'openstreetmap', minutes: 2, totalDurationSeconds: 120, pathCoords: [board, { ...board, lat: board.lat + .001 }], attributionText: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright' }]);
    const route = await buildIntercityJourney({ ...args(search), origin: { ...board, lat: board.lat + .001 }, destination: end });
    expect(search).toHaveBeenCalledTimes(1);
    expect(route.provider).toBe('openstreetmap');
    expect(route.attributionUrl).toBe('https://www.openstreetmap.org/copyright');
});

test('reselecting a service does not count the previous boarding buffer twice', async () => {
    const original = await buildIntercityJourney(args());
    const search = jest.fn().mockResolvedValue([connection()]);
    await buildIntercityJourney({ ...args(search), option: original, legIndex: original.transitLegs!.findIndex(leg => leg.kind === 'TRAIN'), selection: { ...selection, service: { ...service, departureAt: '2026-10-12T13:00:00+09:00', arrivalAt: '2026-10-12T14:00:00+09:00' } }, targetArrivalAt: '2026-10-12T16:00:00+09:00' });
    expect(search.mock.calls[0][3].departureAt).toEqual(new Date('2026-10-12T12:25:00+09:00'));
});
