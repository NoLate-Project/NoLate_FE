import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { LocationSubscription } from 'expo-location';
import { watchDeviceHeading } from './currentLocation';

/** Phone orientation is useful on foot before there is enough displacement to measure a course. */
export function useWalkingCompass(scope: string | null) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [sample, setSample] = useState<{ scope: string; degrees: number } | null>(null);

  useEffect(() => {
    if (!scope || Platform.OS !== 'ios') return;
    setForeground(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, [scope]);

  useEffect(() => {
    setSample(null);
    if (!scope || Platform.OS !== 'ios' || !foreground || AppState.currentState !== 'active') return;
    let active = true;
    let subscription: LocationSubscription | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(expiry);
      if (active) setSample(null);
    };
    void watchDeviceHeading(heading => {
      if (!active) return;
      const degrees = heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
      if (!(heading.accuracy >= 2 && Number.isFinite(degrees) && degrees >= 0 && degrees < 360)) {
        clear();
        return;
      }
      clearTimeout(expiry);
      setSample({ scope, degrees });
      expiry = setTimeout(clear, 12_000);
    }, clear).then(result => {
      if (active) subscription = result;
      else result.remove();
    }).catch(clear);
    return () => {
      active = false;
      clearTimeout(expiry);
      subscription?.remove();
    };
  }, [scope, foreground]);

  return scope && foreground && sample?.scope === scope ? sample.degrees : null;
}
