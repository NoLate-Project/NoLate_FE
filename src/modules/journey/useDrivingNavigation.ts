import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import * as Location from 'expo-location';
import type { Place } from '../schedule/types';
import { publishBackgroundDrivingObservation } from './useDrivingPublication';
import { watchDrivingLocation } from './drivingLocation';
import { ensureForegroundPermission } from '../map/currentLocation';
import { distanceBetweenCoordsMeters, isWgs84Coordinate } from '../map/tmapApiCore';
import { getDrivingRouteViaTmap } from '../map/tmapRouteProviders';
import {
  advanceDrivingGuidance,
  prepareDrivingGuidance,
  readDrivingGuidance,
  readDrivingHeading,
  type DrivingGuidanceRoute,
  type DrivingGuidanceState,
  type DrivingLocationFix,
} from './drivingGuidance';

type LocatedPlace = Place & { lat: number; lng: number };

function located(place?: Place | null): place is LocatedPlace {
  return (
    typeof place?.lat === 'number' && typeof place.lng === 'number' && isWgs84Coordinate(place.lat, place.lng)
  );
}

export function canStartSavedDrive(origin?: Place | null, destination?: Place | null) {
  return located(origin) && located(destination) && distanceBetweenCoordsMeters(origin, destination) > 10;
}

function matchesTrip(route: DrivingGuidanceRoute | null, a: Place, b: Place): route is DrivingGuidanceRoute {
  if (!route || !located(a) || !located(b)) return false;
  const start = route.coordinates[0];
  const end = route.coordinates[route.coordinates.length - 1];
  return (
    distanceBetweenCoordsMeters(a, { lat: start.latitude, lng: start.longitude }) <= 300 &&
    distanceBetweenCoordsMeters(b, { lat: end.latitude, lng: end.longitude }) <= 300
  );
}

