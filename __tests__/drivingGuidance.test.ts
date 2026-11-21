import {
  advanceDrivingGuidance,
  drivingTurnPath,
  drivingTurnTitle,
  prepareDrivingGuidance,
  readDrivingGuidance,
  readDrivingHeading,
  type DrivingGuidanceState,
  type DrivingLocationFix,
} from '../src/modules/journey/drivingGuidance';
import { parseTmapRoadRouteResponse } from '../src/modules/map/tmapRoadResponse';

const scale = (Math.PI * 6_371_000) / 180;
function point(east: number, north = 0) {
  return { lat: 37.5 + north / scale, lng: 127 + east / (scale * Math.cos((37.5 * Math.PI) / 180)) };
}
function fix(east: number, north: number, seconds: number, accuracy = 3): DrivingLocationFix {
  const p = point(east, north);
  return { latitude: p.lat, longitude: p.lng, accuracyMeters: accuracy, observedAtMs: seconds * 1000 };
}
function streets() {
  const p = [point(0), point(100), point(200), point(200, 100), point(200, 200), point(300, 200)];
  return {
    mode: 'CAR',
    source: 'api',
    provider: 'tmap',
    minutes: 10,
    distanceMeters: 500,
    pathCoords: p,
    guideSteps: [
      { instruction: '첫길을 따라 이동', durationMinutes: 2, pathCoords: p.slice(0, 3) },
      {
        instruction: '중앙로에서 좌회전',
        roadName: '중앙로',
        turnType: '12',
        coordinate: p[2],
        durationMinutes: 2,
        pathCoords: p.slice(2, 5),
      },
      {
        instruction: '시장길에서 우회전',
        roadName: '시장길',
        turnType: '13',
        coordinate: p[4],
        durationMinutes: 6,
        pathCoords: p.slice(4),
      },
    ],
  };
}
function prepared() {
  const route = prepareDrivingGuidance(streets());
  if (!route) throw new Error('expected driving route');
  return route;
}
describe('saved TMAP driving guidance', () => {
  it('shows the first actual turn even when the car is still at a replacement route’s start point', () => {
    const saved = streets();
    const route = prepareDrivingGuidance({
      ...saved, guideSteps: saved.guideSteps.map((step, index) => index === 0
        ? { ...step, coordinate: point(0), turnType: '200' }
        : index === 1 ? { ...step, turnType: '19' } : step),
    })!;
    const first = advanceDrivingGuidance(route, null, fix(0, 0, 1), 1000);
    const second = advanceDrivingGuidance(route, first, fix(0, 0, 2), 2000);
    expect(second.view.nextManeuver?.turnType).toBe('19');
    expect(second.view.metersToNext).toBe(200);
    expect(drivingTurnTitle(second.view.nextManeuver!)).toBe('4시 방향 우회전');
  });

  it('uses measured movement for direction, including short consecutive fixes, turns and stationary expiry', () => {
    const route = prepared();
    let state: DrivingGuidanceState | null = null;
    function move(x: number, y: number, time: number, course?: number) {
      const sample = { ...fix(x, y, time), courseDegrees: course };
      state = advanceDrivingGuidance(route, state, sample, time * 1000);
      return readDrivingHeading(state, time * 1000);
    }
    expect(move(190, 0, 1, 270)).toBeNull();
    expect(move(194, 0, 2)).toBeNull();
    expect(move(200, 0, 3, -1)).toBeCloseTo(90);
    expect(move(200, 12, 4, 355)).toBe(355);
    expect(move(200, 24, 5, 385)).toBeCloseTo(0);
    expect(move(201, 23, 10, 270)).toBeCloseTo(0);
    expect(move(200, 24, 17, 270)).toBeNull();
    expect(move(200, 70, 32)).toBeNull(); // Reacquire after a gap.
    expect(move(200, 82, 33)).toBeCloseTo(0);
    expect(readDrivingHeading(state, 45000)).toBeNull();
  });

  it('connects a real-shaped TMAP FeatureCollection to its original point instruction, road and ordered links', () => {
    const p = [point(0), point(100), point(100, 80)];
    const xy = (i: number) => [p[i].lng, p[i].lat];
    const parsed = parseTmapRoadRouteResponse(
      {
        features: [
          {
            geometry: { type: 'Point', coordinates: xy(0) },
            properties: { description: '출발지', totalTime: 120, totalDistance: 180 },
          },
          {
            geometry: { type: 'LineString', coordinates: [xy(0), xy(1)] },
            properties: { name: '시작길', distance: 100, time: 60 },
          },
          {
            geometry: { type: 'Point', coordinates: xy(1) },
            properties: { turnType: 12, description: '교차로에서 좌회전', nextRoadName: '언덕길' },
          },
          {
            geometry: { type: 'LineString', coordinates: [xy(1), xy(2)] },
            properties: { distance: 80, time: 60 },
          },
          { geometry: { type: 'Point', coordinates: xy(2) }, properties: { description: '도착지' } },
        ],
      },
      'driving',
    );
    expect(parsed.drivingGeometryComplete).toBe(true);
    const route = prepareDrivingGuidance({ ...parsed, provider: 'tmap', source: 'api', mode: 'CAR' });
    expect(route?.maneuvers).toHaveLength(1);
    expect(route?.maneuvers[0]).toMatchObject({
      turnType: '12',
      instruction: '교차로에서 좌회전',
      roadName: '언덕길',
    });
    expect(route?.maneuvers[0].alongMeters).toBeCloseTo(100, 2);
  });

  it('rejects display estimates, incomplete links, malformed geometry, gaps or a turn attached to the wrong road', () => {
    const base = streets();
    for (const patch of [
      { source: 'fallback' },
      { provider: 'odsay' },
      { mode: 'TRANSIT' },
      { routeReliability: 'fallback_estimate' },
      { fallbackKind: 'straight' },
      { routePlausibility: 'geometry_suspected' },
      { drivingGeometryComplete: false },
      { guideSteps: [] },
      { guideSteps: [base.guideSteps[0], base.guideSteps[2]] },
      { guideSteps: [{ ...base.guideSteps[0], pathCoords: [point(0), { lat: NaN, lng: 127 }] }] },
      {
        guideSteps: [
          base.guideSteps[0],
          { ...base.guideSteps[1], coordinate: point(250) },
          base.guideSteps[2],
        ],
      },
      { pathCoords: [point(0), point(240, 20), point(300, 200)] },
      { distanceMeters: 5000 },
    ]) {
      expect(prepareDrivingGuidance({ ...base, ...patch })).toBeNull();
    }
    const dense = Array.from({ length: 1200 }, (_, i) => point(i / 2));
    const longLink = {
      ...base,
      pathCoords: dense,
      distanceMeters: 600,
      guideSteps: [{ instruction: '직진', pathCoords: dense }],
    };
    expect(prepareDrivingGuidance(longLink)).toBeNull();
    expect(prepareDrivingGuidance({ ...longLink, drivingGeometryComplete: true })).not.toBeNull();
  });

  it('uses two timely fixes, retains turn ordering and uses the supplied segment times', () => {
    const route = prepared();
    let s = advanceDrivingGuidance(route, null, fix(0, 0, 1), 1000);
    expect(s.view.status).toBe('ACQUIRING');
    s = advanceDrivingGuidance(route, s, fix(50, 0, 3), 3000);
    expect(s.view).toMatchObject({
      status: 'GUIDING',
      metersToNext: 150,
      remainingMeters: 450,
      remainingSeconds: 570,
      nextManeuver: { turnType: '12' },
      followingManeuver: { turnType: '13' },
    });
    s = advanceDrivingGuidance(route, s, fix(180, 0, 7), 7000);
    expect(s.view.metersToNext).toBe(20);
    s = advanceDrivingGuidance(route, s, fix(200, 8, 9), 9000);
    expect(s.view.nextManeuver?.turnType).toBe('13');
    const recovered = advanceDrivingGuidance(route, s, fix(200, 6, 10, 12), 10000);
    expect(recovered.view.progress).toBeGreaterThanOrEqual(s.view.progress!);
    expect(recovered.view.nextManeuver?.turnType).toBe('13');
    expect(readDrivingGuidance(recovered, 22000)).toMatchObject({
      status: 'UNCERTAIN',
      nextManeuver: null,
      matchedCoordinate: null,
    });
  });

  it('rejects impossible jumps and older fixes; recovers after two plausible fixes', () => {
    const route = prepared();
    let s = advanceDrivingGuidance(route, null, fix(0, 0, 1), 1000);
    s = advanceDrivingGuidance(route, s, fix(15, 0, 2), 2000);
    expect(advanceDrivingGuidance(route, s, fix(100, 0, 1), 3000)).toBe(s);
    s = advanceDrivingGuidance(route, s, fix(200, 100, 3), 3000);
    expect(s.view.status).toBe('UNCERTAIN');
    expect(s.view.nextManeuver).toBeNull();
    s = advanceDrivingGuidance(route, s, fix(50, 0, 4), 4000);
    expect(s.view.status).toBe('ACQUIRING');
    s = advanceDrivingGuidance(route, s, fix(70, 0, 5), 5000);
    expect(s.view.status).toBe('GUIDING');
    for (const bad of [
      fix(75, 0, 6, 80),
      fix(75, 0, 7, -1),
      fix(75, 0, 99),
      { ...fix(75, 0, 7), latitude: 361 },
    ]) {
      expect(advanceDrivingGuidance(route, s, bad, 7000).view.status).toBe('UNCERTAIN');
    }
  });

  it('reports sustained departure from the route, clears stale turns and rejects a reversed course', () => {
    const route = prepared();
    let s = advanceDrivingGuidance(route, null, fix(20, 0, 1), 1000);
    s = advanceDrivingGuidance(route, s, fix(65, 0, 3), 3000);
    s = advanceDrivingGuidance(route, s, fix(85, 70, 6), 6000);
    expect(s.view.status).toBe('UNCERTAIN');
    s = advanceDrivingGuidance(route, s, fix(100, 72, 10), 10000);
    expect(s.view).toMatchObject({ status: 'OFF_ROUTE', nextManeuver: null, matchedCoordinate: null });
    s = advanceDrivingGuidance(route, s, { ...fix(110, 0, 13), courseDegrees: 270 }, 13000);
    expect(s.view.status).toBe('UNCERTAIN');
    s = advanceDrivingGuidance(route, s, { ...fix(125, 0, 15), courseDegrees: 90 }, 15000);
    s = advanceDrivingGuidance(route, s, { ...fix(145, 0, 17), courseDegrees: 90 }, 17000);
    expect(s.view.status).toBe('GUIDING');
  });

  it('suppresses ambiguous side-by-side carriageways until their direction is observable', () => {
    const p = [point(0), point(200), point(200, 8), point(0, 8)];
    const route = prepareDrivingGuidance({
      mode: 'CAR',
      source: 'api',
      provider: 'tmap',
      drivingGeometryComplete: true,
      pathCoords: p,
      guideSteps: [{ instruction: '도로를 따라 이동', pathCoords: p }],
    })!;
    let s = advanceDrivingGuidance(route, null, fix(48, 4, 1), 1000);
    s = advanceDrivingGuidance(route, s, fix(64, 4, 3), 3000);
    expect(s.view).toMatchObject({ status: 'UNCERTAIN', matchedCoordinate: null });
    s = advanceDrivingGuidance(route, s, { ...fix(80, 4, 5), courseDegrees: 90 }, 5000);
    s = advanceDrivingGuidance(route, s, { ...fix(96, 4, 7), courseDegrees: 90 }, 7000);
    expect(s.view.status).toBe('GUIDING');
    expect(s.view.nextManeuver).toBeNull();
    expect(s.view.remainingSeconds).toBeNull();
  });

  it('binds turns at a revisited junction to their distinct ordered link occurrences', () => {
    const p = [
      point(0),
      point(100),
      point(100, 100),
      point(200, 100),
      point(200),
      point(100),
      point(100, -100),
    ];
    const route = prepareDrivingGuidance({
      mode: 'CAR',
      provider: 'tmap',
      source: 'api',
      pathCoords: p,
      guideSteps: [
        { instruction: '접근', pathCoords: p.slice(0, 2) },
        { instruction: '첫 번째 교차 방향', turnType: '12', coordinate: p[1], pathCoords: p.slice(1, 6) },
        { instruction: '두 번째 교차 방향', turnType: '13', coordinate: p[5], pathCoords: p.slice(5) },
      ],
    });
    expect(route?.maneuvers.map(m => Math.round(m.alongMeters))).toEqual([100, 500]);
    expect(route?.maneuvers[0].coordinate).toEqual(route?.maneuvers[1].coordinate);
    const first = drivingTurnPath(route!, route!.maneuvers[0]);
    const second = drivingTurnPath(route!, route!.maneuvers[1]);
    const junction = route!.maneuvers[0].coordinate;
    expect(first[0].longitude).toBeLessThan(junction.longitude);
    expect(second[0].longitude).toBeGreaterThan(junction.longitude);
    expect(first).toContainEqual(junction);
    expect(second).toContainEqual(junction);
    const firstTip = first[first.length - 2], secondTip = second[second.length - 2];
    expect(firstTip.latitude).toBeGreaterThan(junction.latitude);
    expect(secondTip.latitude).toBeLessThan(junction.latitude);
    expect(first[first.length - 1].latitude).toBeLessThan(firstTip.latitude);
    expect(second[second.length - 1].latitude).toBeGreaterThan(secondTip.latitude);
  });

  it.each([['17', true], ['72', true], ['105', true], ['140', true], ['53', false], ['121', false]])(
    'draws an exit only for directional maneuver %s', (turnType, expected) => {
      const route = prepared();
      const maneuver = { ...route.maneuvers[0], turnType: String(turnType) };
      const shape = drivingTurnPath({ ...route, maneuvers: [maneuver] }, maneuver);
      expect(shape.length > 0).toBe(expected);
    },
  );

  it('keeps the arrow between adjacent decisions and omits an arrival or a missing exit', () => {
    const p = [point(0), point(90), point(90, 16), point(120, 16)];
    const route = prepareDrivingGuidance({
      mode: 'CAR', provider: 'tmap', source: 'api', pathCoords: p,
      guideSteps: [
        { instruction: '접근', pathCoords: p.slice(0, 2) },
        { instruction: '좌회전', turnType: '12', coordinate: p[1], pathCoords: p.slice(1, 3) },
        { instruction: '우회전', turnType: '13', coordinate: p[2], pathCoords: p.slice(2) },
        { instruction: '도착', turnType: '201', coordinate: p[3] },
      ],
    })!;
    const left = drivingTurnPath(route, route.maneuvers[0]);
    const right = drivingTurnPath(route, route.maneuvers[1]);
    expect(left[left.length - 2]).toEqual(right[0]);
    expect(drivingTurnPath(route, route.maneuvers[2])).toEqual([]);
  });

  it('recognizes sustained driving backwards along the planned road without rewinding a turn', () => {
    const route = prepared();
    let s = advanceDrivingGuidance(route, null, fix(10, 0, 1), 1000);
    s = advanceDrivingGuidance(route, s, fix(100, 0, 4), 4000);
    s = advanceDrivingGuidance(route, s, { ...fix(68, 0, 6), courseDegrees: 270 }, 6000);
    expect(s.view.status).toBe('UNCERTAIN');
    s = advanceDrivingGuidance(route, s, { ...fix(24, 0, 10), courseDegrees: 270 }, 10000);
    expect(s.view).toMatchObject({ status: 'OFF_ROUTE', nextManeuver: null, progress: null });
  });

  it('arrives only after confirmed progress and a fresh dwell inside the destination', () => {
    const route = prepared();
    const drive = (coords: [number, number, number][]) =>
      coords.reduce<DrivingGuidanceState | null>(
        (state, [east, north, t]) => advanceDrivingGuidance(route, state, fix(east, north, t), t * 1000),
        null,
      )!;
    expect(
      drive([
        [300, 200, 1],
        [300, 200, 3],
        [300, 200, 12],
      ]).view.status,
    ).not.toBe('ARRIVED');
    const arrived = drive([
      [0, 0, 1],
      [50, 0, 3],
      [150, 0, 6],
      [200, 10, 8],
      [200, 110, 12],
      [200, 190, 15],
      [250, 200, 18],
      [300, 200, 20],
      [300, 200, 23],
      [300, 200, 26],
    ]);
    expect(arrived.view).toMatchObject({
      status: 'ARRIVED',
      remainingMeters: 0,
      progress: 1,
      nextManeuver: null,
    });
    const newRoute = prepared();
    expect(advanceDrivingGuidance(newRoute, arrived, fix(0, 0, 40), 40000).view.status).toBe('ACQUIRING');
  });
});
