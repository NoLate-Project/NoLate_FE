import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {buildScenario} from './journey-bus-location-replay.mjs';
import {passengerPoint} from './journey-bus-ride-replay.mjs';

const origin='http://127.0.0.1:15546';
export const mixedDevice='4EE367B1-CDC6-4585-A64B-CB554EEB7DE2';
const scale=6_371_000*Math.PI/180*Math.cos(37.5665*Math.PI/180);
export function mixedPassengerPoint(start,now) {
 if(![start,now].every(Number.isFinite))throw Error('FINITE_SYNTHETIC_CLOCK_REQUIRED');
 const elapsed=Math.max(0,now-start),target=scale*0.01;
 if(elapsed<=140)return passengerPoint(start,now,target);
 const meters=Math.min(target*0.15,(elapsed-140)*2.4);
 return {latitude:37.5665,longitude:126.9895+(meters+(meters===target*0.15?Math.sin(elapsed)*0.3:0))/scale};
}
export function mixedHarnessAllowed(context,state) {
 return context?.fixtureOnly===true&&context.apiOrigin===origin&&context.memberId===7
  &&context.guidancePushRealProvider===false&&typeof context.accessToken==='string'
  &&state?.fixtureOnly===true&&state.syntheticMixedWalking===true&&state.syntheticRideEnabled===true
  &&state.guidancePushRealProvider===false;
}
async function main(args) {
 if(args.length!==2||args[0]!=='--device'||args[1]!==mixedDevice)throw Error('FIXED_ISOLATED_DEVICE_REQUIRED');
 const inventory=JSON.parse(execFileSync('xcrun',['simctl','list','devices','booted','--json'],{encoding:'utf8'}));
 if(!Object.values(inventory.devices).flat().some(d=>d.udid===mixedDevice&&d.name==='NoLate Mixed Journey E2E 20261012'&&d.state==='Booted'))throw Error('DEVICE_MISMATCH');
 const context=await(await fetch(origin+'/__fixture/context',{redirect:'error',signal:AbortSignal.timeout(4000)})).json();
 async function request(path,body) {
  const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${context.accessToken}`,'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw Error('FIXTURE_REQUEST_FAILED');return r.json();
 }
 const state=await request('/__fixture/state');
 if(!mixedHarnessAllowed(context,state))throw Error('SYNTHETIC_ONLY_HARNESS_REQUIRED');
 const set=p=>execFileSync('xcrun',['simctl','location',mixedDevice,'set',`${p.latitude},${p.longitude}`]);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 await request('/__fixture/ride-control',{mode:'EMPTY'});
 // Input only; no app bridge, departure/boarding/alighting/arrival phase API.
 for(const name of ['walk','dwell']) {
  console.log(`SYNTHETIC passenger GPS: ${name}`);
  const scenario=buildScenario(name);
  for(const p of scenario.points){set(p);await wait(name==='walk'?3000:4000);}
 }
 const clock=await request('/__fixture/ride-control',{mode:'FRESH'});
 if(clock.fixtureOnly!==true||clock.mode!=='FRESH'||!Number.isFinite(clock.startAt)
  ||clock.startAt<Date.now()/1000||clock.startAt>Date.now()/1000+4)throw Error('SYNTHETIC_CLOCK_INVALID');
 console.log('Independent vehicle clock started; passenger GPS follows, then separates and walks');
 let lastMilestone=-1;
 while(Date.now()/1000<clock.startAt+235){
  const now=Date.now()/1000,milestone=Math.floor((now-clock.startAt)/20);
  if(milestone>lastMilestone){lastMilestone=milestone;console.log(`Synthetic elapsed ${milestone*20}s at ${new Date().toISOString()}`);}
  set(mixedPassengerPoint(clock.startAt,now));await wait(1000);
 }
 await request('/__fixture/ride-control',{mode:'EMPTY'});
 console.log('Replay ended; inspect independent window. No phase was forced; no real provider/APNs used');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(()=>{
 console.error('Mixed synthetic replay failed; private data suppressed');process.exitCode=1;
});
