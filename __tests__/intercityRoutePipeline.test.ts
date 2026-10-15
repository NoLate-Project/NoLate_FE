jest.mock('../src/routeSupport/schedule/RouteSelectAnimatedControls', () => ({
  ROUTE_SEGMENT_FALLBACK_COLORS: { walk: '#9CA3AF', etc: '#9CA3AF' },
}));

jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));

import capturedTmap from '../e2e/evidence/intercity-2026-10-12/tmap-response.json';
import { parseTransitOptionsFromTmap } from '../src/modules/map/tmapApi';
import { parseTransitOptionsFromOdsay } from '../src/modules/map/odsayApi';
import { isTransitRideKind } from '../src/modules/map/transitModes';
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from '../src/modules/schedule/routeInfo';
import { normalizeRouteAlternativeToSegments } from '../src/modules/schedule/routePlanner/routeTransitGeometryBuilder';
import { buildRouteInfoFromNormalizedRoute, routeStepTypeFromSegmentMode } from '../src/modules/schedule/routePlanner/routePlannerRouteInfo';
import { hasPersistableScheduleRoute } from '../src/modules/schedule/scheduleRouteTiming';
import { selectNaverLikeRouteAlternatives } from '../src/modules/schedule/routeAlternativeRanking';
import type { RouteAlternativeOption } from '../src/modules/map/tmapApi';

import { buildRouteDropdownSummaryItems, buildRouteProgressSegments } from '../src/routeSupport/schedule/routeSelectRouteModel';

const origin = { name: '서울 출발', lat: 37.4849, lng: 127.0167 };
const destination = { name: '공주 도착', lat: 36.4600, lng: 127.1246 };

function availableCapturedOptions() {
  return parseTransitOptionsFromTmap(capturedTmap)
    .filter(option => option.transitLegs!.filter(leg => isTransitRideKind(leg.kind))
      .every(leg => leg.serviceAvailable === true))
    .map(option => ({ ...option, mode: 'TRANSIT' as const }));
}

function roundTrip(option: RouteAlternativeOption) {
  const normalized = normalizeRouteAlternativeToSegments(option);
  const dropdown = buildRouteDropdownSummaryItems(option, origin.name, destination.name);
  expect(dropdown.filter(item => isTransitRideKind(item.kind)).map(item => item.kind))
    .toEqual(option.transitLegs!.filter(leg => isTransitRideKind(leg.kind)).map(leg => leg.kind));
  expect(buildRouteProgressSegments(option).filter(segment => segment.isRide)).toHaveLength(
    option.transitLegs!.filter(leg => isTransitRideKind(leg.kind)).length);
  const routeInfo = buildRouteInfoFromNormalizedRoute(
    buildRouteInfoFromAlternative(option, origin, destination, new Date('2026-10-12T03:00:00Z')),
    normalized,
  );
  const stored = JSON.parse(JSON.stringify({ ...option, schemaVersion: 2, routeInfo }));
  expect(hasPersistableScheduleRoute(stored, option.minutes, origin, destination)).toBe(true);
  const restored = getRouteInfoFromRoute(stored)!;
  expect(restored.timeBasis).toBe('estimated');
  expect(restored.steps.filter(step => isTransitRideKind(step.type)).map(step => step.type))
    .toEqual(option.transitLegs!.filter(leg => isTransitRideKind(leg.kind)).map(leg => leg.kind));
  expect(restored.steps.filter(step => step.type === 'WALK')).toHaveLength(
    normalized!.segments.filter(segment => segment.mode === 'WALK').length,
  );
  return restored;
}

describe('intercity provider → map → timeline → saved route contract', () => {
  test('route shortlist retains an available train alongside coach alternatives', () => {
    const options = availableCapturedOptions();
    const displayed = selectNaverLikeRouteAlternatives(options, 'TRANSIT');
    expect(displayed.some(option => option.transitLegs!.some(leg => leg.kind === 'TRAIN'))).toBe(true);
    expect(displayed.some(option => option.transitLegs!.some(leg => leg.kind === 'EXPRESS_BUS'))).toBe(true);
    expect(displayed.length).toBeLessThanOrEqual(5);
  });

  test('intercity diversity does not restore an excessively slow train or change a single recommendation', () => {
    const options = availableCapturedOptions();
    const hasTrain = (option: RouteAlternativeOption) => option.transitLegs!.some(leg => leg.kind === 'TRAIN');
    const tooSlow = options.map(option => hasTrain(option) ? { ...option, minutes: 400 } : option);
    expect(selectNaverLikeRouteAlternatives(tooSlow, 'TRANSIT').some(hasTrain)).toBe(false);
    const onlyBest = selectNaverLikeRouteAlternatives(options, 'TRANSIT', 'ALL', 1);
    expect(onlyBest).toHaveLength(1);
    expect(onlyBest[0].id).toBe(selectNaverLikeRouteAlternatives(options, 'TRANSIT')[0].id);
  });

  test('captured live TMAP coach and SRT responses preserve every ride', () => {
    const options = parseTransitOptionsFromTmap(capturedTmap);
    expect(options.length).toBeGreaterThan(0);
    expect(options.some(option => option.transitLegs!.some(leg => leg.kind === 'EXPRESS_BUS'))).toBe(true);
    expect(options.some(option => option.transitLegs!.some(leg => leg.kind === 'TRAIN'))).toBe(true);
    options.forEach(option => roundTrip({ ...option, mode: "TRANSIT" }));
  });

  test.each([[4, 'TRAIN'], [5, 'EXPRESS_BUS'], [6, 'INTERCITY_BUS']] as const)(
    'ODsay trafficType %i retains %s without geometry or fabricated timetable', (trafficType, kind) => {
      // Contract fixture: ODsay was quota-limited; this is not a live ODsay response.
      const options = parseTransitOptionsFromOdsay({ result: { paths: [{
        pathType: 2, pathSubType: 4, totalTime: 95, totalDistance: 120000,
        rps: [
          { trafficType: 3, duration: 5 },
          { trafficType, duration: 90, startName: '출발 터미널', endName: '도착 터미널', lane: [{ name: '시외 운행 구간' }] },
        ],
      }] } });
      expect(options).toHaveLength(1);
      expect(options[0].transitLegs![1].kind).toBe(kind);
      const restored = roundTrip({ ...options[0], mode: "TRANSIT" });
      expect(restored.steps.find(step => step.type === kind)).toBeDefined();
    },
  );

  test('unknown modes never become walking', () => {
    expect(routeStepTypeFromSegmentMode('ETC')).toBe('UNKNOWN');
    expect(routeStepTypeFromSegmentMode('WALK')).toBe('WALK');
  });
});
