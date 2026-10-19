import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from "./automaticJourney";
import { buildJourneyRouteInput } from "./journeyRouteInput";

const messages: Record<string, string> = {
    READY: "이동하면 출발을 감지합니다", WALKING_TO_STOP: "승차 정류장으로 이동 중",
    APPROACHING_STOP: "승차 정류장에 접근 중", WAITING: "정류장 대기 · 탑승 미확정",
    BOARDING_CANDIDATE: "탑승 여부 확인 필요 · 미확정", UNAVAILABLE: "현재 위치 확인 필요",
    RIDING: "버스로 이동 중",
    FINAL_WALK: "목적지로 도보 이동 중",
    TRANSFER_WALK: "환승 승차 지점으로 도보 이동 중",
};
export function buildSavedJourneyInput(route: unknown, origin: unknown, destination: unknown) {
    const root = automaticRecord(route);
    const nested = automaticRecord(root?.routeInfo);
    if (Array.isArray(root?.transitLegs) && Array.isArray(nested?.transitLegs)) return null;
    const built = buildJourneyRouteInput(Array.isArray(root?.transitLegs) ? root : nested,
        { routeRevision: 1, context: "SAVED_ROUTE", origin, destination });
    return built.ok ? built.input : null;
}
/** Fail closed across route/session/revision/generation and observation TTL. Never infer boarding. */
export type SavedJourneyGuidanceView = { phase: string; instruction: string; progress: number | null; fresh: boolean;
    subway?: { currentStopIndex: number; totalStops: number; currentStopName: string; nextStopName: string | null; remainingStops: number };
    lastConfirmedSubway?: { stopIndex: number; totalStops: number; stopName: string; confirmedAt: number };
    alighting?: { kind: 'ONE_STOP_BEFORE' | 'NEAR_STOP'; remainingMeters: number; action: string };
    arrival?: { directionLabel: string; remainingSeconds: number } };
