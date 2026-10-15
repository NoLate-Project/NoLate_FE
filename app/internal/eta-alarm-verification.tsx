import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useLocalSearchParams } from "expo-router";
import { API_BASE_URL } from "../../src/api/api";
import { getAuthMember } from "../../src/modules/auth/authStorage";
import {
    getDepartureAlarmCapabilities,
    getScheduledDepartureAlarms,
    getPendingNativeAlarmFireEvents,
} from "../../src/modules/notification/departureAlarm";
import { reconcileDepartureAlarmSnapshot } from "../../src/modules/notification/departureAlarmSync";
import { isIsolatedAlarmVerificationEnvironment } from "../../src/modules/notification/isolatedAlarmVerification";

/** Development-only observation UI. Real native scheduling uses the normal authenticated snapshot path. */
export default function EtaAlarmVerification() {
    const { readOnly } = useLocalSearchParams<{ readOnly?: string }>();
    const [status, setStatus] = useState("READY");
    const [evidence, setEvidence] = useState("");
    const [diagnostic, setDiagnostic] = useState("");
    const [busy, setBusy] = useState(false);
    async function refresh() {
        if (busy) return;
        setBusy(true);
        setStatus("INSPECTING");
        setDiagnostic("");
        try {
            // Check the environment before any network/native operation. No direct native alarm injection.
            if (!__DEV__ || Platform.OS !== "ios" || Device.isDevice ||
                API_BASE_URL !== "http://127.0.0.1:5523") throw new Error("ISOLATED_ONLY");
            setStatus("INSPECTING_FIXTURE");
            const response = await fetch(`${API_BASE_URL}/health/readiness`);
            const marker = response.headers.get("X-NoLate-Eta-Fixture");
            if (!response.ok || (await response.json()).status !== "UP") throw new Error("FIXTURE_NOT_READY");
            const authorized = async () => isIsolatedAlarmVerificationEnvironment({
                development: __DEV__, platform: Platform.OS, physicalDevice: Device.isDevice,
                apiBase: API_BASE_URL, memberId: (await getAuthMember())?.id, fixtureMarker: marker,
            });
            if (!(await authorized())) throw new Error("ISOLATED_ONLY");
            // Independent read-only OS probe: distinguish a notification-service
            // wait from a NoLate module/actor wait. Never request permission here.
            setStatus("INSPECTING_OS_PERMISSIONS");
            const osPermissions = await Notifications.getPermissionsAsync();
            setDiagnostic(JSON.stringify({ osPermissionsReadCompleted: true,
                osPermissionStatus: osPermissions.status }));
            setStatus("INSPECTING_CAPABILITIES");
            const capabilities = await getDepartureAlarmCapabilities();
            // Native/JS account fencing remains in the production reconciliation function.
            setStatus("INSPECTING_SNAPSHOT");
            // Automatic-chain tests must observe normal app recovery, not repair
            // a missing reservation by pressing a diagnostic button.
            const sync = readOnly === "1"
                ? { fetched: false, failedCount: 0, inspectionOnly: true }
                : await reconcileDepartureAlarmSnapshot(296);
            if (!(await authorized())) throw new Error("ACCOUNT_CHANGED");
            setStatus("INSPECTING_NATIVE_STORE");
            const alarms = (await getScheduledDepartureAlarms()).filter(item =>
                item.scheduleId === "363" && item.recipientMemberId === 296);
            setStatus("INSPECTING_FIRE_EVENTS");
            const events = (await getPendingNativeAlarmFireEvents()).filter(item =>
                item.scheduleId === "363" && item.recipientMemberId === 296);
            // Read UNUserNotificationCenter's real pending requests independently
            // of our native store. DB/native state alone cannot prove OS cancellation.
            setStatus("INSPECTING_OS_PENDING");
            const osPending = (await Notifications.getAllScheduledNotificationsAsync())
                .filter(item => item.identifier.startsWith("nolate.departure.") &&
                    String(item.content.data?.scheduleId) === "363" &&
                    String(item.content.data?.recipientMemberId) === "296")
                .map(item => ({
                    identifier: item.identifier,
                    generation: Number(item.content.data?.alarmGeneration),
                    nativeAlarmId: item.content.data?.nativeAlarmId,
                    occurrenceId: item.content.data?.occurrenceId,
                    // Preserve actual OS calendar components rather than copy the Worker trigger.
                    trigger: item.trigger,
                })).sort((a, b) => a.identifier.localeCompare(b.identifier));
            if (!(await authorized())) throw new Error("ACCOUNT_CHANGED");
            setEvidence(JSON.stringify({
                classification: "REAL_NATIVE_SIMULATOR_H2_SNAPSHOT", capabilities, sync,
                osPermissionProbe: { readCompleted: true, status: osPermissions.status },
                observedAt: new Date().toISOString(),
                alarms: alarms.map(({ scheduleId, generation, triggerAt, nativeAlarmId, occurrenceId }) =>
                    ({ scheduleId, generation, triggerAt, nativeAlarmId, occurrenceId })),
                events: events.map(({ scheduledFor, occurredAt, timingBasis, occurrenceId }) =>
                    ({ scheduledFor, occurredAt, timingBasis, occurrenceId })),
                osPending,
                audibleSoundObserved: false,
            }));
            setStatus((readOnly === "1" || sync.fetched) && sync.failedCount === 0 ? "INSPECTED" : "SYNC_FAILED");
        } catch {
            // Never render tokens, native raw errors, or an external URL.
            setEvidence("");
            setStatus("BLOCKED");
        } finally { setBusy(false); }
    }
    if (!__DEV__) return null;
    return <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
        <Text accessibilityLabel="격리 알람 전달 검증">격리 알람 전달 검증</Text>
        <Text testID="eta-alarm-status">{status}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="격리 알람 예약 확인"
            disabled={busy} onPress={refresh} style={{ paddingVertical: 24 }}>
            <Text>격리 알람 예약 확인</Text>
        </Pressable>
        <Text testID="eta-alarm-evidence" selectable>{evidence}</Text>
        <Text testID="eta-alarm-diagnostic" selectable>{diagnostic}</Text>
        <Text>실제 네이티브 예약·OS 표시를 확인합니다. 소리 청취는 별도 증거가 필요합니다.</Text>
    </ScrollView>;
}
