import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenario, isolatedDevice } from './journey-bus-location-replay.mjs';

test('trace targets the explicitly approved isolated simulator', () => {
  assert.equal(isolatedDevice, '2847D4CF-88EA-4DA1-87E9-FD1948F58E01');
});
test('walking ends at the synthetic boarding stop, not a phase injection', () => {
  const { points, intervalMs } = buildScenario('walk');
  assert.equal(intervalMs, 4000);
  assert.equal(points[0].latitude, 37.5665);
  assert.equal(points[0].longitude, 126.978);
  assert.equal(points.at(-1).longitude, 126.9795);
  assert.ok(points.every((p, i) => i === 0 || p.longitude > points[i - 1].longitude));
});
test('dwell exceeds twelve seconds with only sub-meter synthetic movement', () => {
  const { points, intervalMs } = buildScenario('dwell');
  assert.ok((points.length - 1) * intervalMs >= 12000);
  assert.ok(points.every(p => Math.abs(p.longitude - 126.9795) < 0.00001));
});
test('candidate and pedestrian traces remain distinct while using the same stop', () => {
  const fast = buildScenario('candidate'); const walk = buildScenario('walk-past');
  assert.equal(fast.intervalMs, 1000);
  assert.equal(fast.points.length, 41);
  assert.deepEqual(fast.points[0], walk.points[0]);
  assert.ok(fast.points.at(-1).longitude > walk.points.at(-1).longitude);
  assert.ok(fast.intervalMs < walk.intervalMs);
  assert.ok((fast.points.length - 1) * fast.intervalMs >= 12000);
});
test('negative traces supply location errors without setting journey state', () => {
  const reverse = buildScenario('reverse').points;
  assert.ok(reverse.at(-1).longitude < reverse[0].longitude);
  assert.ok(buildScenario('off-route').points[0].latitude > 37.567);
  assert.throws(() => buildScenario('RIDING'));
});
test('waiting monitor keeps fresh GPS input without moving beyond the stop', () => {
  const { points, intervalMs } = buildScenario('waiting-monitor');
  assert.equal(intervalMs, 4000);
  assert.equal((points.length - 1) * intervalMs, 240000);
  assert.ok(points.every(p => Math.abs(p.longitude - 126.9795) < 0.00001));
});
test('marker trace departs by GPS and then stays within first walk, not a timed route position', () => {
  const { points, intervalMs } = buildScenario('marker-walk');
  assert.equal(intervalMs, 4000);
  assert.equal(points[0].longitude, 126.978);
  assert.ok(points.slice(4).every(p => p.longitude < 126.9795));
  assert.ok(points[4].longitude > points[3].longitude);
  const monitor = buildScenario('marker-monitor');
  assert.equal((monitor.points.length - 1) * monitor.intervalMs, 48000);
  assert.ok(monitor.points.every(p => p.longitude >= points[4].longitude && p.longitude <= points[5].longitude));
  const finish = buildScenario('marker-finish');
  assert.deepEqual(finish.points[0], points.at(-1));
  assert.equal(finish.points.at(-1).longitude, 126.9795);
  assert.ok(finish.points.every((p, i) => i === 0 || p.longitude > finish.points[i - 1].longitude));
});
