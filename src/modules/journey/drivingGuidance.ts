import { freshLocationCourse, updateLocationCourse, type LocationCourse } from '../map/locationCourse';
import { distanceBetweenCoordsMeters, isWgs84Coordinate } from '../map/tmapApiCore';

export type DrivingCoordinate = { latitude: number; longitude: number };
export type DrivingLocationFix = DrivingCoordinate & {
  accuracyMeters: number;
  observedAtMs: number;
  courseDegrees?: number | null;
};

export type DrivingManeuver = {
  instruction: string;
  roadName?: string;
  turnType: string;
  coordinate: DrivingCoordinate;
  alongMeters: number;
};

const turnLabels: Record<string, string> = {
  '11': '직진', '12': '좌회전', '13': '우회전', '14': '유턴',
  '16': '8시 방향 좌회전', '17': '10시 방향 좌회전',
  '18': '2시 방향 우회전', '19': '4시 방향 우회전',
  '117': '오른쪽 방향', '118': '왼쪽 방향', '201': '도착 지점',
};

export function drivingTurnTitle(maneuver: DrivingManeuver): string {
  return turnLabels[maneuver.turnType] ?? maneuver.instruction;
}

type Edge = {
  start: DrivingCoordinate;
  end: DrivingCoordinate;
  east: number;
  north: number;
  metersPerLongitudeDegree: number;
  length: number;
  along: number;
  bearing: number;
};

export type DrivingGuidanceRoute = {
  coordinates: DrivingCoordinate[];
  maneuvers: DrivingManeuver[];
  totalMeters: number;
  /** Proportional remaining time uses the provider's saved trip estimate. */
  totalSeconds: number | null;
  edges: Edge[];
  timedLinks: { from: number; to: number; seconds: number }[] | null;
};

type DrivingStatus = 'ACQUIRING' | 'GUIDING' | 'OFF_ROUTE' | 'UNCERTAIN' | 'ARRIVED';

export type DrivingGuidanceView = {
  status: DrivingStatus;
  /** Based on the matched GPS observation, independent of component render time. */
  validUntilMs: number | null;
  nextManeuver: DrivingManeuver | null;
  followingManeuver: DrivingManeuver | null;
  metersToNext: number | null;
  remainingMeters: number | null;
  remainingSeconds: number | null;
  matchedCoordinate: DrivingCoordinate | null;
  progress: number | null;
};

type Projection = { along: number; cross: number; coordinate: DrivingCoordinate };
type Match = { along: number; at: number };

export type DrivingGuidanceState = {
  route: DrivingGuidanceRoute;
  view: DrivingGuidanceView;
  lastFix: DrivingLocationFix | null;
  course: LocationCourse | null;
  latestObservationMs: number | null;
  match: Match | null;
  acquisition: Match | null;
  travelled: number;
  nextManeuverIndex: number;
  outsideSince: number | null;
  destinationSince: number | null;
  evaluatedAtMs: number;
};

const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180;
const FIX_FRESH_MS = 12_000;
const MAX_METERS_PER_SECOND = 60;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function coord(value: unknown): DrivingCoordinate | null {
  const point = record(value);
  return point &&
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    isWgs84Coordinate(point.lat, point.lng)
    ? { latitude: point.lat, longitude: point.lng }
    : null;
}

function meters(a: DrivingCoordinate, b: DrivingCoordinate): number {
  return distanceBetweenCoordsMeters(
    { lat: a.latitude, lng: a.longitude },
    { lat: b.latitude, lng: b.longitude },
  );
}

function text(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return undefined;
  return value.trim() || undefined;
}

function createEdge(start: DrivingCoordinate, end: DrivingCoordinate, along: number): Edge {
  const metersPerLongitudeDegree =
    METERS_PER_DEGREE * Math.cos(((start.latitude + end.latitude) * Math.PI) / 360);
  const east = (end.longitude - start.longitude) * metersPerLongitudeDegree;
  const north = (end.latitude - start.latitude) * METERS_PER_DEGREE;
  return {
    start,
    end,
    metersPerLongitudeDegree,
    east,
    north,
    along,
    length: Math.hypot(east, north),
    bearing: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
  };
}

/**
 * The owning schedule provides the selected itinerary. This parser checks that the saved
 * TMAP route can actually support maneuver guidance. The overview polyline alone can be
 * display-sampled. Use the ordered provider links, and check the complete overview against
 * them so missing middle links cannot silently become straight driving instructions.
 */
