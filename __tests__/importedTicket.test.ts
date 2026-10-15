jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));
import { assertTicketService, getImportedTicket, ticketRideService, type ImportedTrainTicket } from '../src/modules/schedule/importedTicket';
import { buildIntercityJourney } from '../src/modules/schedule/intercityJourney';
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from '../src/modules/schedule/routeInfo';
import type { RouteAlternativeOption } from '../src/modules/map/tmapApiCore';

const ticket: ImportedTrainTicket = { version: 1, id: 'ticket:12345678-1234-1234-1234-123456789012', kind: 'TRAIN', source: 'IOS_SHARE_IMAGE', verification: 'USER_CONFIRMED', bookingStatus: 'UNVERIFIED', departureName: '서울', arrivalName: '부산', departureAt: '2026-10-13T11:00:00+09:00', arrivalAt: '2026-10-13T13:40:00+09:00', trainNumber: '123', grade: 'KTX', confirmedAt: '2026-10-12T00:00:00Z' };
const now = new Date('2026-10-13T08:00:00+09:00');
const origin = { name: '출발역', lat: 37.55, lng: 126.97 };
const destination = { name: '도착역', lat: 35.11, lng: 129.04 };
const original: RouteAlternativeOption = { id: 'train-corridor', mode: 'TRANSIT', source: 'api', provider: 'tmap', importedTicket: ticket, transitLegs: [{ kind: 'TRAIN', label: '추정 열차', durationSeconds: 9600, startCoord: origin, endCoord: destination, startName: '서울역', endName: '부산역' }] };
const args = () => ({ option: original, legIndex: 0, origin, destination, now, targetArrivalAt: ticket.arrivalAt, search: jest.fn(), selection: { service: ticketRideService(ticket), fetchedAt: ticket.confirmedAt, boardingBufferMinutes: 15, alightingBufferMinutes: 0, mappingConfirmed: true } });

test('reviewed ticket works without TAGO lookup or timetable freshness and survives serialization', async () => {
    const input = args(); const connected = await buildIntercityJourney(input);
    expect(input.search).not.toHaveBeenCalled();
    expect(connected.importedTicket).toEqual(ticket);
    const info = buildRouteInfoFromAlternative(connected, origin, destination);
    const restored = getRouteInfoFromRoute(JSON.parse(JSON.stringify({ ...connected, schemaVersion: 3, routeInfo: info })))!;
    expect(restored.timeBasis).toBe('anchored_journey');
    expect(Date.parse(restored.arrivalTime)).toBe(Date.parse(ticket.arrivalAt));
    expect(restored.steps.find(step => step.type === 'TRAIN')?.description).toContain('승차권 입력 11:00 → 13:40');
    expect(restored.intercityJourney?.service.bookingStatus).toBe('UNVERIFIED');
    expect(getImportedTicket(connected)).toEqual(ticket);
});
test('ticket cannot shift service or become public timetable and station mapping is still required', async () => {
    const input = args();
    await expect(buildIntercityJourney({ ...input, selection: { ...input.selection, service: { ...input.selection.service, departureAt: '2026-10-13T11:01:00+09:00' } } })).rejects.toThrow('승차권');
    await expect(buildIntercityJourney({ ...input, selection: { ...input.selection, mappingConfirmed: false } })).rejects.toThrow('승하차');
    await expect(buildIntercityJourney({ ...input, option: { ...original, importedTicket: undefined } })).rejects.toThrow('승차권');
    expect(() => assertTicketService(ticket, { ...ticketRideService(ticket), timingBasis: 'TIMETABLE', bookingStatus: 'UNCONFIRMED' })).toThrow('승차권');
});
test.each([
    { verification: 'UNREVIEWED' }, { bookingStatus: 'CONFIRMED' }, { source: 'REMOTE_URL' },
    { arrivalAt: ticket.departureAt }, { departureAt: '2026-10-13T11:00:00Z' }, { trainNumber: '123 QR' },
    { departureName: '' }, { arrivalName: '서울' }, { id: 'tago:123' }, { confirmedAt: 'invalid' },
])('invalid ticket metadata is ignored: %j', change => {
    expect(getImportedTicket({ importedTicket: { ...ticket, ...change } })).toBeUndefined();
});
test('expired boarding preparation cannot be saved and egress may not miss arrival milestone', async () => {
    await expect(buildIntercityJourney({ ...args(), now: new Date('2026-10-13T10:50:00+09:00') })).rejects.toThrow('탑승 준비');
    const input = args();
    await expect(buildIntercityJourney({ ...input, selection: { ...input.selection, alightingBufferMinutes: 5 } })).rejects.toThrow('일정 시작');
});

test.each(['EXPRESS_BUS', 'INTERCITY_BUS'] as const)('reviewed %s ticket locks its own bus kind, grade and overnight times', async kind => {
    const bus = { ...ticket, kind, trainNumber: undefined, grade: '심야우등', departureAt: '2026-10-13T23:00:00+09:00', arrivalAt: '2026-10-14T01:25:00+09:00', source: 'IOS_SHARE_PDF' as const };
    const input = args();
    const connected = await buildIntercityJourney({ ...input, option: { ...original, importedTicket: bus, transitLegs: [{ ...original.transitLegs![0], kind }] }, selection: { ...input.selection, service: ticketRideService(bus) }, targetArrivalAt: bus.arrivalAt });
    const restored = getRouteInfoFromRoute(JSON.parse(JSON.stringify({ ...connected, schemaVersion: 3, routeInfo: buildRouteInfoFromAlternative(connected, origin, destination) })))!;
    expect(restored.steps.find(step => step.type === kind)?.intercityService?.arrivalAt).toBe(bus.arrivalAt);
    expect(restored.intercityJourney?.service.kind).toBe(kind);
    expect(getImportedTicket(connected)).toEqual(bus);
    expect(() => assertTicketService(bus, { ...ticketRideService(bus), kind: 'TRAIN' })).toThrow('승차권');
    expect(() => assertTicketService(bus, { ...ticketRideService(bus), grade: '일반' })).toThrow('승차권');
    expect(getImportedTicket({ importedTicket: { ...bus, grade: '' } })).toBeUndefined();
    expect(getImportedTicket({ importedTicket: { ...bus, trainNumber: '123' } })).toBeUndefined();
});
test('impossible calendar dates cannot normalize into a different service date', () => {
    expect(getImportedTicket({ importedTicket: { ...ticket, departureAt: '2026-02-30T11:00:00+09:00', arrivalAt: '2026-03-02T12:00:00+09:00' } })).toBeUndefined();
});
