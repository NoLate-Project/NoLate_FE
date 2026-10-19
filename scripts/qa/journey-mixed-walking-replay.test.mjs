import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedPassengerPoint,mixedHarnessAllowed} from './journey-mixed-walking-replay.mjs';
test('mixed replay guards fixed issuer and synthetic-only provider/APNs',()=>{
 const c={fixtureOnly:true,apiOrigin:'http://127.0.0.1:15546',memberId:7,guidancePushRealProvider:false,accessToken:'synthetic'};
 const s={fixtureOnly:true,syntheticMixedWalking:true,syntheticRideEnabled:true,guidancePushRealProvider:false};
 assert.equal(mixedHarnessAllowed(c,s),true);
 for(const x of [{...c,apiOrigin:'https://example.invalid'},{...c,guidancePushRealProvider:true},{...c,memberId:8}])assert.equal(mixedHarnessAllowed(x,s),false);
 assert.equal(mixedHarnessAllowed(c,{...s,syntheticMixedWalking:false}),false);
});
test('passenger remains at selected stop while independent bus departs, then walks',()=>{
 const start=1000;
 assert.ok(mixedPassengerPoint(start,start+40).longitude<mixedPassengerPoint(start,start+95).longitude);
 assert.ok(Math.abs(mixedPassengerPoint(start,start+140).longitude-126.9895)<0.00001);
 assert.ok(mixedPassengerPoint(start,start+180).longitude>126.9895);
 assert.ok(Math.abs(mixedPassengerPoint(start,start+225).longitude-126.991)<0.00001);
 assert.throws(()=>mixedPassengerPoint(NaN,0));
});
