import test from 'node:test';
import assert from 'node:assert/strict';
import { passengerPoint, rideDevice } from './journey-bus-ride-replay.mjs';
test('driver is pinned to the new independent R2 simulator', () => assert.equal(rideDevice,'96AF9A48-4721-4335-B7BF-10B9382B7A30'));
test('artificial passenger trajectory follows a scenario clock, not a vehicle response', () => {
  const a=passengerPoint(1000,1000),b=passengerPoint(1000,1010);
  assert.equal(a.latitude,37.5665); assert.equal(a.longitude,126.9795); assert.ok(b.longitude>a.longitude);
});
test('pre-start and post-end passenger position are bounded', () => {
  assert.deepEqual(passengerPoint(1000,999),passengerPoint(1000,1000));
  const scale=6_371_000*Math.PI/180*Math.cos(37.5665*Math.PI/180);
  for(const now of[1061,1062,1100,2000])assert.ok(Math.abs((passengerPoint(1000,now).longitude-passengerPoint(1000,1060).longitude)*scale)<=0.501);
  assert.notEqual(passengerPoint(1000,1061).longitude,passengerPoint(1000,1062).longitude);
});
test('invalid clocks cannot create synthetic positions', () => {
  for(const value of[NaN,Infinity,undefined])assert.throws(()=>passengerPoint(value,1000));
});
