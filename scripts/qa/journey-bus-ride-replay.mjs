import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildScenario } from './journey-bus-location-replay.mjs';

// Fixed, newly isolated simulator. This script never invokes a journey bridge or a phase action.
export const rideDevice = '96AF9A48-4721-4335-B7BF-10B9382B7A30';
export function passengerPoint(startAt, now, limitMeters = 600) {
  if (![startAt, now, limitMeters].every(Number.isFinite) || limitMeters < 100 || limitMeters > 100_000) throw new Error('Finite synthetic scenario clock required');
  const elapsed = Math.max(0, now - startAt);
  // Sub-metre stationary GPS jitter keeps CoreSimulator delivering new CLLocation
  // timestamps during inspection. This is not vehicle evidence or phase control.
  const duration = limitMeters / 10;
  const meters = elapsed <= duration ? elapsed * 10 : limitMeters + Math.sin(elapsed - duration) * 0.5;
  const scale = 6_371_000 * Math.PI / 180 * Math.cos(37.5665 * Math.PI / 180);
  return { latitude: 37.5665, longitude: 126.9795 + meters / scale };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function control(mode) {
  const response = await fetch('http://127.0.0.1:15544/__fixture/ride-control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(4000), redirect: 'error',
  });
  const value = await response.json();
  if (!response.ok || value.fixtureOnly !== true || value.mode !== mode) throw new Error('Synthetic vehicle fixture required');
  return value;
}
async function main(args) {
  if (args.length !== 2 || args[0] !== '--device' || args[1] !== rideDevice) throw new Error('Explicit fixed isolated device required');
  const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { encoding: 'utf8' }));
  if (!Object.values(devices.devices).flat().some(d => d.udid === rideDevice && d.name === 'NoLate R2 Session E2E 20261008' && d.state === 'Booted')) throw new Error('Wrong simulator');
  const state = await (await fetch('http://127.0.0.1:15544/__fixture/state', { signal: AbortSignal.timeout(4000), redirect: 'error' })).json();
  if (state.fixtureOnly !== true || state.syntheticRideEnabled !== true || state.guidancePushRealProvider !== false) throw new Error('Synthetic-only harness required');
  const set = p => execFileSync('xcrun', ['simctl', 'location', rideDevice, 'set', `${p.latitude},${p.longitude}`]);
  await control('EMPTY');
  for (const name of ['walk', 'dwell']) {
    const scenario = buildScenario(name);
    console.log(`Passenger GPS only: ${name}, ${scenario.points.length} samples`);
    for (const p of scenario.points) { set(p); await sleep(scenario.intervalMs); }
  }
  // The server's independent, clock-driven vehicle stream never reads these GPS samples.
  // startAt is the shared artificial scenario clock, not a bus observation or user position.
  const { startAt } = await control('FRESH');
  if (!Number.isFinite(startAt) || startAt < Date.now() / 1000 || startAt > Date.now() / 1000 + 4) throw new Error('Invalid synthetic start clock');
  console.log('Independent synthetic vehicle trajectory started; continuous passenger GPS follows');
  // After 600 m both independently clock-driven fixtures pause for detail/lock-screen inspection.
  while (Date.now() / 1000 < startAt + 145) { set(passengerPoint(startAt, Date.now() / 1000)); await sleep(1000); }
  await control('EMPTY');
  console.log('Vehicle observations removed; GPS remains fresh for 30 seconds');
  const until = Date.now() + 30_000;
  while (Date.now() < until) { set(passengerPoint(startAt, Date.now() / 1000)); await sleep(1000); }
  console.log('Replay complete; clear GPS and stop the app session through the independent window');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => { console.error('Synthetic ride replay failed; no private data emitted'); process.exitCode = 1; });
}