export function useDrivingNavigation(savedRoute: unknown, origin: Place, destination: Place) {
  const trip = useMemo(() => {
    const candidate = prepareDrivingGuidance(savedRoute);
    const route = matchesTrip(candidate, origin, destination) ? candidate : null;
    return { route, request: route ? null : { start: origin }, failed: false };
  }, [savedRoute, origin, destination]);
  const [lookup, setLookup] = useState<{
    trip: typeof trip;
    route: DrivingGuidanceRoute | null;
    request: { start: Place } | null;
    failed: boolean;
  } | null>(null);
  const { route, request, failed: routeError } = lookup?.trip === trip ? lookup : trip;
  const searchOption = (savedRoute as { providerRouteOption?: unknown } | null)?.providerRouteOption;
  useEffect(() => {
    if (!request) return;
    let active = true;
    const { start } = request;
    const option =
      typeof searchOption === 'string' && ['0', '1', '2'].includes(searchOption) ? searchOption : '0';
    function finish(next: DrivingGuidanceRoute | null) {
      if (!active) return;
      setLookup(previous => {
        const current = previous?.trip === trip ? previous : trip;
        // Rejoining the old road or requesting a newer route supersedes this response.
        if (current.request !== request) return previous;
        return { trip, route: next ?? current.route, request: null, failed: !next };
      });
    }
    async function refresh() {
      const response = await getDrivingRouteViaTmap(start, destination, option);
      const next = prepareDrivingGuidance({ ...response, mode: 'CAR', provider: 'tmap', source: 'api' });
      finish(matchesTrip(next, start, destination) ? next : null);
    }
    refresh().catch(() => finish(null));
    return () => { active = false; };
  }, [trip, request, destination, searchOption]);

  const state = useRef<DrivingGuidanceState | null>(null);
  const [now, setNow] = useState(Date.now);
  const [locationError, setLocationError] = useState('');
  const [retry, setRetry] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);
  const routeRef = useRef(route);
  useLayoutEffect(() => {
    routeRef.current = route;
  }, [route]);
  const [nativeFeed, setNativeFeed] = useState(false);
  // A drive begun while the app was visible can continue through a locked screen or a
  // route refresh. Older binaries only provide Expo's foreground location watcher.
  const mayWatch = focused && !!route && (foreground || nativeFeed);
  useEffect(() => {
    if (!mayWatch) return;
    let active = true;
    let subscription: Location.LocationSubscription | undefined;
    let arrived = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    setLocationError('');
    function receive(fix: DrivingLocationFix, nativeSource = false) {
      const currentRoute = routeRef.current;
      if (!active || arrived || !currentRoute) return;
      const at = Date.now();
      const previousStatus = state.current?.view.status;
      state.current = advanceDrivingGuidance(currentRoute, state.current, fix, at);
      const status = state.current.view.status;
      if (status !== previousStatus && (status === 'GUIDING' || status === 'ARRIVED')) {
        setLookup(current => current?.trip === trip && current.route === currentRoute && (current.request || current.failed)
          ? { ...current, request: null, failed: false }
          : current);
      }
      if (nativeSource) publishBackgroundDrivingObservation(currentRoute, readDrivingGuidance(state.current, at));
      setLocationError('');
      setNow(at);
      if (state.current.view.status === 'ARRIVED') {
        arrived = true;
        subscription?.remove();
        subscription = undefined;
        clearInterval(tick);
      }
    }
    function unavailable() {
      if (!active || arrived) return;
      setLocationError('현재 위치를 받을 수 없어요.');
      setNow(Date.now());
    }
    async function start() {
      await ensureForegroundPermission();
      if (!active) return;
      const native = await watchDrivingLocation(fix => receive(fix, true), unavailable);
      if (native) {
        if (active && !arrived) {
          subscription = native;
          setNativeFeed(true);
        } else native.remove();
        return;
      }
      if (!active) return;
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        sample =>
          receive({
            latitude: sample.coords.latitude,
            longitude: sample.coords.longitude,
            observedAtMs: sample.timestamp,
            accuracyMeters: sample.coords.accuracy ?? -1,
            courseDegrees: sample.coords.heading,
          }),
        unavailable,
      );
      if (active && !arrived) subscription = watcher;
      else watcher.remove();
    }
    start().catch(error => {
      if (active) setLocationError(error instanceof Error ? error.message : '현재 위치를 받을 수 없어요.');
    });
    return () => {
      active = false;
      subscription?.remove();
      clearInterval(tick);
      setNativeFeed(false);
      if (!arrived) state.current = null;
    };
  }, [mayWatch, retry, trip]);
  const tracking =
    !locationError && (foreground || nativeFeed) && focused && state.current?.route === route
      ? state.current
      : null;
  const view = readDrivingGuidance(tracking, now);
  // The road can change between two fixes. Keep the last valid source marker
  // until Core Location supplies the first observation for the replacement road.
  const positionState = tracking ?? (
    !locationError && focused && (foreground || nativeFeed) && lookup?.trip === trip &&
    route && state.current?.view.status === 'OFF_ROUTE' ? state.current : null
  );
  const fix = positionState?.lastFix;
  const freshFix =
    fix &&
    positionState?.latestObservationMs === fix.observedAtMs &&
    view.status !== 'UNCERTAIN' &&
    now >= fix.observedAtMs &&
    now - fix.observedAtMs < 12000 &&
    fix.accuracyMeters >= 0 &&
    fix.accuracyMeters <= 30
      ? fix
      : null;
  // Ignore a single wrong-side-of-street fix. Re-request only after sustained, accurate
  // off-route evidence and throttle subsequent requests if the road geometry remains distant.
  const lastRerouteAt = useRef(0);
  useEffect(() => { lastRerouteAt.current = 0; }, [trip]);
  const outsideSince = tracking?.outsideSince;
  useEffect(() => {
    if (
      request ||
      view.status !== 'OFF_ROUTE' ||
      !freshFix ||
      outsideSince == null ||
      freshFix.accuracyMeters > 20 ||
      freshFix.observedAtMs - outsideSince < 12000 ||
      now - lastRerouteAt.current < 60000
    )
      return;
    lastRerouteAt.current = now;
    setLookup({ trip, route, request: { start: { lat: freshFix.latitude, lng: freshFix.longitude } }, failed: false });
  }, [trip, route, request, view.status, freshFix, outsideSince, now]);
  const refreshRoute = () => {
    const current =
      view.status === 'OFF_ROUTE' && freshFix ? { lat: freshFix.latitude, lng: freshFix.longitude } : null;
    if (request || (route && !current)) return;
    lastRerouteAt.current = Date.now();
    setLookup({ trip, route, request: { start: current ?? origin }, failed: false });
  };
  const departureConfirmed = view.status === 'GUIDING' && (tracking?.travelled ?? 0) >= 60;
  return {
    route,
    view,
    freshFix,
    heading: freshFix ? readDrivingHeading(positionState, now) : null,
    locationError,
    routeError,
    rerouting: !!route && !!request,
    now,
    refreshRoute,
    departureConfirmed,
    retryLocation: () => setRetry(n => n + 1),
  };
}
