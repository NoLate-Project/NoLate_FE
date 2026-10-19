import { runAlightingReplay } from './journey-alighting-location-replay.mjs';
// Passenger CoreLocation inputs only. Vehicles follow their separate fixture clock.
runAlightingReplay(process.argv.slice(2),{requireSeparation:true,finalWalking:true}).catch(()=>{
  console.error('Synthetic final-walk replay failed; no private data emitted');process.exitCode=1;
});
