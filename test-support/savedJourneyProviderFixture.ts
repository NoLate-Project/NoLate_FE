import { syntheticBusMappingRoute } from '../src/modules/journey/journeyBusMappingFixture';
import { buildSavedJourneyInput } from '../src/modules/journey/savedJourneyGuidance';
import { parseTransitOptionsFromOdsay } from '../src/modules/map/odsayApi';

/** Artificial saved metadata only. No HTTP, keys, recorded journey or real route certification. */
export function savedJourneyProviderFixture() {
    const route = JSON.parse(JSON.stringify(syntheticBusMappingRoute()));
    const point = (lng: number) => ({ lat: 37.5665, lng });
    const walk = (values: number[]) => ({ kind: 'WALK', startCoord: point(values[0]), endCoord: point(values.at(-1)!),
        pathCoords: values.map(point), pathCoordsIsExact: true, pathGeometrySource: 'WALK_STEPS_LINESTRING',
        navigationEvidence: { version: 1, provider: 'odsay', geometryInputComplete: true, stopOccurrences: [] } });
    const bus = route.transitLegs[1];
    bus.localRouteId = '999999999'; bus.navigationEvidence.busIdentifiers.localRouteId = '999999999';
    Object.assign(route, { routeReliability: 'live_provider', routePlausibility: 'normal', transitServiceState: 'operating',
        transitLegs: [walk([126.978, 126.97875, 126.9795]), bus, walk([126.9895, 126.99025, 126.991])] });
    const origin = point(126.978), destination = point(126.991);
    return { route, origin, destination, input: buildSavedJourneyInput(route, origin, destination)! };
}

/** Real station names/coordinates in an isolated test route; identifiers and train are not live provider proof. */
export function savedJourneySubwayProviderFixture() {
    const stops = [
        { name: '강남', id: 222, lat: 37.497958, lng: 127.027539 },
        { name: '역삼', id: 221, lat: 37.500658, lng: 127.036430 },
        { name: '선릉', id: 220, lat: 37.504257, lng: 127.048174 },
    ];
    const [route] = parseTransitOptionsFromOdsay({ result: { paths: [{ pathType: 2, totalTime: 16, rps: [
        { trafficType: 3, duration: 3, startX: 127.0271, startY: 37.4975, endX: stops[0].lng, endY: stops[0].lat },
        { trafficType: 1, duration: 10, distance: 2200, stationCount: 2, startID: stops[0].id, endID: stops[2].id,
            startName: stops[0].name, endName: stops[2].name, startX: stops[0].lng, startY: stops[0].lat,
            endX: stops[2].lng, endY: stops[2].lat, way: '외선', wayCode: 2,
            lane: [{ name: '수도권 2호선', subwayCode: 2, subwayCityCode: 1000 }],
            graph: stops.map(stop => `${stop.lng} ${stop.lat}`).join('|'),
            passStopList: { stations: stops.map((stop, index) => ({ index: index * 10 + 10,
                stationID: stop.id, stationName: stop.name, x: stop.lng, y: stop.lat })) } },
    ] }] } });
    if (!route?.transitLegs?.[1]) throw new Error('INVALID_SUBWAY_FIXTURE');
    const subway = route.transitLegs[1];
    const walk = (points: { lat: number; lng: number }[]) => ({ kind: 'WALK',
        startCoord: points[0], endCoord: points.at(-1), pathCoords: points,
        pathCoordsIsExact: true, pathGeometrySource: 'WALK_STEPS_LINESTRING',
        navigationEvidence: { version: 1, provider: 'odsay', geometryInputComplete: true, stopOccurrences: [] } });
    const origin = { lat: 37.4975, lng: 127.0271 }, destination = { lat: 37.5045, lng: 127.0486 };
    Object.assign(route, { routeReliability: 'live_provider', routePlausibility: 'normal', transitServiceState: 'operating',
        transitLegs: [walk([origin, { lat: 37.4977, lng: 127.0273 }, { lat: stops[0].lat, lng: stops[0].lng }]),
            subway, walk([{ lat: stops[2].lat, lng: stops[2].lng }, destination])] });
    return { route, origin, destination, input: buildSavedJourneyInput(route, origin, destination) };
}
