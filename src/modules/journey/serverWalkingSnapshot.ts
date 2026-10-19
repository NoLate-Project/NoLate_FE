import { automaticRecord, automaticPositiveInteger } from './automaticJourney';
import { journeyAuthentication, requireJourneyAuthenticationIdentity, type JourneyAuthenticationSource } from './automaticJourneyAuthentication';
import { journeyJSONRequest } from './journeyJSONRequest';
import type { JourneyRouteInput, JourneyRouteCoordinate } from './journeyRouteInput';

export type WalkingSnapshotContext = { scheduleId: number; routeRevision: number; routeFingerprint: string };
export type WalkingSnapshot = WalkingSnapshotContext & {
    snapshotId: string; memberId: number; loginGeneration: number; issuedAtMs: number; expiresAtMs: number;
    navigationExpiresAtMs?: number;
    navigationReady: false; walks: { legIndex: number; provider: 'tmap'; points: { lat: number; lng: number }[] }[];
};
export type WalkingSnapshotWire = WalkingSnapshot & {schemaVersion:1|2|3|4;transitProvider:'odsay';walkProvider:'tmap';reason:'TRANSIT_ADMISSION_PENDING'};
export const walkingSnapshotWire = (value:WalkingSnapshot):WalkingSnapshotWire => ({...value,schemaVersion:value.navigationExpiresAtMs===undefined?(value.walks.length===2?1:2)
    :value.navigationExpiresAtMs-value.expiresAtMs===7200000?4:3,
    transitProvider:'odsay',walkProvider:'tmap',reason:'TRANSIT_ADMISSION_PENDING'});
