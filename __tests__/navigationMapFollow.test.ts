import { shouldMoveFollowingCamera, shouldPauseFollowingCamera } from '../src/routeSupport/schedule/navigationMapFollow';

const position = { latitude: 37.502, longitude: 127.027 };

describe('navigation map follow', () => {
  it('keeps the camera stable through GPS jitter while following a real move', () => {
    expect(shouldMoveFollowingCamera(undefined, position)).toBe(true);
    expect(shouldMoveFollowingCamera(position, { ...position, latitude: position.latitude + 0.00003 })).toBe(false);
    expect(shouldMoveFollowingCamera(position, { ...position, latitude: position.latitude + 0.0002 })).toBe(true);
  });

  it('lets the rider inspect another area without snapping the map back', () => {
    const pannedCamera = { ...position, longitude: position.longitude + 0.001 };
    expect(shouldPauseFollowingCamera(pannedCamera, position, 1000, 1600)).toBe(false);
    expect(shouldPauseFollowingCamera(pannedCamera, position, 1700, 1600)).toBe(true);
    expect(shouldPauseFollowingCamera(position, position, 1700, 1600)).toBe(false);
  });
});
