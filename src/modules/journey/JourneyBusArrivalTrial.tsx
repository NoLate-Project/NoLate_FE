import React, { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";

import { getAutomaticJourneySnapshot, subscribeAutomaticJourney } from "./automaticJourney";
import { getAutomaticJourneyTrialBinding } from "./automaticJourneyTrial";
import { busArrivalEligible, JourneyBusArrivalPoller, type JourneyBusArrivalView } from "./journeyBusArrival";
import type { JourneyRouteInput } from "./journeyRouteInput";
import { projectJourneyBusBinding, type JourneyBusRouteMapping } from "./journeyBusRouteBinding";

const empty = (status: string): JourneyBusArrivalView => ({ status, remainingSeconds: null, incomingVehicleId: null, confirmedBoarding: false });

export function JourneyBusArrivalTrial({ input, scope, mapping = null }: { input: JourneyRouteInput | null; scope: "SANDBOX" | "LOCAL_ONLY"; mapping?: JourneyBusRouteMapping | null }) {
    const [state, setState] = useState(() => ({ input, scope, mapping, view: empty("LOCATION_OR_SESSION_UNAVAILABLE") }));
    const view = state.input === input && state.scope === scope && state.mapping === mapping ? state.view : empty("LOCATION_OR_SESSION_UNAVAILABLE");
    useEffect(() => {
        if (!__DEV__ || scope !== "SANDBOX" || input?.context !== "SYNTHETIC_FIXTURE" || mapping?.status !== "SUPPORTED" || !mapping.query) return;
        const selectedQuery = mapping.query;
        let disposed = false, reading = false;
        let latestEligible = false;
        const setView = (arrivalView: JourneyBusArrivalView) => setState({ input, scope, mapping, view: arrivalView });
        const poller = new JourneyBusArrivalPoller();
        const controllers = new Set<AbortController>();
        const invalidate = () => { latestEligible = false; poller.invalidate(); for (const controller of controllers) controller.abort(); };
        const tick = async () => {
            if (disposed || reading) return;
            reading = true;
            try {
                const snapshot = await getAutomaticJourneySnapshot();
                if (disposed) return;
                const binding = getAutomaticJourneyTrialBinding(input);
                latestEligible = AppState.currentState === "active" && busArrivalEligible(snapshot, binding, Date.now());
                if (!latestEligible || !binding) { invalidate(); setView(empty("LOCATION_OR_SESSION_UNAVAILABLE")); return; }
                const stillCurrent = () => !disposed && latestEligible && AppState.currentState === "active"
                    && getAutomaticJourneyTrialBinding(input)?.sessionId === binding.sessionId && binding.expiresAtEpochSeconds * 1000 > Date.now();
                const result = await poller.read(binding, selectedQuery, Date.now(), async () => {
                    const abort = new AbortController(); controllers.add(abort);
                    const timer = setTimeout(() => abort.abort(), 4000);
                    try {
                        const fence = { generation: binding.generation, routeRevision: binding.routeRevision,
                            clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest };
                        const request: RequestInit & { redirect: "error" } = {
                            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", redirect: "error", signal: abort.signal,
                            body: JSON.stringify(fence),
                        };
                        const url = `http://127.0.0.1:15543/api/schedules/9001/automatic-journey/${binding.sessionId}/bus-arrivals`;
                        const read = async (target: string, options: typeof request): Promise<unknown> => {
                            const response = await fetch(target, options);
                            if (!response.ok) throw new Error("ARRIVAL_UNAVAILABLE");
                            const text = await response.text();
                            if (text.length > 65536) throw new Error("RESPONSE_REJECTED");
                            return JSON.parse(text) as unknown;
                        };
                        const saved = projectJourneyBusBinding(await read(`${url}/binding`, request), binding, mapping);
                        if (!stillCurrent()) throw new Error("SESSION_CHANGED");
                        if (saved.status !== "SUPPORTED") return { success: true, data: { ...fence, sessionId: binding.sessionId,
                            schemaVersion: 1, query: selectedQuery, identityEvidence: "SAVED_ROUTE_METADATA", confirmedBoarding: false,
                            remainingStopsToAlight: null, status: saved.status } };
                        return read(url, { ...request, body: JSON.stringify({ ...fence, query: saved.query }) });
                    } finally { clearTimeout(timer); controllers.delete(abort); }
                }, stillCurrent);
                if (!disposed) setView(result);
            } catch { if (!disposed) setView(empty("ARRIVAL_UNAVAILABLE")); }
            finally { reading = false; }
        };
        const native = subscribeAutomaticJourney(snapshot => {
            if (!busArrivalEligible(snapshot, getAutomaticJourneyTrialBinding(input), Date.now())) {
                invalidate(); setView(empty("LOCATION_OR_SESSION_UNAVAILABLE"));
            }
        });
        const subscription = AppState.addEventListener("change", nextState => {
            if (nextState !== "active") { invalidate(); setView(empty("LOCATION_OR_SESSION_UNAVAILABLE")); }
            else tick().catch(() => undefined);
        });
        const timer = setInterval(() => { tick().catch(() => undefined); }, 1000);
        tick().catch(() => undefined);
        return () => { disposed = true; invalidate(); clearInterval(timer); subscription.remove(); native(); };
    }, [input, scope, mapping]);
    const status = mapping?.status !== "SUPPORTED" ? mapping?.status ?? "PROVIDER_ID_MAPPING_REQUIRED"
        : scope === "LOCAL_ONLY" ? "SAVED_ROUTE_SESSION_REQUIRED" : view.status;
    return <View testID="journey-bus-arrival-card" style={styles.card}>
        <Text style={styles.title}>저장 경로 매핑 · P2-2b</Text>
        <Text testID="journey-bus-mapping-status" style={styles.row}>선택 경로 매핑: {mapping?.status ?? "PROVIDER_ID_MAPPING_REQUIRED"} · 승차 원본 순번 {mapping?.boarding?.providerSequence ?? "미확인"}</Text>
        <Text testID="journey-bus-arrival-status" style={styles.row}>도착 관측: {status}</Text>
        <Text testID="journey-bus-arrival-wait" style={styles.title}>{status === "WAITING_INFORMATION" && view.remainingSeconds != null ? `합성 버스 도착까지 ${view.remainingSeconds}초` : "확인된 대기시간 없음"}</Text>
        <Text testID="journey-bus-arrival-vehicle" style={styles.row}>도착 예정 차량: {status === "WAITING_INFORMATION" ? view.incomingVehicleId ?? "미확인" : "미확인"} · 사용자 탑승 차량 아님</Text>
        <Text style={styles.note}>{scope === "SANDBOX" ? "별도 합성 ODsay 매핑 + 기존 TMAP GPS 형상 · 서버 저장 경로와 대조 후에만 조회 · 실제 공급자 호출 없음" : "선택 메타데이터 검사만 수행합니다. 실제 저장 일정·세션 연결은 다음 단계이며 이름만으로 안내하지 않습니다."}</Text>
        <Text style={styles.note}>탑승 미확정 · 하차 잔여 정류장·음성·푸시·Live Activity는 아직 연결하지 않았습니다.</Text>
    </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "#FFFFFF", padding: 14, borderRadius: 12, gap: 8 }, title: { color: "#173953", fontSize: 16, fontWeight: "700" }, row: { color: "#344A60", fontSize: 13, lineHeight: 20 }, note: { color: "#815019", fontSize: 12, lineHeight: 19 } });
