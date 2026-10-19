import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Synthetic coordinates from journeyBusFixtures / journeyRouteFixtures, not a captured human trip.
// This changes CoreSimulator location only. It cannot call a journey bridge or advance a phase.
export const isolatedDevice = '2847D4CF-88EA-4DA1-87E9-FD1948F58E01';
const latitude = 37.5665;
const originLongitude = 126.978;
const boardingLongitude = 126.9795;
const metersPerLongitude = 6_371_000 * Math.cos(latitude * Math.PI / 180) * Math.PI / 180;
const boardingMeters = (boardingLongitude - originLongitude) * metersPerLongitude;
const point = meters => ({ latitude, longitude: originLongitude + meters / metersPerLongitude });

export function buildScenario(name) {
  switch (name) {
    case 'walk': return { intervalMs: 4000, points: [0, 20, 40, 60, 80, 100, 120, boardingMeters].map(point) };
    case 'marker-walk': return { intervalMs: 4000, points: [0, 20, 40, 60, 80, 80.5, 80, 80.5, 80].map(point) };
    case 'marker-monitor': return { intervalMs: 4000, points: Array.from({ length: 13 }, (_, index) => point(80 + (index % 2) * 0.5)) };
    case 'marker-finish': return { intervalMs: 4000, points: [80, 100, 120, boardingMeters].map(point) };
    case 'dwell': return { intervalMs: 4000, points: [0, 0.5, 0, 0.5, 0].map(offset => point(boardingMeters + offset)) };
    case 'waiting-monitor': return { intervalMs: 4000, points: Array.from({ length: 61 }, (_, index) => point(boardingMeters + (index % 2) * 0.5)) };
    case 'candidate': return { intervalMs: 1000, points: Array.from({ length: 41 }, (_, index) => point(boardingMeters + index * 10)) };
    case 'walk-past': return { intervalMs: 8000, points: [0, 16, 32, 48, 64].map(offset => point(boardingMeters + offset)) };
    case 'reverse': return { intervalMs: 4000, points: [400, 380].map(offset => point(boardingMeters + offset)) };
    case 'off-route': return { intervalMs: 4000, points: [{ latitude: latitude + 0.001, longitude: boardingLongitude }] };
    default: throw new Error('Use walk, marker-walk, marker-monitor, marker-finish, dwell, waiting-monitor, candidate, walk-past, reverse, off-route, or clear');
  }
}

async function main(args) {
  if (args.length !== 4 || args[0] !== '--device' || args[1] !== isolatedDevice || args[2] !== '--scenario') {
    throw new Error(`Only the isolated simulator is permitted: --device ${isolatedDevice} --scenario <name>`);
  }
  const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { encoding: 'utf8' }));
  const device = Object.values(devices.devices).flat().find(item => item.udid === isolatedDevice && item.state === 'Booted');
  if (!device || device.name !== 'NoLate Journey P0 Isolated 20261004') throw new Error('Isolated simulator identity mismatch');
  if (args[3] === 'clear') {
    execFileSync('xcrun', ['simctl', 'location', isolatedDevice, 'clear']);
    console.log('Synthetic simulator location cleared');
    return;
  }
  const scenario = buildScenario(args[3]);
  console.log(`SYNTHETIC CoreLocation input only: ${args[3]}, ${scenario.points.length} points`);
  for (let index = 0; index < scenario.points.length; index++) {
    const coordinate = scenario.points[index];
    execFileSync('xcrun', ['simctl', 'location', isolatedDevice, 'set', `${coordinate.latitude},${coordinate.longitude}`]);
    console.log(`location sample ${index + 1}/${scenario.points.length}`);
    if (index + 1 < scenario.points.length) await new Promise(resolve => setTimeout(resolve, scenario.intervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
