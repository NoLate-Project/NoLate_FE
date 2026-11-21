import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import type { DrivingLocationFix } from './drivingGuidance';

type Sample = DrivingLocationFix & { owner: string };
type FeedEvent = { owner: string; samples?: Sample[]; error?: string };
type NativeFeed = {
  startDrivingLocation(token: string): Promise<string>;
  stopDrivingLocation(token: string): Promise<void>;
  latestDrivingLocation(token: string): Promise<Sample | null>;
  addListener(name: string, callback: (value: FeedEvent) => void): { remove(): void };
};

/** Starts only on explicit foreground drive entry. Core Location delivers the same timestamped observations
 * while locked; the owning JS matcher, validation thresholds and maneuver ordering are unchanged. */
export async function watchDrivingLocation(onFix: (fix: DrivingLocationFix) => void, onError: (reason: string) => void):
  Promise<{ remove(): void } | null> {
  const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeFeed>('NoLateLiveActivity') : null;
  if (!native?.startDrivingLocation) return null;
  const owner = randomUUID();
  let active = true;
  let lastTime = 0;
  function ingest(sample: Sample) {
    if (!active || sample.owner !== owner || !Number.isFinite(sample.observedAtMs) || sample.observedAtMs <= lastTime) return;
    lastTime = sample.observedAtMs;
    const {latitude, longitude, accuracyMeters, observedAtMs, courseDegrees} = sample;
    onFix({latitude, longitude, accuracyMeters, observedAtMs, courseDegrees});
  }
  const observer = native.addListener('onDrivingLocation', event => {
    if (!active || event?.owner !== owner) return;
    if (event.error) { onError(event.error); return; }
    event.samples?.forEach(ingest);
  });
  function remove() {
    if (!active) return;
    active = false;
    observer.remove();
    native?.stopDrivingLocation(owner).catch(() => undefined);
  }
  try {
    const status = await native.startDrivingLocation(owner);
    if (status !== 'STARTED') {
      if (status === 'FOREGROUND_REQUIRED') throw new Error('앱을 열고 주행 안내를 시작해 주세요.');
      if (status === 'PERMISSION_REQUIRED') throw new Error('위치 접근을 허용한 뒤 다시 시도해 주세요.');
      throw new Error('주행 위치를 시작하지 못했어요.');
    }
    // The observer is registered before start. An immediate fix can also be replayed once, preserving its
    // timestamp. No history survives stop, module teardown or process termination.
    const sample = await native.latestDrivingLocation(owner);
    if (sample) ingest(sample);
    return {remove};
  } catch (error) {
    remove();
    throw error;
  }
}