export function prepareDrivingGuidance(value: unknown): DrivingGuidanceRoute | null {
  const raw = record(value);
  if (
    !raw ||
    raw.mode !== 'CAR' ||
    raw.source !== 'api' ||
    raw.provider !== 'tmap' ||
    raw.fallbackKind != null ||
    (raw.drivingGeometryComplete != null && raw.drivingGeometryComplete !== true) ||
    raw.routeReliability === 'fallback_estimate' ||
    raw.routePlausibility === 'geometry_suspected' ||
    !Array.isArray(raw.guideSteps) ||
    !raw.guideSteps.length ||
    raw.guideSteps.length > 4000 ||
    !Array.isArray(raw.pathCoords) ||
    raw.pathCoords.length < 2 ||
    raw.pathCoords.length > 20_000
  )
    return null;

  const coordinates: DrivingCoordinate[] = [];
  const edges: Edge[] = [];
  const maneuvers: DrivingManeuver[] = [];
  let along = 0;
  let count = 0;
  const timings: { from: number; to: number; seconds: number }[] = [];
  for (const row of raw.guideSteps) {
    const step = record(row);
    if (!step) return null;
    // TMAP attaches each Point decision to the LineString that leaves it. Using this
    // occurrence avoids matching a turn to an earlier crossing of the same intersection.
    const startAlong = along;
    let junction = coordinates[coordinates.length - 1];
    if (step.pathCoords != null) {
      if (
        !Array.isArray(step.pathCoords) ||
        step.pathCoords.length < 2 ||
        (raw.drivingGeometryComplete !== true && step.pathCoords.length >= 1200)
      )
        return null;
      count += step.pathCoords.length;
      if (count > 20_000) return null;
      for (let i = 0; i < step.pathCoords.length; i++) {
        const p = coord(step.pathCoords[i]);
        if (!p) return null;
        const prev = coordinates[coordinates.length - 1];
        if (i === 0) {
          if (prev && meters(prev, p) > 2) return null;
          junction = p;
        }
        if (prev) {
          const edge = createEdge(prev, p, along);
          if (edge.length <= 0.1) continue;
          if (edge.length > 1200 || Math.abs(prev.longitude - p.longitude) > 180) return null;
          edges.push(edge);
          along += edge.length;
        }
        coordinates.push(p);
      }
    }
    if (
      along > startAlong &&
      typeof step.durationMinutes === 'number' &&
      Number.isFinite(step.durationMinutes) &&
      step.durationMinutes >= 0 &&
      step.durationMinutes <= 2880
    ) {
      timings.push({ from: startAlong, to: along, seconds: step.durationMinutes * 60 });
    }
    if (step.turnType == null) continue;
    const instruction = text(step.instruction);
    const turnType = text(step.turnType);
    const anchor = coord(step.coordinate);
    if (
      !instruction ||
      !turnType ||
      !/^\d{1,4}$/.test(turnType) ||
      !anchor ||
      !junction ||
      meters(anchor, junction) > 20
    )
      return null;
    const prior = maneuvers[maneuvers.length - 1];
    if (prior && Math.abs(prior.alongMeters - startAlong) < 0.1) {
      if (prior.instruction === instruction && prior.turnType === turnType) continue;
      return null;
    }
    maneuvers.push({
      instruction,
      turnType,
      roadName: text(step.roadName),
      coordinate: anchor,
      alongMeters: startAlong,
    });
  }
  if (
    edges.length === 0 ||
    along < 20 ||
    along > 1_500_000 ||
    (!maneuvers.length && raw.drivingGeometryComplete !== true)
  )
    return null;
  // Every retained overview vertex must occur in the same order in the links. Legacy
  // summary-only saves and discontinuous partial responses do not meet this contract.
  let cursor = 0;
  for (const rawPoint of raw.pathCoords) {
    const p = coord(rawPoint);
    if (!p) return null;
    while (cursor < coordinates.length && meters(coordinates[cursor], p) > 1) cursor++;
    if (cursor === coordinates.length) return null;
  }
  const first = coord(raw.pathCoords[0])!;
  const last = coord(raw.pathCoords[raw.pathCoords.length - 1])!;
  if (meters(first, coordinates[0]) > 2 || meters(last, coordinates[coordinates.length - 1]) > 2) return null;
  if (
    raw.distanceMeters != null &&
    (typeof raw.distanceMeters !== 'number' ||
      !Number.isFinite(raw.distanceMeters) ||
      raw.distanceMeters <= 0 ||
      Math.abs(raw.distanceMeters - along) > Math.max(60, raw.distanceMeters * 0.15))
  )
    return null;
  const roundedTripSeconds =
    typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) && raw.minutes > 0 && raw.minutes <= 2880
      ? Math.round(raw.minutes * 60)
      : null;
  const totalSeconds =
    typeof raw.totalDurationSeconds === 'number' &&
    Number.isFinite(raw.totalDurationSeconds) &&
    raw.totalDurationSeconds > 0 &&
    raw.totalDurationSeconds <= 172800
      ? raw.totalDurationSeconds
      : roundedTripSeconds;
  const linkSeconds = timings.reduce((sum, link) => sum + link.seconds, 0);
  const completeTimings =
    linkSeconds > 0 &&
    timings[0].from === 0 &&
    timings[timings.length - 1].to === along &&
    timings.every((link, i) => i === 0 || link.from === timings[i - 1].to);
  return {
    coordinates,
    edges,
    maneuvers,
    totalMeters: along,
    totalSeconds: totalSeconds ?? (completeTimings ? linkSeconds : null),
    timedLinks: completeTimings ? timings : null,
  };
}