/** Exact saved tuple + separately owned TMAP paths. Does not authorize boarding or mutate ODsay. */
export function composeServerWalkingInput(input:JourneyRouteInput,value:WalkingSnapshot,now=Date.now()):JourneyRouteInput {
    const snapshot=walkingSnapshotWire(parseWalkingSnapshot(walkingSnapshotWire(value),value,
        {authMemberId:value.memberId,loginGeneration:value.loginGeneration},now));
    const same=(a:JourneyRouteCoordinate|null|undefined,b:JourneyRouteCoordinate|null|undefined)=>!!a&&!!b&&a.latitude===b.latitude&&a.longitude===b.longitude;
    const first=input.legs[0],last=input.legs.at(-1)!;
    if(input.context!=='SAVED_ROUTE'||input.provider!=='odsay'||input.source!=='api'||input.plausibility!=='normal'
        ||input.serviceState!=='operating'||!['live_provider','provider_estimate'].includes(input.reliability)
        ||input.legs.length<3||input.legs.length>31||input.legs.length%2!==1
        ||input.legs.some((leg,i)=>leg.index!==i||(i%2===0?leg.kind!=='WALK':!['BUS','SUBWAY'].includes(leg.kind)))
        ||snapshot.walks.length!==(input.legs.length+1)/2||!same(first.start,input.origin)||!same(last.end,input.destination)
        ||input.legs.some((leg,i)=>i<input.legs.length-1&&!same(leg.end,input.legs[i+1].start))
        ||input.legs.some(leg=>leg.kind!=='WALK'&&(!same(leg.stops[0]?.coordinate,leg.start)||!same(leg.stops.at(-1)?.coordinate,leg.end)))) fail();
    for(const walk of snapshot.walks){const leg=input.legs[walk.legIndex],firstPoint=walk.points[0],lastPoint=walk.points.at(-1)!;
        if(!leg.start||!leg.end||distance(firstPoint,{lat:leg.start.latitude,lng:leg.start.longitude})>30
            ||distance(lastPoint,{lat:leg.end.latitude,lng:leg.end.longitude})>30) fail();}
    return {...JSON.parse(JSON.stringify(input)),routeRevision:snapshot.routeRevision,walkingSnapshot:snapshot};
}
/** View/session identity comparison excludes the separate snapshot, not any saved route claims. */
export function savedWalkingBaseJSON(input:JourneyRouteInput):string {
    const {walkingSnapshot,...base}=input; return JSON.stringify({...base,routeRevision:walkingSnapshot?1:input.routeRevision});
}
export async function requestWalkingContext(source:JourneyAuthenticationSource,scheduleId:number):Promise<WalkingSnapshotContext> {
    if(!automaticPositiveInteger(scheduleId)) fail();
    const auth=await source();requireJourneyAuthenticationIdentity(auth,auth);
    const url=`${auth.apiOrigin}/api/schedules/${scheduleId}/walking-snapshot/context`;
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),4000);
    try {
        const options:RequestInit&{redirect:'error'}={method:'GET',credentials:'omit',redirect:'error',signal:abort.signal,
            headers:{Authorization:`Bearer ${auth.accessToken}`,Accept:'application/json'}};
        const response=await fetch(url,options);const text=await response.text();
        requireJourneyAuthenticationIdentity(await source(),auth);
        if(!response.ok||response.redirected||response.url&&response.url!==url||text.length>4096)fail();
        const root=automaticRecord(JSON.parse(text)),value=automaticRecord(root?.data);
        const context={scheduleId:value?.scheduleId as number,routeRevision:value?.routeRevision as number,routeFingerprint:value?.routeFingerprint as string};
        if(root?.success!==true||context.scheduleId!==scheduleId||!contextValid(context))fail();return context;
    } finally{clearTimeout(timer);}
}
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
function fail(): never { throw new Error('INVALID_WALKING_SNAPSHOT'); }
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
function contextValid(value: WalkingSnapshotContext) {
    return automaticPositiveInteger(value.scheduleId) && automaticPositiveInteger(value.routeRevision) && digest.test(value.routeFingerprint);
}
function distance(a: {lat: number; lng: number}, b: {lat: number; lng: number}) {
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
/** Authenticated server data, not a native admission token. Never relabel as saved ODsay geometry. */
export function parseWalkingSnapshot(value: unknown, expected: WalkingSnapshotContext,
    identity: {authMemberId: number; loginGeneration: number}, now = Date.now()): WalkingSnapshot {
    const r = automaticRecord(value);
    if (!contextValid(expected) || !automaticPositiveInteger(identity.authMemberId) || !integer(identity.loginGeneration) || identity.loginGeneration<0
        || !r || ![1,2,3,4].includes(Number(r.schemaVersion)) || typeof r.schemaVersion !== 'number' || typeof r.snapshotId !== 'string' || !uuid.test(r.snapshotId)
        || r.memberId !== identity.authMemberId || r.loginGeneration !== identity.loginGeneration
        || r.scheduleId !== expected.scheduleId || r.routeRevision !== expected.routeRevision || r.routeFingerprint !== expected.routeFingerprint
        || r.transitProvider !== 'odsay' || r.walkProvider !== 'tmap' || r.navigationReady !== false || r.reason !== 'TRANSIT_ADMISSION_PENDING'
        || !automaticPositiveInteger(r.issuedAtMs) || !automaticPositiveInteger(r.expiresAtMs) || r.expiresAtMs-r.issuedAtMs !== 300000
        || ([3,4].includes(r.schemaVersion)? !automaticPositiveInteger(r.navigationExpiresAtMs)
            ||r.navigationExpiresAtMs-r.expiresAtMs!==(r.schemaVersion===4?7200000:600000) : r.navigationExpiresAtMs!=null)
        || !Number.isFinite(now) || now < r.issuedAtMs || now >= r.expiresAtMs || !Array.isArray(r.walks)
        || (r.schemaVersion===1?r.walks.length!==2:r.walks.length<([3,4].includes(r.schemaVersion)?2:3)||r.walks.length>16)) fail();
    let total=0;
    const walks = (r.walks as unknown[]).map((raw, i) => {
        const w = automaticRecord(raw); const legIndex = i*2;
        if (!w || w.legIndex !== legIndex || w.provider !== 'tmap' || !Array.isArray(w.points) || w.points.length < 2 || w.points.length > 2000) fail();
        total+=w.points.length;if(total>12_000)fail();
        const points = (w.points as unknown[]).map(rawPoint => {
            const p = automaticRecord(rawPoint);
            if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)
                || Math.abs(p.lat)>90 || Math.abs(p.lng)>180) fail();
            return {lat: p.lat as number, lng: p.lng as number};
        });
        for (let n=1; n<points.length; n++) { const meters = distance(points[n-1], points[n]); if (meters<=0 || meters>150) fail(); }
        return {legIndex, provider: 'tmap' as const, points};
    });
    return {...expected, snapshotId: r.snapshotId as string, memberId: identity.authMemberId, loginGeneration: identity.loginGeneration,
        issuedAtMs: r.issuedAtMs as number, expiresAtMs: r.expiresAtMs as number, navigationReady: false, walks,
        ...([3,4].includes(r.schemaVersion)?{navigationExpiresAtMs:r.navigationExpiresAtMs as number}:{})};
}
const reasons = new Set(['OWNER_CHANGED','REVISION_CHANGED','SAVED_ROUTE_CHANGED','EXPIRED','SNAPSHOT_NOT_FOUND',
    'SNAPSHOT_REPLACED','STORED_SNAPSHOT_INVALID','PROVIDER_UNAVAILABLE','PROVIDER_BUSY','ROUTE_BUSY','FEATURE_DISABLED']);
