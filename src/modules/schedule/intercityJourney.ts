import { assertTicketService, getImportedTicket, type IntercityRideService } from './importedTicket';
import type { RouteAlternativeOption, TransitLegDetail, RoutePathCoord } from '../map/tmapApiCore';
import { isIntercityRideKind, transitModeLabel } from '../map/transitModes';
import type { Place } from './types';

/** Only the chosen ride uses a public timetable. Connections remain estimates, not a reservation. */
export type IntercityJourney = {
    version: 1;
    service: IntercityRideService;
    fetchedAt: string;
    selectedAt: string;
    departureAt: string;
    arrivalAt: string;
    boardingBufferMinutes: number;
    alightingBufferMinutes: number;
    connectionBasis: 'ROUTE_ESTIMATE';
    mapping: { confirmed: true; departureName: string; arrivalName: string; departure: RoutePathCoord; arrival: RoutePathCoord };
};
export type IntercitySelection = { service: IntercityRideService; fetchedAt: string; boardingBufferMinutes: number; alightingBufferMinutes: number; mappingConfirmed: boolean };
type Search = (origin: Place, destination: Place, mode: 'TRANSIT' | 'WALK', options: { departureAt: Date; searchFutureService: false }) => Promise<RouteAlternativeOption[]>;
function fail(message: string): never { throw new Error(message); }
const seconds = (option: RouteAlternativeOption) => option.totalDurationSeconds ?? (option.minutes ?? NaN) * 60;
const legSeconds = (leg: TransitLegDetail) => leg.durationSeconds ?? (leg.durationMinutes ?? NaN) * 60;
const validCoord = (point?: RoutePathCoord): point is RoutePathCoord => !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
const distance = (a: RoutePathCoord, b: RoutePathCoord) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 88000);
const iso = (time: number) => new Date(time).toISOString();
const floorMinute = (time: number) => Math.floor(time / 60000) * 60000;
const asCoord = (place: Place): RoutePathCoord => ({ lat: place.lat!, lng: place.lng! });

/** Fail closed before save if an edit would move a selected departure or miss the appointment. */
export function validateIntercityJourneyTiming(journey: IntercityJourney, targetArrivalAt?: string, now = new Date()): void {
    const depart = Date.parse(journey.departureAt), arrive = Date.parse(journey.arrivalAt);
    if (!Number.isFinite(depart) || !Number.isFinite(arrive) || arrive <= depart || arrive - depart > 86400000) fail('연결 경로의 시각을 다시 확인해 주세요.');
    if (depart <= now.getTime()) fail('출발 준비 시각이 지났습니다. 다른 운행편을 선택해 주세요.');
    if (targetArrivalAt && (!Number.isFinite(Date.parse(targetArrivalAt)) || arrive > Date.parse(targetArrivalAt))) fail('선택한 운행편으로는 일정 시작 전에 도착하기 어렵습니다. 다른 편이나 일정 시각을 선택해 주세요.');
}

function connectionLegs(option: RouteAlternativeOption): TransitLegDetail[] {
    if (option.transitLegs?.length) {
        const legs = option.transitLegs.map(leg => ({ ...leg }));
        const sum = legs.reduce((total, leg) => total + legSeconds(leg), 0);
        // Unexplained time must not shift the chosen ride in the restored timeline.
        if (!Number.isInteger(sum) || sum !== seconds(option) || legs.some(leg => !Number.isInteger(legSeconds(leg)) || legSeconds(leg) < 0)) fail('연결 경로의 구간 시간이 일치하지 않습니다. 다시 조회해 주세요.');
        return legs;
    }
    if (option.mode === 'WALK' && option.pathCoords && option.pathCoords.length >= 2) return [{ kind: 'WALK', label: '도보', durationSeconds: seconds(option), durationMinutes: seconds(option) / 60, pathCoords: option.pathCoords, distanceMeters: option.distanceMeters }];
    return fail('연결 경로의 상세 정보를 확인하지 못했습니다.');
}

async function findConnection(search: Search, origin: Place, destination: Place, departureAt: number): Promise<RouteAlternativeOption | undefined> {
    if (distance(asCoord(origin), asCoord(destination)) < 30) return undefined;
    // Same routing boundary/provider policy as the normal search, without next-service time hopping.
    const mode = distance(asCoord(origin), asCoord(destination)) < 500 ? 'WALK' : 'TRANSIT';
    const options = await search(origin, destination, mode, { departureAt: new Date(departureAt), searchFutureService: false });
    const usable = options.filter(option => option.mode === mode && option.source === 'api' && !option.fallbackKind && option.routePlausibility !== 'geometry_suspected' && option.transitServiceState !== 'not_operating' && option.transitDepartureTimeSource !== 'next_service_search' && !(option.transitLegs ?? []).some(leg => isIntercityRideKind(leg.kind)) && Number.isFinite(seconds(option)) && seconds(option) > 0 && seconds(option) <= 86400 && (!option.transitDepartureAt || Math.abs(Date.parse(option.transitDepartureAt) - departureAt) < 60000));
    const coherent = usable.filter(option => { try { connectionLegs(option); return true; } catch { return false; } });
    const best = coherent.sort((a, b) => seconds(a) - seconds(b))[0];
    if (!best) fail('역·터미널 앞뒤의 연결 경로를 찾지 못했습니다. 다른 운행편을 선택해 주세요.');
    connectionLegs(best); // Validate before choosing it.
    return best;
}