function blank(status: DrivingStatus): DrivingGuidanceView {
  return {
    status,
    validUntilMs: null,
    nextManeuver: null,
    followingManeuver: null,
    metersToNext: null,
    remainingMeters: null,
    remainingSeconds: null,
    matchedCoordinate: null,
    progress: null,
  };
}

function emptyState(route: DrivingGuidanceRoute, nowMs: number): DrivingGuidanceState {
  return {
    route,
    view: blank('ACQUIRING'),
    lastFix: null,
    course: null,
    latestObservationMs: null,
    match: null,
    acquisition: null,
    travelled: 0,
    // A TMAP start point describes the first road, including after a reroute.
    // Its distance is zero; the next maneuver is the first decision ahead.
    nextManeuverIndex: route.maneuvers[0]?.turnType === '200' ? 1 : 0,
    outsideSince: null,
    destinationSince: null,
    evaluatedAtMs: nowMs,
  };
}

function projected(edge: Edge, fix: DrivingLocationFix): Projection {
  const east = (fix.longitude - edge.start.longitude) * edge.metersPerLongitudeDegree;
  const north = (fix.latitude - edge.start.latitude) * METERS_PER_DEGREE;
  const t = Math.max(0, Math.min(1, (east * edge.east + north * edge.north) / (edge.length * edge.length)));
  return {
    along: edge.along + t * edge.length,
    cross: Math.hypot(east - t * edge.east, north - t * edge.north),
    coordinate: {
      latitude: edge.start.latitude + t * (edge.end.latitude - edge.start.latitude),
      longitude: edge.start.longitude + t * (edge.end.longitude - edge.start.longitude),
    },
  };
}

function chooseMatch(
  route: DrivingGuidanceRoute,
  fix: DrivingLocationFix,
  previous: Match | null,
  useCourse: boolean,
) {
  const candidates: Projection[] = [];
  let closestRoad = Infinity;
  let retreating = false;
  const allowance = Math.min(25, 12 + fix.accuracyMeters);
  const elapsed = previous ? (fix.observedAtMs - previous.at) / 1000 : 0;
  const min = previous ? previous.along - allowance : 0;
  const max = previous ? previous.along + elapsed * MAX_METERS_PER_SECOND + allowance : route.totalMeters;
  for (const edge of route.edges) {
    const p = projected(edge, fix);
    closestRoad = Math.min(closestRoad, p.cross);
    if (p.cross > allowance) continue;
    const headingError = useCourse ? Math.abs(((edge.bearing - fix.courseDegrees! + 540) % 360) - 180) : 0;
    if (previous && p.along < min && headingError > 120) retreating = true;
    if (p.along < min || p.along > max || headingError > 65) continue;
    candidates.push(p);
  }
  const nearest = candidates.reduce<Projection | null>(
    (best, p) => (!best || p.cross < best.cross ? p : best),
    null,
  );
  // Two locally plausible positions far apart along a loop represent different decisions.
  const ambiguous =
    nearest &&
    candidates.some(
      p =>
        Math.abs(p.along - nearest.along) > 40 && p.cross <= nearest.cross + Math.max(6, fix.accuracyMeters),
    );
  return {
    position: ambiguous ? null : nearest,
    outside: closestRoad > 35 + fix.accuracyMeters || (!nearest && retreating),
  };
}

