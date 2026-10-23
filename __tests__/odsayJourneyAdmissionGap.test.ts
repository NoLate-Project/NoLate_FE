import { parseTransitOptionsFromOdsay } from '../src/modules/map/odsayApi';
import { resolveJourneyBusRouteMapping } from '../src/modules/journey/journeyBusRouteBinding';
import { buildJourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import { savedJourneyEntryIssue } from '../src/modules/journey/savedJourneyEntry';

jest.mock('../src/api/env', () => ({ getEnv: jest.fn() }));

/** A bounded representative of the observed maasRP shape, not a live provider fixture. */
const result = {
    result: { paths: [{ pathType: 2, totalTime: 12, rps: [
        { trafficType: 3, duration: 3, distance: 200 },
        {
            trafficType: 2, duration: 7, distance: 1500,
            startX: 126.972968, startY: 37.555236, endX: 126.972298, endY: 37.577675,
            startLocalStationID: '101000007', startArsID: '02007', startStationCityCode: 1000,
            startStationProviderCode: 4, graph: '126.972968 37.555236|126.972298 37.577675',
            lane: [{ busID: 12345, busLocalBlID: '100100185', busCityCode: 1000,
                busProviderCode: 4, busNo: '서울 버스' }],
            passStopList: { stations: [
                { index: 0, stationName: '승차', localStationID: '101000007', arsID: '02007',
                    stationCityCode: 1000, stationProviderCode: 4, x: 126.972968, y: 37.555236 },
                { index: 1, stationName: '하차', localStationID: '100000021', arsID: '01116',
                    stationCityCode: 1000, stationProviderCode: 4, x: 126.972298, y: 37.577675 },
            ] },
        },
        { trafficType: 3, duration: 2, distance: 100 },
    ] }] },
};

test('ODsay raw identifiers survive parsing, but missing service/direction/count are not invented', () => {
    const [parsed] = parseTransitOptionsFromOdsay(result);
    const bus = parsed.transitLegs?.[1];
    expect(parsed.provider).toBe('odsay');
    expect(bus?.localRouteId).toBe('100100185');
    expect(bus?.navigationEvidence?.stopOccurrences).toHaveLength(2);
    expect(bus?.navigationEvidence?.directionName).toBeUndefined();
    expect(bus?.navigationEvidence?.declaredStationCount).toBeUndefined();
    expect(bus?.serviceAvailable).toBeUndefined();

    const route = { ...parsed, mode: 'TRANSIT', routeReliability: 'provider_estimate',
        routePlausibility: 'normal', transitServiceState: 'unknown' };
    expect(resolveJourneyBusRouteMapping(route).status).toBe('DIRECTION_REQUIRED');
    const built = buildJourneyRouteInput(route, { routeRevision: 1, context: 'SAVED_ROUTE',
        origin: { lat: 37.555236, lng: 126.972968 }, destination: { lat: 37.577675, lng: 126.972298 } });
    expect(built.ok).toBe(true);
    // Unknown operating state may reach the server's official crosswalk, but this
    // observed response still lacks usable walking geometry and cannot navigate.
    if (built.ok) expect(savedJourneyEntryIssue(built.input)).toContain('실제 이동 경로');
});