export function presentSavedJourneyGuidance(snapshot: AutomaticJourneySnapshot | null, binding: AutomaticJourneyBinding | null, now: number): SavedJourneyGuidanceView | null {
    const raw = automaticRecord(snapshot?.guidance);
    const alighting = automaticRecord(raw?.alighting);
    const validAlighting = !!alighting && Object.keys(alighting).length === 2
        && ['ONE_STOP_BEFORE', 'NEAR_STOP'].includes(String(alighting.kind))
        && typeof alighting.remainingMeters === 'number' && Number.isFinite(alighting.remainingMeters)
        && alighting.remainingMeters >= 0 && alighting.remainingMeters <= 100_000 && alighting.remainingMeters % 10 === 0
        && (alighting.kind !== 'NEAR_STOP' || alighting.remainingMeters <= 50);
    const index = raw?.activeLegIndex;
    const subway = automaticRecord(raw?.subway);
    const safeStationName = (name: unknown) => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 64
        && !/[\u0000-\u001f\u007f-\u009f]/.test(name);
    const validSubway = raw?.schemaVersion === 8 && subway && Object.keys(subway).every(key=>['currentStopIndex','totalStops','currentStopName','nextStopName'].includes(key))
        && Number.isSafeInteger(subway.totalStops) && (subway.totalStops as number) >= 2 && (subway.totalStops as number) <= 500
        && Number.isSafeInteger(subway.currentStopIndex) && (subway.currentStopIndex as number) >= 1 && (subway.currentStopIndex as number) < (subway.totalStops as number)
        && safeStationName(subway.currentStopName) && ((subway.currentStopIndex as number) === (subway.totalStops as number)-1 ? subway.nextStopName == null : safeStationName(subway.nextStopName))
        && raw.phase === 'RIDING' && raw.boardingConfirmed === true && raw.walkProgress == null && raw.alighting == null && raw.arrival == null
        && typeof index === 'number' && Number.isSafeInteger(index) && index >= 1 && index <= 29 && index % 2 === 1
        && typeof raw.rideProgress === 'number' && Number.isFinite(raw.rideProgress)
        && Math.abs(raw.rideProgress-(subway.currentStopIndex as number)/((subway.totalStops as number)-1)) < 0.000001;
    const indexedArrival=automaticRecord(raw?.arrival);
    const indexedVersion=raw?.schemaVersion===6||raw?.schemaVersion===7;
    const validIndexed = indexedVersion && typeof index === 'number' && Number.isSafeInteger(index)
        && index >= 2 && index <= 30 && (raw?.schemaVersion===6 ? raw.arrival == null :
            ['WAITING','APPROACHING_STOP'].includes(String(raw?.phase)) && raw?.arrivalStatus==='WAITING_INFORMATION'
            && indexedArrival?.busLegIndex === index+(raw?.phase==='WAITING'?0:1))
        && (raw.phase === 'RIDING' ? index % 2 === 1 && raw.boardingConfirmed === true && raw.walkProgress == null
            && (raw.alighting == null || validAlighting)
            : ['WAITING','BOARDING_CANDIDATE'].includes(String(raw.phase)) ? index % 2 === 1 && raw.boardingConfirmed === false && raw.rideProgress == null && raw.alighting == null
                && (raw.phase !== 'WAITING' || raw.walkProgress === 1)
            : ['FINAL_WALK','WALKING_TO_STOP','APPROACHING_STOP'].includes(String(raw.phase)) && index % 2 === 0
                && (raw.phase !== 'FINAL_WALK' || index >= 4) && raw.boardingConfirmed === false && raw.rideProgress == null && raw.alighting == null);
    if (!snapshot?.enabled || !binding?.savedRouteValidated || !binding.guidanceEnabled || !["SANDBOX", "AUTHENTICATED"].includes(binding.syncScope)
        || !raw || (raw.schemaVersion === 8 ? !validSubway : raw.subway != null || (indexedVersion ? !validIndexed : raw.phase === "TRANSFER_WALK"
            ? raw.schemaVersion !== 5 || typeof raw.activeLegIndex !== 'number' || !Number.isSafeInteger(raw.activeLegIndex)
                || raw.activeLegIndex < 2 || raw.activeLegIndex > 28 || raw.activeLegIndex % 2 !== 0 || raw.boardingConfirmed !== false
                || raw.rideProgress != null || raw.alighting != null || raw.arrival != null
            : raw.phase === "FINAL_WALK"
            ? raw.schemaVersion !== 4 || raw.activeLegIndex !== 2 || raw.boardingConfirmed !== false
                || raw.rideProgress != null || raw.alighting != null || raw.arrival != null
            : raw.phase === "RIDING"
            ? !(raw.schemaVersion === 2 && raw.alighting == null || raw.schemaVersion === 3 && validAlighting)
                || raw.boardingConfirmed !== true || raw.activeLegIndex !== 1 || raw.walkProgress != null
            : raw.schemaVersion !== 1 || raw.boardingConfirmed !== false || raw.rideProgress != null || raw.alighting != null))
        || snapshot.sessionId !== binding.sessionId || snapshot.routeRevision !== binding.routeRevision
        || raw.status !== snapshot.status || !["ARMED", "ACTIVE"].includes(snapshot.status)
        || ["sessionId", "scheduleId", "generation", "routeRevision", "routeInputDigest"].some(key => raw[key] !== binding[key as keyof AutomaticJourneyBinding])
        || typeof raw.sequence !== "number" || !Number.isSafeInteger(raw.sequence) || raw.sequence < 0
        || typeof raw.validUntil !== "number" || !Number.isFinite(raw.validUntil) || raw.validUntil > binding.expiresAtEpochSeconds
        || now >= binding.expiresAtEpochSeconds || typeof raw.phase !== "string" || !(raw.phase in messages)
        || !["GOOD", "UNCERTAIN", "UNAVAILABLE"].includes(String(raw.quality))) return null;
    if (snapshot.status === "ARMED") return raw.phase === "READY" && raw.quality === "UNAVAILABLE"
        ? { phase: "READY", instruction: messages.READY, progress: null, fresh: false } : null;
    const observation = raw.observedAt;
    const riding = raw.phase === "RIDING";
    const finalWalking = raw.phase === "FINAL_WALK" || raw.phase === "TRANSFER_WALK";
    const fresh = Number.isFinite(now) && typeof observation === "number" && Number.isFinite(observation) && observation <= now + 2
        && observation >= binding.preparedAtEpochSeconds && now < raw.validUntil
        && (riding || finalWalking || raw.phase === 'WAITING' ? raw.validUntil <= Math.min(binding.expiresAtEpochSeconds, observation + 15)
            : raw.validUntil === Math.min(binding.expiresAtEpochSeconds, observation + 15));
    const progress = riding ? raw.rideProgress : raw.walkProgress;
    const validProgress = typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress <= 1;
    const known = fresh && raw.quality === "GOOD" && ["WALKING_TO_STOP", "APPROACHING_STOP", "WAITING", "RIDING", "FINAL_WALK", "TRANSFER_WALK"].includes(raw.phase)
        && (!(riding || finalWalking || indexedVersion) || validProgress);
    const phase = known || (fresh && raw.phase === "BOARDING_CANDIDATE" && raw.quality === "UNCERTAIN") ? raw.phase : "UNAVAILABLE";
    const result: SavedJourneyGuidanceView = { phase, instruction: messages[phase], progress: known && validProgress ? progress as number : null, fresh: known };
    if (known && validSubway && subway) {
        result.instruction = '지하철로 이동 중';
        result.subway = { currentStopIndex:subway.currentStopIndex as number,totalStops:subway.totalStops as number,
            currentStopName:subway.currentStopName as string,nextStopName:subway.nextStopName as string ?? null,
            remainingStops:(subway.totalStops as number)-1-(subway.currentStopIndex as number) };
    }
    const last = automaticRecord(raw.lastConfirmedSubway);
    if (phase === 'UNAVAILABLE' && raw.phase === 'UNAVAILABLE' && raw.schemaVersion === 1
        && last && Object.keys(last).every(key => ['stopIndex','totalStops','stopName','confirmedAt'].includes(key))
        && Number.isSafeInteger(last.totalStops) && (last.totalStops as number) >= 2 && (last.totalStops as number) <= 500
        && Number.isSafeInteger(last.stopIndex) && (last.stopIndex as number) >= 1 && (last.stopIndex as number) < (last.totalStops as number)
        && safeStationName(last.stopName) && typeof last.confirmedAt === 'number' && Number.isFinite(last.confirmedAt)
        && last.confirmedAt >= binding.preparedAtEpochSeconds && last.confirmedAt <= now
        && now - last.confirmedAt < 90) {
        result.lastConfirmedSubway = {stopIndex:last.stopIndex as number,totalStops:last.totalStops as number,
            stopName:last.stopName as string,confirmedAt:last.confirmedAt as number};
    }
    if (known && riding && [3,6].includes(Number(raw.schemaVersion)) && validAlighting) result.alighting = {
        kind: alighting.kind as 'ONE_STOP_BEFORE' | 'NEAR_STOP', remainingMeters: alighting.remainingMeters as number,
        action: alighting.kind === 'NEAR_STOP' ? '정류장 근처 · 하차 준비' : `다음 정류장 · 약 ${alighting.remainingMeters}m 앞 · 하차 준비`,
    };
    const arrival = automaticRecord(raw.arrival);
    const validArrival = known && ["APPROACHING_STOP", "WAITING"].includes(phase) && raw.arrivalStatus === "WAITING_INFORMATION" && arrival
        && typeof arrival.providerRouteId === "string" && /^[1-9]\d{0,19}$/.test(arrival.providerRouteId)
        && typeof arrival.directionLabel === "string" && arrival.directionLabel.length > 0 && arrival.directionLabel.length <= 128
        && !Array.from(arrival.directionLabel).some(c => c.charCodeAt(0) <= 31 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159)
        && typeof arrival.sourceUpdatedAt === "number" && Number.isFinite(arrival.sourceUpdatedAt)
        && typeof arrival.expectedAt === "number" && Number.isFinite(arrival.expectedAt)
        && typeof arrival.validUntil === "number" && Number.isFinite(arrival.validUntil)
        && arrival.sourceUpdatedAt <= now + 5 && arrival.expectedAt > arrival.sourceUpdatedAt
        && arrival.expectedAt <= arrival.sourceUpdatedAt + 3600
        && Math.abs(arrival.validUntil - Math.min(arrival.sourceUpdatedAt + 120, arrival.expectedAt)) < 0.001
        && now < arrival.validUntil && now < arrival.expectedAt;
    return validArrival ? { ...result, arrival: { directionLabel: arrival.directionLabel as string,
        remainingSeconds: Math.ceil((arrival.expectedAt as number) - now) } } : result;
}