function atDistance(route: DrivingGuidanceRoute, distance: number): DrivingCoordinate {
  const edge = route.edges.find(e => e.along + e.length >= distance) ?? route.edges[route.edges.length - 1];
  const t = Math.min(1, Math.max(0, (distance - edge.along) / edge.length));
  return {
    latitude: edge.start.latitude + t * (edge.end.latitude - edge.start.latitude),
    longitude: edge.start.longitude + t * (edge.end.longitude - edge.start.longitude),
  };
}

// TMAP road turnType groups for turns, forks, ramps and clock-face exits.
// Lane suggestions, pass-through landmarks and arrival points have no exit arrow.
const mappedTurns = new Set([
  '12', '13', '14', '15', '16', '17', '18', '19', '43', '44',
  '71', '72', '73', '74', '75', '76',
  '101', '102', '103', '104', '105', '106', '111', '112', '113', '114', '115', '116', '117', '118',
  '131', '132', '133', '134', '135', '136', '137', '138', '139', '140', '141', '142',
]);

/** Trace the *current occurrence* of the junction through its incoming and
 * outgoing links. The two short wings share the road tip and point down the
 * selected exit, so the map renderer can rotate and pitch the entire arrow. */
export function drivingTurnPath(route: DrivingGuidanceRoute, maneuver: DrivingManeuver): DrivingCoordinate[] {
  const index = route.maneuvers.indexOf(maneuver);
  if (index < 0 || !mappedTurns.has(maneuver.turnType)) return [];
  const junction = maneuver.alongMeters;
  const previous = route.maneuvers[index - 1]?.alongMeters;
  const next = route.maneuvers[index + 1]?.alongMeters;
  const from = Math.max(0, junction - 24, previous == null ? 0 : (previous + junction) / 2);
  const to = Math.min(route.totalMeters, junction + 26, next == null ? route.totalMeters : (next + junction) / 2);
  if (junction - from < 3 || to - junction < 5) return [];

  const shaft = [atDistance(route, from)];
  for (const edge of route.edges) {
    if (edge.along >= to) break;
    if (edge.along > from) shaft.push(edge.start);
  }
  const tip = atDistance(route, to);
  const wingLength = Math.min(8, (to - junction) * 0.45);
  const tangent = createEdge(atDistance(route, to - wingLength), tip, 0);
  if (tangent.length < 1) return [];
  function wing(side: number): DrivingCoordinate {
    // Heading is measured clockwise from geographic north.
    const angle = ((tangent.bearing + 180 + side * 35) * Math.PI) / 180;
    return {
      latitude: tip.latitude + wingLength * Math.cos(angle) / METERS_PER_DEGREE,
      longitude: tip.longitude + wingLength * Math.sin(angle) / tangent.metersPerLongitudeDegree,
    };
  }
  return [...shaft, tip, wing(-1), tip, wing(1)];
}

function remainingTime(route: DrivingGuidanceRoute, along: number): number | null {
  if (route.totalSeconds === null) return null;
  if (!route.timedLinks) return Math.round(route.totalSeconds * (1 - along / route.totalMeters));
  let remaining = 0;
  let total = 0;
  for (const link of route.timedLinks) {
    total += link.seconds;
    if (along < link.to) remaining += link.seconds * Math.min(1, (link.to - along) / (link.to - link.from));
  }
  return Math.round((route.totalSeconds * remaining) / total);
}

