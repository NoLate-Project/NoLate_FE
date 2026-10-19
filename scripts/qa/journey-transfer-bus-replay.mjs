import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {mixedDevice} from './journey-mixed-walking-replay.mjs';
const origin='http://127.0.0.1:15546';
const scale=6_371_000*Math.PI/180*Math.cos(37.5665*Math.PI/180);
export function transferPoint(meters){
 if(!Number.isFinite(meters)||meters<0||meters>771)throw Error('BOUNDED_SYNTHETIC_PATH_REQUIRED');
 return {latitude:37.5665,longitude:126.978+meters/scale};
}
export function transferPassengerMeters(leg,elapsed){
 if(![1,3].includes(leg)||!Number.isFinite(elapsed))throw Error('BOUNDED_SYNTHETIC_CLOCK_REQUIRED');
 const start=leg===1?80:390,target=start+300,t=Math.max(0,elapsed),rideSeconds=50;
 if(t<rideSeconds)return start+t*300/rideSeconds;
 if(t<155)return target+Math.sin(t)*0.25;
 if(leg===1)return Math.min(390,target+(t-155)*2)+Math.sin(t)*0.25;
 return Math.min(760,target+(t-155)*2.4)+Math.sin(t)*0.25;
}
export function transferReplayOptions(args){
 if((args.length!==2&&args.length!==3)||args[0]!=='--device'||args[1]!==mixedDevice
   ||(args.length===3&&!['--hold-transfer-wait','--long-navigation'].includes(args[2])))throw Error('FIXED_ISOLATED_DEVICE_REQUIRED');
 return {holdTransferWaitSeconds:args[2]==='--hold-transfer-wait'?60:0,
   preDepartureDwellSeconds:args[2]==='--long-navigation'?240:0};
}
async function main(args){
 const options=transferReplayOptions(args);
 const inventory=JSON.parse(execFileSync('xcrun',['simctl','list','devices','booted','--json'],{encoding:'utf8'}));
 if(!Object.values(inventory.devices).flat().some(d=>d.udid===mixedDevice&&d.name==='NoLate Mixed Journey E2E 20261012'&&d.state==='Booted'))throw Error('DEVICE_MISMATCH');
 const context=await(await fetch(origin+'/__fixture/context',{redirect:'error',signal:AbortSignal.timeout(4000)})).json();
 if(context.fixtureOnly!==true||context.apiOrigin!==origin||context.memberId!==7||context.guidancePushRealProvider!==false||context.syntheticTransferFixture!==true)throw Error('TRANSFER_SYNTHETIC_HARNESS_REQUIRED');
 if(options.preDepartureDwellSeconds&&context.extendedNavigationFixture!==true)throw Error('EXTENDED_SYNTHETIC_HARNESS_REQUIRED');
 async function request(path,body){
  const r=await fetch(origin+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(4000),
   headers:{Authorization:`Bearer ${context.accessToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('FIXTURE_REQUEST_FAILED');return r.json();
 }
 const state=await request('/__fixture/state');
 if(state.fixtureOnly!==true||state.syntheticTransferFixture!==true||state.guidancePushRealProvider!==false)throw Error('TRANSFER_STATE_REQUIRED');
 const set=meters=>{const p=transferPoint(meters);execFileSync('xcrun',['simctl','location',mixedDevice,'set',`${p.latitude},${p.longitude}`]);};
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 await request('/__fixture/ride-control',{mode:'EMPTY'});
 if(options.preDepartureDwellSeconds){
  console.log('Synthetic pre-departure dwell (240s); fixed v4 lifetime, no phase command');
  const until=Date.now()+options.preDepartureDwellSeconds*1000;
  while(Date.now()<until){set(Math.sin(Date.now()/1000)*0.2+0.2);await wait(1000);}
 }
 console.log('Synthetic first walk; CoreLocation input only, no navigation phase command');
 const walkingAt=Date.now()/1000;
 while(Date.now()/1000<walkingAt+34){set(Math.min(80,(Date.now()/1000-walkingAt)*2.4));await wait(1000);}
 for(let i=0;i<16;i++){set(80+Math.sin(i)*0.25);await wait(1000);}
 for(const [leg,mode,limit]of [[1,'FRESH',205],[3,'SECOND_FRESH',220]]){
  if(leg===3&&options.holdTransferWaitSeconds){
   // Hold a synthetic passenger at the transfer stop before starting a separate vehicle clock.
   // This is location input plus an empty provider, never a navigation phase command.
   await request('/__fixture/ride-control',{mode:'EMPTY'});
   console.log('Synthetic next-stop dwell for lock-screen ETA observation (60s)');
   const dwellUntil=Date.now()+options.holdTransferWaitSeconds*1000;
   while(Date.now()<dwellUntil){set(390+Math.sin(Date.now()/1000)*0.25);await wait(1000);}
  }
  const clock=await request('/__fixture/ride-control',{mode});
  if(clock.fixtureOnly!==true||clock.mode!==mode||!Number.isFinite(clock.startAt)||clock.startAt<Date.now()/1000||clock.startAt>Date.now()/1000+4)throw Error('SYNTHETIC_CLOCK_INVALID');
  console.log(`Independent synthetic vehicle for leg ${leg} started`);
  let previous=-1;
  while(Date.now()/1000<clock.startAt+limit){
   const elapsed=Date.now()/1000-clock.startAt,milestone=Math.floor(elapsed/15);
   if(milestone>previous){previous=milestone;console.log(`leg ${leg} elapsed ${milestone*15}s`);}
   set(transferPassengerMeters(leg,elapsed));await wait(1000);
  }
 }
 await request('/__fixture/ride-control',{mode:'EMPTY'});
 console.log('Synthetic transfer replay ended; inspect UI/lock and terminal synchronization, not real GPS/APNs proof');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(()=>{
 console.error('Synthetic transfer replay failed; private data suppressed');process.exitCode=1;
});