export async function buildIntercityJourney({ option, legIndex, origin, destination, selection, targetArrivalAt, search, now = new Date() }: {
    option: RouteAlternativeOption; legIndex: number; origin: Place; destination: Place;
    selection: IntercitySelection; targetArrivalAt?: string; search: Search; now?: Date;
}): Promise<RouteAlternativeOption> {
    const original = option.transitLegs?.[legIndex];
    const service = selection.service;
    if (!original || !isIntercityRideKind(original.kind) || option.transitLegs?.filter(leg => isIntercityRideKind(leg.kind)).length !== 1) fail('현재는 장거리 운행편 한 개가 포함된 경로를 연결할 수 있습니다.');
    if (original.kind !== service.kind && !(original.kind === 'COACH' && service.kind !== 'TRAIN')) fail('현재 경로와 같은 교통수단의 운행편을 선택해 주세요.');
    if (!selection.mappingConfirmed) fail('선택한 역·터미널이 현재 경로의 승하차 지점과 같은 곳인지 확인해 주세요.');
    if (!validCoord(original.startCoord) || !validCoord(original.endCoord) || !validCoord(asCoord(origin)) || !validCoord(asCoord(destination))) fail('승하차 지점의 지도 좌표가 없어 연결할 수 없습니다.');
    if (!Number.isInteger(selection.boardingBufferMinutes) || selection.boardingBufferMinutes < 5 || selection.boardingBufferMinutes > 120 || !Number.isInteger(selection.alightingBufferMinutes) || selection.alightingBufferMinutes < 0 || selection.alightingBufferMinutes > 120) fail('탑승 준비는 5~120분, 하차 후 여유는 0~120분으로 입력해 주세요.');
    const ticket = getImportedTicket(option);
    if (ticket) assertTicketService(ticket, service);
    else if (service.timingBasis === 'TICKET') fail('확인한 승차권 정보가 없습니다.');
    const dep = Date.parse(service.departureAt), arr = Date.parse(service.arrivalAt);
    const validBasis = service.timingBasis === 'TICKET' ? service.bookingStatus === 'UNVERIFIED' : service.timingBasis === 'TIMETABLE' && service.bookingStatus === 'UNCONFIRMED';
    const fresh = service.timingBasis === 'TICKET' || (Number.isFinite(Date.parse(selection.fetchedAt)) && now.getTime() - Date.parse(selection.fetchedAt) <= 10 * 60000 && Date.parse(selection.fetchedAt) <= now.getTime() + 60000);
    if (!validBasis || !fresh || !Number.isFinite(dep) || !Number.isFinite(arr) || dep <= now.getTime() || arr <= dep || arr - dep > 86400000 || service.departureAt.slice(0, 10) !== service.serviceDate || service.departureId === service.arrivalId) fail('운행 시간표를 다시 조회한 뒤 미래 운행편을 선택해 주세요.');
    const boarding = { name: service.departureName, ...original.startCoord };
    const alighting = { name: service.arrivalName, ...original.endCoord };
    const deadline = dep - selection.boardingBufferMinutes * 60000;
    let estimate = option.transitLegs!.slice(0, legIndex)
        .filter((leg) => leg.journeyPhase !== 'BUFFER')
        .reduce((sum, leg) => sum + legSeconds(leg), 0);
    if (!Number.isFinite(estimate)) estimate = 3600;
    let journeyDeparture = floorMinute(deadline - estimate * 1000);
    let access: RouteAlternativeOption | undefined;
    let accessArrival = journeyDeparture;
    let connected = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (journeyDeparture <= now.getTime()) fail('탑승 준비시간을 확보할 수 없습니다. 더 늦은 운행편을 선택해 주세요.');
        access = await findConnection(search, origin, boarding, journeyDeparture);
        accessArrival = journeyDeparture + (access ? seconds(access) * 1000 : 0);
        if (accessArrival <= deadline) { connected = true; break; }
        journeyDeparture = floorMinute(journeyDeparture - (accessArrival - deadline) - 60000);
    }
    if (!connected) fail('탑승 준비시간을 확보하는 연결 경로를 찾지 못했습니다.');
    const egressDeparture = arr + selection.alightingBufferMinutes * 60000;
    const egress = await findConnection(search, alighting, destination, egressDeparture);
    const arrival = egressDeparture + (egress ? seconds(egress) * 1000 : 0);
    const journey: IntercityJourney = {
        version: 1, service: { ...service }, fetchedAt: selection.fetchedAt, selectedAt: now.toISOString(), departureAt: iso(journeyDeparture), arrivalAt: iso(arrival),
        boardingBufferMinutes: selection.boardingBufferMinutes, alightingBufferMinutes: selection.alightingBufferMinutes, connectionBasis: 'ROUTE_ESTIMATE',
        mapping: { confirmed: true, departureName: original.startName ?? '', arrivalName: original.endName ?? '', departure: original.startCoord, arrival: original.endCoord },
    };
    validateIntercityJourneyTiming(journey, targetArrivalAt, now);
    const wait = (label: string, from: number, to: number, point: RoutePathCoord): TransitLegDetail => ({ kind: 'ETC', journeyPhase: 'BUFFER', label, durationSeconds: (to - from) / 1000, durationMinutes: (to - from) / 60000, startDateTime: iso(from), endDateTime: iso(to), startCoord: point, endCoord: point });
    const accessLegs = access ? connectionLegs(access) : [];
    const legs: TransitLegDetail[] = [
        ...accessLegs,
        wait(`탑승 준비·대기 (준비 ${selection.boardingBufferMinutes}분 포함)`, accessArrival, dep, original.startCoord),
        // Clear provider-specific boarding advice/IDs; it belonged to a different estimated service.
        { kind: service.kind, label: [service.grade, service.trainNumber && `${service.trainNumber}편`].filter(Boolean).join(' · ') || transitModeLabel(service.kind), lineName: [service.grade, service.trainNumber && `${service.trainNumber}편`].filter(Boolean).join(' · '), durationSeconds: (arr - dep) / 1000, durationMinutes: (arr - dep) / 60000, startName: service.departureName, endName: service.arrivalName, startCoord: original.startCoord, endCoord: original.endCoord, pathCoords: original.pathCoords, pathCoordsIsExact: false, pathGeometrySource: "UNKNOWN", distanceMeters: original.distanceMeters, startDateTime: service.departureAt, endDateTime: service.arrivalAt, intercityService: { ...service } },
        ...(selection.alightingBufferMinutes ? [wait('하차 후 여유', arr, egressDeparture, original.endCoord)] : []),
        ...(egress ? connectionLegs(egress) : []),
    ];
    // Materialize all connection estimate timestamps without moving the public service timestamps.
    let cursor = journeyDeparture;
    legs.forEach(leg => { leg.startDateTime = iso(cursor); cursor += legSeconds(leg) * 1000; leg.endDateTime = iso(cursor); });
    if (Math.abs(cursor - arrival) > 1) fail('연결 경로의 시각이 일치하지 않습니다.');
    const durationSeconds = (arrival - journeyDeparture) / 1000;
    const attribution = [access, egress].find(connection => connection?.provider === "openstreetmap");
    return {
        id: `intercity:${service.id}:${journeyDeparture}`, mode: 'TRANSIT', source: 'api', provider: attribution?.provider ?? option.provider,
        attributionText: attribution?.attributionText, attributionUrl: attribution?.attributionUrl,
        minutes: Math.ceil(durationSeconds / 60), totalDurationSeconds: durationSeconds,
        transitLegs: legs, pathCoords: legs.flatMap(leg => leg.pathCoords ?? []),
        distanceMeters: legs.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0),
        walkMeters: legs.filter(leg => leg.kind === 'WALK').reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0),
        transferCount: Math.max(0, legs.filter(leg => ['BUS', 'SUBWAY', 'TRAIN', 'EXPRESS_BUS', 'INTERCITY_BUS'].includes(leg.kind)).length - 1),
        // Whole-journey fare is unknown; do not reuse the original estimate or present the ride fare as the total.
        providerDepartureAt: journey.departureAt, providerArrivalAt: journey.arrivalAt, providerTimeBasis: 'route_estimate',
        transitDepartureAt: journey.departureAt, transitDepartureTimeSource: 'requested', transitServiceState: 'unknown',
        routeReliability: 'provider_estimate', routeQualityLabel: '선택 운행편 연결', routeQualityNotice: '선택 편은 공공 시간표, 앞뒤 이동은 예상 시간입니다. 예매·좌석·탑승홈은 확인되지 않았습니다.',
        intercityJourney: journey,
        importedTicket: ticket,
        ...(ticket ? { routeQualityNotice: '승차권에서 확인한 시각 · 앞뒤 이동 예상 · 예매 상태와 탑승홈은 예매처에서 확인해 주세요.' } : {}),
    };
}