export function advanceDrivingGuidance(
  route: DrivingGuidanceRoute,
  previous: DrivingGuidanceState | null,
  fix: DrivingLocationFix,
  nowMs: number,
): DrivingGuidanceState {
  const old = previous?.route === route ? previous : emptyState(route, Number.isFinite(nowMs) ? nowMs : 0);
  if (old.view.status === 'ARRIVED' || !Number.isFinite(nowMs) || nowMs < old.evaluatedAtMs) return old;
  const prior = old.lastFix;
  const at = fix.observedAtMs;
  if (old.latestObservationMs !== null && Number.isFinite(at) && at <= old.latestObservationMs) return old;
  const validUntilMs = at > 0 && at <= nowMs && nowMs - at < FIX_FRESH_MS ? at + FIX_FRESH_MS : null;
  const state = { ...old, evaluatedAtMs: nowMs, view: {...blank('UNCERTAIN'), validUntilMs} };
  if (Number.isFinite(at) && at > 0 && at <= nowMs) state.latestObservationMs = at;
  if (
    !isWgs84Coordinate(fix.latitude, fix.longitude) ||
    !Number.isFinite(at) ||
    at <= 0 ||
    at > nowMs ||
    nowMs - at >= FIX_FRESH_MS ||
    !Number.isFinite(fix.accuracyMeters) ||
    fix.accuracyMeters < 0 ||
    fix.accuracyMeters > 30
  ) {
    return { ...state, acquisition: null, destinationSince: null, outsideSince: null };
  }
  const elapsed = prior ? (at - prior.observedAtMs) / 1000 : 0;
  const movement = prior ? meters(prior, fix) : 0;
  if (prior && movement > elapsed * MAX_METERS_PER_SECOND + prior.accuracyMeters + fix.accuracyMeters + 5) {
    return { ...state, acquisition: null, destinationSince: null, outsideSince: null };
  }
  state.lastFix = fix;
  const course = fix.courseDegrees;
  const useCourse =
    typeof course === 'number' && Number.isFinite(course) && course >= 0 && course < 360 && movement > 8;
  state.course = updateLocationCourse(old.course, fix);
  const candidate = chooseMatch(route, fix, old.acquisition ?? old.match, useCourse);
  if (!candidate.position) {
    const outsideSince = candidate.outside
      ? prior && elapsed < FIX_FRESH_MS / 1000
        ? old.outsideSince ?? at
        : at
      : null;
    const status = outsideSince !== null && at - outsideSince >= 3000 ? 'OFF_ROUTE' : 'UNCERTAIN';
    return { ...state, outsideSince, view: {...blank(status), validUntilMs}, acquisition: null, destinationSince: null };
  }
  const position = candidate.position;
  const along = Math.max(old.match?.along ?? 0, position.along);
  const freshChain = old.acquisition && at - old.acquisition.at < FIX_FRESH_MS;
  state.acquisition = { along, at };
  state.outsideSince = null;
  if (!freshChain) return { ...state, view: {...blank('ACQUIRING'), validUntilMs}, destinationSince: null };

  state.match = { along, at };
  if (old.match && old.view.status === 'GUIDING') state.travelled += along - old.match.along;
  const remain = Math.max(0, route.totalMeters - along);
  const end = route.coordinates[route.coordinates.length - 1];
  const atDestination =
    fix.accuracyMeters <= 12 &&
    remain + fix.accuracyMeters <= 20 &&
    meters(end, fix) + fix.accuracyMeters <= 20 &&
    state.travelled >= Math.min(40, route.totalMeters / 3);
  state.destinationSince = atDestination ? old.destinationSince ?? at : null;
  if (state.destinationSince !== null && at - state.destinationSince >= 6000) {
    return { ...state, view: { ...blank('ARRIVED'), validUntilMs, progress: 1, remainingMeters: 0, remainingSeconds: 0 } };
  }
  // Pass the turn only after clearing its coordinate beyond this fix's uncertainty.
  let nextIndex = old.nextManeuverIndex;
  while (
    nextIndex < route.maneuvers.length &&
    route.maneuvers[nextIndex].alongMeters < along - Math.max(4, fix.accuracyMeters)
  )
    nextIndex++;
  state.nextManeuverIndex = nextIndex;
  const next = route.maneuvers[nextIndex] ?? null;
  state.view = {
    status: 'GUIDING',
    validUntilMs: at + FIX_FRESH_MS,
    nextManeuver: next,
    followingManeuver: next ? route.maneuvers[nextIndex + 1] ?? null : null,
    metersToNext: next ? Math.round(Math.max(0, next.alongMeters - along)) : null,
    remainingMeters: Math.round(remain),
    remainingSeconds: remainingTime(route, along),
    progress: along / route.totalMeters,
    matchedCoordinate: along === position.along ? position.coordinate : atDistance(route, along),
  };
  return state;
}

export function readDrivingHeading(state: DrivingGuidanceState | null, nowMs: number): number | null {
  if (!state?.lastFix || state.latestObservationMs !== state.lastFix.observedAtMs ||
      state.view.status === 'UNCERTAIN' || state.view.status === 'ARRIVED') return null;
  return freshLocationCourse(state.course, nowMs);
}

export function readDrivingGuidance(state: DrivingGuidanceState | null, nowMs: number): DrivingGuidanceView {
  if (!state) return blank('ACQUIRING');
  if (state.view.status === 'ARRIVED') return state.view;
  if (
    !Number.isFinite(nowMs) ||
    nowMs < state.evaluatedAtMs ||
    !state.lastFix ||
    nowMs - state.lastFix.observedAtMs >= FIX_FRESH_MS
  ) {
    return blank('UNCERTAIN');
  }
  return state.view;
}
