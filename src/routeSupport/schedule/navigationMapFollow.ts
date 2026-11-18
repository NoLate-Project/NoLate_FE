type MapCoord = { latitude: number; longitude: number };

function distanceMeters(a: MapCoord, b: MapCoord): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(b.latitude - a.latitude);
  const lngDelta = radians(b.longitude - a.longitude);
  const arc = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lngDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

export function shouldMoveFollowingCamera(previous: MapCoord | undefined, next: MapCoord): boolean {
  return !previous || distanceMeters(previous, next) >= 8;
}

export function shouldPauseFollowingCamera(camera: MapCoord, position: MapCoord, now: number, commandUntil: number): boolean {
  return now >= commandUntil && distanceMeters(camera, position) > 45;
}