/** Explicit one-shot API. No retries/renewal/native writes. Recheck authentication after network I/O. */
export async function requestWalkingSnapshot(source: JourneyAuthenticationSource, expected: WalkingSnapshotContext,
    operation: 'issue' | 'current' | 'cancel', snapshotId?: string): Promise<WalkingSnapshot | null> {
    if (!contextValid(expected) || !['issue','current','cancel'].includes(operation) || operation === 'cancel' && (!snapshotId || !uuid.test(snapshotId))) fail();
    const auth = await source(); requireJourneyAuthenticationIdentity(auth, auth);
    const url = `${auth.apiOrigin}/api/schedules/${expected.scheduleId}/walking-snapshot${operation==='cancel' ? `/${snapshotId}` : ''}`;
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), operation==='issue' ? 25000 : 4000);
    try {
        const request: RequestInit & {redirect:'error'} = {method: operation==='issue' ? 'POST' : operation==='cancel' ? 'DELETE' : 'GET',
            credentials: 'omit', redirect: 'error', signal: abort.signal,
            headers: {Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json'},
            ...(operation==='issue' ? {body: JSON.stringify({expectedRevision: expected.routeRevision})} : {})};
        const response = await fetch(url, request);
        const latest = await source(); requireJourneyAuthenticationIdentity(latest, auth);
        if (response.redirected || response.url && response.url !== url) fail();
        const text = await response.text(); if (text.length > 524288) fail();
        let root: Record<string, unknown> | null = null; try { root = automaticRecord(JSON.parse(text)); } catch { fail(); }
        if (!response.ok || root?.success !== true) {
            const reason = root?.errorCode; throw new Error(typeof reason === 'string' && reasons.has(reason) ? reason : 'WALKING_SNAPSHOT_UNAVAILABLE');
        }
        // Auth may change while reading the body, too.
        requireJourneyAuthenticationIdentity(await source(), auth);
        if (operation==='cancel') { if (automaticRecord(root.data)?.cancelled !== true) fail(); return null; }
        return parseWalkingSnapshot(root.data, expected, auth);
    } finally { clearTimeout(timer); }
}

export const walkingSnapshotTrialCases = ['issue','current','replace','cancel','revision','logout','expire'] as const;
export type WalkingSnapshotTrialCase = typeof walkingSnapshotTrialCases[number];
export type WalkingSnapshotTrialSummary = {status: 'STORED'|'BLOCKED'; reason: string; walkCount: number; pointCount: number};
/** Test issuer + isolated H2 only. Real controller/store, synthetic route authority and loopback provider. */
export async function loadWalkingSnapshotTrial(selected: WalkingSnapshotTrialCase): Promise<WalkingSnapshotTrialSummary> {
    if (!__DEV__ || !walkingSnapshotTrialCases.includes(selected)) throw new Error('WALKING_SNAPSHOT_UNAVAILABLE');
    const root = automaticRecord(await journeyJSONRequest('http://127.0.0.1:15546/__fixture/context'));
    if (root?.fixtureOnly !== true || root.apiOrigin !== 'http://127.0.0.1:15546' || root.memberId !== 7 || root.guidancePushRealProvider !== false) fail();
    const auth = journeyAuthentication(root.accessToken, root.apiOrigin, root.memberId);
    const source = async () => auth;
    const expected = {scheduleId:9001, routeRevision: root.routeRevision as number, routeFingerprint: root.routeFingerprint as string};
    const change = async (mode: string) => {
        const abort = new AbortController(); const timer = setTimeout(()=>abort.abort(),4000);
        const url = 'http://127.0.0.1:15546/__fixture/change';
        try {
            const request: RequestInit & {redirect:'error'} = {method:'POST', credentials:'omit', redirect:'error', signal:abort.signal,
                headers:{Authorization:`Bearer ${auth.accessToken}`, 'Content-Type':'application/json'}, body: JSON.stringify({mode})};
            const response = await fetch(url, request);
            if (!response.ok || response.redirected || response.url && response.url!==url) fail();
        } finally {clearTimeout(timer);}
    };
    if (selected !== 'current') await change('normal');
    const read = (operation: 'issue'|'current'|'cancel', id?: string) => requestWalkingSnapshot(source, expected, operation, id);
    if (selected === 'issue' || selected === 'current') {
        const value = await read(selected); if (!value) fail();
        return {status:'STORED', reason: selected==='issue' ? 'SAVED' : 'RELOADED', walkCount:value.walks.length,
            pointCount:value.walks.reduce((n,w)=>n+w.points.length,0)};
    }
    const first = await read('issue'); if (!first) fail();
    if (selected === 'replace') {
        const latest = await read('issue'); if (!latest || latest.snapshotId === first.snapshotId) fail();
        try { await read('cancel',first.snapshotId); fail(); } catch (e) { if (!(e instanceof Error) || e.message !== 'SNAPSHOT_REPLACED') throw e; }
        const current = await read('current'); if (current?.snapshotId !== latest.snapshotId) fail();
        return {status:'STORED',reason:'REPLACEMENT_PROTECTED',walkCount:latest.walks.length,pointCount:latest.walks.reduce((n,w)=>n+w.points.length,0)};
    }
    if (selected === 'cancel') await read('cancel',first.snapshotId); else await change(selected);
    const reason = selected==='cancel' ? 'SNAPSHOT_NOT_FOUND' : selected==='revision' ? 'REVISION_CHANGED' : selected==='logout' ? 'OWNER_CHANGED' : 'EXPIRED';
    try { await read('current'); fail(); } catch (e) { if (!(e instanceof Error) || e.message!==reason) throw e; }
    return {status:'BLOCKED',reason,walkCount:0,pointCount:0};
}
