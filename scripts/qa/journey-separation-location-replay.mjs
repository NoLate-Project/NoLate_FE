import {runAlightingReplay} from './journey-alighting-location-replay.mjs';
// Fixed isolated simulator, synthetic provider OFF, passenger GPS only. The independent
// server scenario supplies departure observations; this script never sends vehicle coordinates.
runAlightingReplay(process.argv.slice(2),{requireSeparation:true}).catch(()=>{
  console.error('Synthetic separation replay failed; no private data emitted');process.exitCode=1;
});
