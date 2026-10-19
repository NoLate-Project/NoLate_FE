import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseTmapPedestrianGeometry } from '../../src/modules/map/tmapPedestrianGeometry.ts';

const ORIGIN = Object.freeze({ lat: 37.5665, lng: 126.978 });
const DESTINATION = Object.freeze({ lat: 37.5665, lng: 126.979 });
/** One HTTPS request, fixed public-area endpoints. No redirect/retry, raw response or credentials in output. */
export async function probePedestrianProvider({ appKey, fetcher = fetch }) {
  if (typeof appKey !== 'string' || !appKey.trim()) return { status: 'KEY_MISSING', networkAttempts: 0, navigationReady: false };
  const base = { networkAttempts: 1, navigationReady: false };
  try {
    const response = await fetcher('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { appKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ startX: String(ORIGIN.lng), startY: String(ORIGIN.lat),
        endX: String(DESTINATION.lng), endY: String(DESTINATION.lat), startName: '출발', endName: '도착',
        reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', sort: 'index', searchOption: '0' }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ...base, status: 'HTTP_REJECTED', httpStatus: response.status };
    }
    if (!response.body) return { ...base, status: 'EMPTY_RESPONSE' };
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); return { ...base, status: 'RESPONSE_LIMIT' }; }
      chunks.push(part.value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const part of chunks) { body.set(part, offset); offset += part.length; }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
    catch { return { ...base, status: 'INVALID_RESPONSE' }; }
    const result = parseTmapPedestrianGeometry(data, ORIGIN, DESTINATION);
    return result.ok ? { ...base, status: 'RAW_GEOMETRY_CANDIDATE', lineCount: result.lineCount,
      rawLinePointCount: result.rawLinePointCount, deliveredPointCount: result.coordinates.length }
      : { ...base, status: 'RAW_GEOMETRY_REJECTED', reason: result.reason };
  } catch { return { ...base, status: 'TRANSPORT_FAILED' }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--allow-provider-tmap') {
    console.log(JSON.stringify({ status: 'EXPLICIT_OPT_IN_REQUIRED', networkAttempts: 0, navigationReady: false }));
    process.exitCode = 2;
  } else {
    const require = createRequire(import.meta.url);
    let appKey;
    try {
      const values = require('dotenv').parse(readFileSync('/Users/mac/IdeaProjects/NoLate/NoLate_FE/.env'));
      appKey = values.EXPO_PUBLIC_TMAP_APP_KEY || values.EXPO_PUBLIC_TMAP_API_KEY;
    } catch { /* No path, exception or file content is emitted. */ }
    const result = await probePedestrianProvider({ appKey });
    console.log(JSON.stringify(result));
    if (result.status !== 'RAW_GEOMETRY_CANDIDATE') process.exitCode = 2;
  }
}
