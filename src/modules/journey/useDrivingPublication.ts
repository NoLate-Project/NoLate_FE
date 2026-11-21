import { useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  drivingTurnTitle,
  type DrivingGuidanceRoute,
  type DrivingGuidanceView,
  type DrivingManeuver,
} from './drivingGuidance';

type DrivingBridge = {
  openDrivingPublication(owner: string, scheduleId: string, destination: string): Promise<void>;
  publishDrivingGuidance(owner: string, json: string, voiceEnabled: boolean): Promise<void>;
  closeDrivingPublication(owner: string): Promise<void>;
  resetDrivingPublicationRoute?(owner: string): Promise<void>;
};

type DrivingVoicePreference = {
  drivingVoiceEnabled?(): boolean;
  setDrivingVoiceEnabled?(enabled: boolean): void;
};

function nativeVoicePreference() {
  return Platform.OS === 'ios' ? requireOptionalNativeModule<DrivingVoicePreference>('NoLateLiveActivity') : null;
}

export function readDrivingVoicePreference(): boolean {
  return nativeVoicePreference()?.drivingVoiceEnabled?.() === true;
}

export function saveDrivingVoicePreference(enabled: boolean) {
  nativeVoicePreference()?.setDrivingVoiceEnabled?.(enabled);
}

function display(value: string, max = 96): string {
  return Array.from(value).slice(0, max).join('').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
}

function turn(maneuver: DrivingManeuver) {
  return {
    title: display(drivingTurnTitle(maneuver)),
    road: display(maneuver.roadName ?? ''),
    type: maneuver.turnType,
  };
}

/** Only display values cross this bridge. No route shape, GPS coordinate, device ID or push token. */
export function drivingPublicationContent(route: DrivingGuidanceRoute, view: DrivingGuidanceView) {
  if (view.status !== 'GUIDING') return Number.isFinite(view.validUntilMs)
    ? {status: view.status, validUntilMs: view.validUntilMs} : {status: view.status};
  const index = view.nextManeuver ? route.maneuvers.indexOf(view.nextManeuver) : -1;
  const next = view.nextManeuver;
  const following = view.followingManeuver;
  const validDistance = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  if (!Number.isFinite(view.validUntilMs) || !validDistance(view.remainingMeters)
    || (view.remainingSeconds !== null && !validDistance(view.remainingSeconds))
    || (next && (index < 0 || !validDistance(view.metersToNext)))) return {status: 'UNCERTAIN'};
  return {
    status: 'GUIDING',
    validUntilMs: view.validUntilMs,
    remainingMeters: view.remainingMeters,
    remainingSeconds: view.remainingSeconds,
    next: next ? {...turn(next), index, meters: view.metersToNext} : null,
    following: next && following && route.maneuvers[index + 1] === following
      ? {...turn(following), index: index + 1, meters: Math.round(Math.max(0, following.alongMeters - next.alongMeters))}
      : null,
  };
}

// Serialize mutations globally. A delayed update or cleanup from an old screen cannot own a new session.
let pending = Promise.resolve();
function enqueue(operation: () => Promise<void>) {
  pending = pending.then(operation).catch(() => undefined);
}

type ActiveDrive = {token: string; route: DrivingGuidanceRoute | null; bridge: DrivingBridge; voice: boolean};
let activeDrive: ActiveDrive | null = null;
let sampleVersion = 0;

/** An active Core Location callback may run with a suspended React surface. Use its matched view
 * immediately. Native still requires proof of the source observation before updating behind lock. */
export function publishBackgroundDrivingObservation(route: DrivingGuidanceRoute, view: DrivingGuidanceView) {
  const drive = activeDrive;
  if (!drive || drive.route !== route || AppState.currentState === 'active') return;
  const version = ++sampleVersion;
  const json = JSON.stringify(drivingPublicationContent(route, view));
  enqueue(async () => {
    if (version === sampleVersion && activeDrive === drive) await drive.bridge.publishDrivingGuidance(drive.token, json, drive.voice);
  });
}

export function useDrivingPublication(scheduleId: string, destination: string, route: DrivingGuidanceRoute | null,
  view: DrivingGuidanceView, voiceEnabled: boolean) {
  const bridge = useMemo(() => Platform.OS === 'ios'
    ? requireOptionalNativeModule<DrivingBridge>('NoLateLiveActivity') : null, []);
  const owner = useRef<string | null>(null);
  const previousRoute = useRef(route);
  useEffect(() => {
    if (!bridge?.openDrivingPublication) return;
    const token = randomUUID();
    owner.current = token;
    enqueue(() => bridge.openDrivingPublication(token, scheduleId, display(destination)));
    return () => {
      if (activeDrive?.token === token) activeDrive = null;
      owner.current = null;
      enqueue(() => bridge.closeDrivingPublication(token));
    };
  }, [bridge, scheduleId, destination]);

  useEffect(() => {
    const token = owner.current;
    if (token && bridge) activeDrive = {token, route, bridge, voice: voiceEnabled};
    if (token && previousRoute.current !== route && bridge?.resetDrivingPublicationRoute) {
      enqueue(() => bridge.resetDrivingPublicationRoute!(token));
    }
    previousRoute.current = route;
  }, [bridge, route, voiceEnabled, scheduleId, destination]);

  const content = JSON.stringify(route ? drivingPublicationContent(route, view) : {status: 'ACQUIRING'});
  useEffect(() => {
    const token = owner.current;
    if (!bridge || !token || !content) return;
    let superseded = false;
    enqueue(async () => {
      if (!superseded && owner.current === token) await bridge.publishDrivingGuidance(token, content, voiceEnabled);
    });
    return () => { superseded = true; };
  }, [bridge, scheduleId, destination, route, content, voiceEnabled]);
}
