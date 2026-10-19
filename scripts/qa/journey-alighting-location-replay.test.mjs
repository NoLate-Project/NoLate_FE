import test from 'node:test';
import assert from 'node:assert/strict';
import { alightingPoint, alightingTargetMeters, finalWalkingPoint, validateAlightingHarness, validateReplayArgs } from './journey-alighting-location-replay.mjs';
import { rideDevice } from './journey-bus-ride-replay.mjs';
test('real APNs replay requires explicit opt-in and pinned final walking simulator',()=>{
  const args=['--device',rideDevice];
  const options={requireSeparation:true,finalWalking:true};
  assert.equal(validateReplayArgs(args,options),false);
  assert.equal(validateReplayArgs([...args,'--allow-real-apns'],options),true);
  for(const bad of[[...args,'--allow-real-apns','extra'],['--device','other','--allow-real-apns'],[...args,'--real']])
    assert.throws(()=>validateReplayArgs(bad,options));
  assert.throws(()=>validateReplayArgs([...args,'--allow-real-apns']));
  const state={fixtureOnly:true,syntheticRideEnabled:true,syntheticAlightingApproachEnabled:true,syntheticSeparationEnabled:true,guidancePushRealProvider:true};
  assert.throws(()=>validateAlightingHarness(state,true));
  assert.doesNotThrow(()=>validateAlightingHarness(state,true,true));
  assert.throws(()=>validateAlightingHarness({...state,guidancePushRealProvider:false},true,true));
  assert.throws(()=>validateAlightingHarness({...state,durableFixture:true},true,true));
});
test('target is the artificial third stop, not the destination or a real route',()=>{
  assert.ok(alightingTargetMeters>800 && alightingTargetMeters<1000);
  const p=alightingPoint(1000,1000+alightingTargetMeters/10);
  assert.ok(Math.abs(p.longitude-126.9895)<1e-10);
});
test('passenger GPS moves continuously and then remains within half a metre of target',()=>{
  assert.ok(alightingPoint(1000,1050).longitude>alightingPoint(1000,1030).longitude);
  const scale=alightingTargetMeters/0.01;
  for(const time of[1100,1150,1180])assert.ok(Math.abs((alightingPoint(1000,time).longitude-126.9895)*scale)<=0.501);
});
test('invalid scenario clocks cannot produce GPS samples',()=>{
  for(const bad of[NaN,Infinity,undefined])assert.throws(()=>alightingPoint(bad,1000));
});
test('separation replay requires explicit synthetic extension and no real push provider',()=>{
  const state={fixtureOnly:true,syntheticRideEnabled:true,syntheticAlightingApproachEnabled:true,guidancePushRealProvider:false};
  assert.doesNotThrow(()=>validateAlightingHarness(state));assert.throws(()=>validateAlightingHarness(state,true));
  assert.doesNotThrow(()=>validateAlightingHarness({...state,syntheticSeparationEnabled:true},true));
  for(const key of['fixtureOnly','syntheticRideEnabled','syntheticAlightingApproachEnabled','syntheticSeparationEnabled'])
    assert.throws(()=>validateAlightingHarness({...state,syntheticSeparationEnabled:true,[key]:false},true));
  assert.throws(()=>validateAlightingHarness({...state,syntheticSeparationEnabled:true,guidancePushRealProvider:true},true));
});
test('final walk starts only after the passenger waits for departure, and stays on saved geometry',()=>{
  for(const t of[1050,1100,1159])assert.deepEqual(finalWalkingPoint(1000,t),alightingPoint(1000,t));
  const scale=alightingTargetMeters/0.01;
  assert.ok(Math.abs((finalWalkingPoint(1000,1180).longitude-126.9895)*scale-30)<0.0001);
  assert.ok(Math.abs(finalWalkingPoint(1000,1250).longitude-126.991)<0.00001);
  assert.ok(finalWalkingPoint(1000,1190).longitude>finalWalkingPoint(1000,1180).longitude);
  for(const bad of[NaN,Infinity,undefined])assert.throws(()=>finalWalkingPoint(bad,1000));
});
