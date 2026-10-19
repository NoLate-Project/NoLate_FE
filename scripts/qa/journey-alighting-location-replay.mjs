import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildScenario } from './journey-bus-location-replay.mjs';
import { passengerPoint, rideDevice } from './journey-bus-ride-replay.mjs';

export const alightingTargetMeters = 6_371_000 * Math.PI / 180 * Math.cos(37.5665 * Math.PI / 180) * 0.01;
export const alightingPoint = (start, now) => passengerPoint(start, now, alightingTargetMeters);
export function finalWalkingPoint(start, now) {
  if (![start, now].every(Number.isFinite)) throw new Error('Finite synthetic clock required');
  const elapsed = now - start;
  if (elapsed <= 160) return alightingPoint(start, now);
  const length = alightingTargetMeters * 0.15;
  const walkingMeters = Math.min(length,Math.max(0,elapsed-160)*1.5);
  const jitter = walkingMeters === length ? Math.sin(elapsed)*0.3 : 0;
  return {latitude:37.5665,longitude:126.9895+(walkingMeters+jitter)/(alightingTargetMeters/0.01)};
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function control(mode) {
  const r = await fetch('http://127.0.0.1:15544/__fixture/ride-control', { method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode}),redirect:'error',signal:AbortSignal.timeout(4000) });
  const value=await r.json();
  if(!r.ok || value.fixtureOnly!==true || value.mode!==mode)throw new Error('Synthetic vehicle fixture required');
  return value;
}
export function validateAlightingHarness(state,requireSeparation=false,allowRealApns=false) {
  if(state.fixtureOnly!==true || state.syntheticRideEnabled!==true || state.syntheticAlightingApproachEnabled!==true
    || state.guidancePushRealProvider!==allowRealApns || (requireSeparation && state.syntheticSeparationEnabled!==true)
    || (allowRealApns && (!requireSeparation || state.durableFixture===true)))throw new Error('Synthetic alighting harness required');
}
export function validateReplayArgs(args,{requireSeparation=false,finalWalking=false}={}) {
  const allowRealApns=args.length===3 && args[2]==='--allow-real-apns';
  if((args.length!==2 && !allowRealApns) || args[0]!=='--device' || args[1]!==rideDevice
    || (allowRealApns && (!requireSeparation || !finalWalking)))throw new Error('Fixed isolated simulator required');
  return allowRealApns;
}
export async function runAlightingReplay(args,{requireSeparation=false,finalWalking=false}={}) {
  if(finalWalking && !requireSeparation)throw new Error('Separation fixture required before walking');
  const allowRealApns=validateReplayArgs(args,{requireSeparation,finalWalking});
  const devices=JSON.parse(execFileSync('xcrun',['simctl','list','devices','booted','--json'],{encoding:'utf8'}));
  if(!Object.values(devices.devices).flat().some(d=>d.udid===rideDevice && d.name==='NoLate R2 Session E2E 20261008' && d.state==='Booted'))throw new Error('Wrong simulator');
  const state=await (await fetch('http://127.0.0.1:15544/__fixture/state',{redirect:'error',signal:AbortSignal.timeout(4000)})).json();
  validateAlightingHarness(state,requireSeparation,allowRealApns);
  const set=p=>execFileSync('xcrun',['simctl','location',rideDevice,'set',`${p.latitude},${p.longitude}`]);
  await control('EMPTY');
  for(const name of['walk','dwell']) {
    const scenario=buildScenario(name); console.log(`Passenger GPS only: ${name}`);
    for(const p of scenario.points){set(p);await sleep(scenario.intervalMs);}
  }
  // Independent server clock controls vehicles; this process injects only passenger GPS.
  const {startAt}=await control('FRESH');
  if(!Number.isFinite(startAt) || startAt<Date.now()/1000 || startAt>Date.now()/1000+4)throw new Error('Invalid fixture clock');
  console.log('Bus GPS: pass penultimate stop, approach target, then remain on bus at target');
  if(requireSeparation) console.log('Independent fixture bus pauses then departs; passenger GPS remains at target. No alighting phase is forced.');
  if(finalWalking) console.log('After independent bus departure, passenger walks at 1.5 m/s on the saved final geometry; no phase input.');
  const point=finalWalking?finalWalkingPoint:alightingPoint;
  while(Date.now()/1000<startAt+(finalWalking?280:180)){set(point(startAt,Date.now()/1000));await sleep(1000);}
  await control('EMPTY');console.log('Remove vehicle evidence; keep fresh passenger GPS for 25 seconds');
  const until=Date.now()+25_000;
  while(Date.now()<until){set(point(startAt,Date.now()/1000));await sleep(1000);}
  if(finalWalking){execFileSync('xcrun',['simctl','location',rideDevice,'clear']);console.log('Location injection cleared; verify expiry without a fresh fix');}
  console.log('Replay complete; no alighting/walking/arrival phase was forced');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)runAlightingReplay(process.argv.slice(2)).catch(()=>{
  console.error('Synthetic alighting replay failed; no private data emitted');process.exitCode=1;
});
