export type CourseObservation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  observedAtMs: number;
  courseDegrees?: number | null;
};

export type LocationCourse = {
  anchor: CourseObservation;
  heading: { degrees: number; observedAtMs: number } | null;
};

const freshMs = 12_000;

// Small successive steps can establish a direction together. Fresh timestamps
// at rest must never extend the lifetime of the last measured direction.
export function updateLocationCourse(previous: LocationCourse | null, fix: CourseObservation): LocationCourse {
  const anchor = previous?.anchor;
  if (!previous || !anchor || fix.observedAtMs - anchor.observedAtMs >= freshMs) return { anchor: fix, heading: null };
  if (fix.observedAtMs <= anchor.observedAtMs) return previous;
  const east = (fix.longitude - anchor.longitude) * 111195 * Math.cos((fix.latitude + anchor.latitude) * Math.PI / 360);
  const north = (fix.latitude - anchor.latitude) * 111195;
  const displacement = Math.hypot(north, east);
  const uncertainty = anchor.accuracyMeters + fix.accuracyMeters;
  if (displacement < Math.max(8, uncertainty)) return previous;
  if (displacement > 60 * (fix.observedAtMs - anchor.observedAtMs) / 1000 + uncertainty + 5) {
    return { anchor: fix, heading: null };
  }
  const course = fix.courseDegrees;
  const degrees = typeof course === 'number' && course >= 0 && course < 360
    ? course : (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  return { anchor: fix, heading: { degrees, observedAtMs: fix.observedAtMs } };
}

export function freshLocationCourse(state: LocationCourse | null, nowMs: number): number | null {
  if (!state?.heading) return null;
  const age = nowMs - state.heading.observedAtMs;
  return age >= 0 && age < freshMs ? state.heading.degrees : null;
}
