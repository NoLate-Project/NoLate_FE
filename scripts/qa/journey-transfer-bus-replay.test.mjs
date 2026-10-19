import test from 'node:test';
import assert from 'node:assert/strict';
import {transferPoint,transferPassengerMeters,transferReplayOptions} from './journey-transfer-bus-replay.mjs';
import {mixedDevice} from './journey-mixed-walking-replay.mjs';
test('extra dwell is explicit, bounded, and restricted to the same isolated device',()=>{
 assert.deepEqual(transferReplayOptions(['--device',mixedDevice]),{holdTransferWaitSeconds:0,preDepartureDwellSeconds:0});
 assert.deepEqual(transferReplayOptions(['--device',mixedDevice,'--hold-transfer-wait']),{holdTransferWaitSeconds:60,preDepartureDwellSeconds:0});
 assert.deepEqual(transferReplayOptions(['--device',mixedDevice,'--long-navigation']),{holdTransferWaitSeconds:0,preDepartureDwellSeconds:240});
 for(const args of [[],['--device','other'],['--device',mixedDevice,'--force'],['--device',mixedDevice,'--hold-transfer-wait','60']])
  assert.throws(()=>transferReplayOptions(args));
});
test('synthetic replay follows each bus then stays behind while its independent vehicle departs',()=>{
 assert.equal(transferPassengerMeters(1,0),80);assert.equal(transferPassengerMeters(3,0),390);
 assert.ok(Math.abs(transferPassengerMeters(1,60)-380)<0.3);
 assert.ok(Math.abs(transferPassengerMeters(1,120)-380)<0.3);
 assert.ok(Math.abs(transferPassengerMeters(1,160)-390)<0.3);
 assert.ok(Math.abs(transferPassengerMeters(3,190)-760)<0.3);
 assert.equal(transferPassengerMeters(3,20),510);
 assert.ok(Math.abs(transferPassengerMeters(3,75)-690)<0.3);
 for(const leg of [1,3])for(let t=0;t<220;t++){
  const a=transferPassengerMeters(leg,t),b=transferPassengerMeters(leg,t+1);
  assert.ok(Math.abs(b-a)<=10.5);assert.doesNotThrow(()=>transferPoint(a));
 }
});
test('invalid clocks occurrences and external coordinates are rejected',()=>{
 for(const value of [-1,772,NaN,Infinity])assert.throws(()=>transferPoint(value));
 for(const leg of [0,2,5])assert.throws(()=>transferPassengerMeters(leg,10));
 assert.throws(()=>transferPassengerMeters(1,NaN));
});
