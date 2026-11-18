import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { getShareInbox } from "../../../../api/scheduleSharing";
import { getCategorySharePermissionLabel } from "../../../share/sharePermissionPresentation";
import { useTheme } from "../../../theme/ThemeContext";
import type { ScheduleItem } from "../../types";

export function ScheduleDetailReadingRow({ label, value, testID }: {
    label: string;
    value: string;
    testID?: string;
}) {
    const { colors } = useTheme();
    return (
        <View testID={testID} accessible accessibilityLabel={`${label}, ${value}`}
            style={[styles.inlineField, { borderTopColor: colors.border }]}>
            <Text style={[styles.label, styles.inlineLabel, { color: colors.textSecondary }]}>{label}</Text>
            <Text style={[styles.value, styles.inlineValue, { color: colors.textPrimary }]}>{value}</Text>
        </View>
    );
}

export default function ScheduleSharingInformation({ item, inline = false }: {
    item: ScheduleItem;
    inline?: boolean;
}) {
    const { colors } = useTheme();
    const { fontScale } = useWindowDimensions();
    const showInline = inline && fontScale <= 1.35;
    const { id, ownerMemberId, sharePermission, shareContentMode } = item;
    const calendarId = item.calendarId ?? item.category.calendarId;
    const categoryId = item.category.id;
    const participantEmail = ownerMemberId == null ? undefined : item.departureParticipants
        ?.find(participant => participant.memberId === ownerMemberId && participant.role === "OWNER")
        ?.email?.trim();
    const [owner, setOwner] = useState<{ scheduleId: string; memberId: number; email: string }>();

    useEffect(() => {
        if (!sharePermission || ownerMemberId == null || participantEmail) return;
        let active = true;
        getShareInbox().then(inbox => {
            if (!active) return;
            const ownedShares = inbox.receivedShares.filter(candidate => candidate.ownerMemberId === ownerMemberId);
            const share = ownedShares.find(candidate => candidate.resourceType === "SCHEDULE" && candidate.resourceId === id)
                ?? ownedShares.find(candidate => candidate.resourceType === "CALENDAR" && candidate.resourceId === String(calendarId))
                ?? ownedShares.find(candidate => candidate.resourceType === "CATEGORY" && candidate.resourceId === categoryId);
            const email = share?.ownerEmail?.trim();
            if (email) setOwner({ scheduleId: id, memberId: ownerMemberId, email });
        }).catch(() => undefined);
        return () => { active = false; };
    }, [calendarId, categoryId, id, ownerMemberId, participantEmail, sharePermission]);

    if (!sharePermission) return null;
    const ownerEmail = participantEmail
        || (owner?.scheduleId === id && owner.memberId === ownerMemberId ? owner.email : undefined);
    const scope = shareContentMode === "SCHEDULE_AND_TRAVEL" ? "일정 + 각자 경로"
        : shareContentMode === "SCHEDULE_ONLY" ? "일정만" : undefined;
    const permission = getCategorySharePermissionLabel(sharePermission);
    const fields: [label: string, value: string | undefined][] = showInline ? [
        ["공유자", ownerEmail],
        ["받은 권한", scope ? `${permission} · ${scope}` : permission],
    ] : [
        ["내 권한", permission],
        ["공유 범위", scope],
        ["공유자", ownerEmail],
    ];

    return (
        <View testID="schedule-sharing-information"
            style={[styles.section, showInline && styles.inlineSection, { borderTopColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>공유 정보</Text>
            {fields.map(([label, value]) => value && (showInline ? (
                <ScheduleDetailReadingRow key={label} label={label} value={value} />
            ) : (
                <View key={label} accessible accessibilityLabel={`${label}, ${value}`}
                    style={styles.field}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
                    <Text style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
                </View>
            )))}
        </View>
    );
}

const styles = StyleSheet.create({
    section: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16, paddingTop: 14, gap: 8 },
    inlineSection: { gap: 4 },
    heading: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
    field: { gap: 2 },
    inlineField: {
        minHeight: 42,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "baseline",
        gap: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    label: { fontSize: 12, fontWeight: "600" },
    inlineLabel: { width: 76 },
    value: { fontSize: 14, fontWeight: "600" },
    inlineValue: { flex: 1, minWidth: 0, lineHeight: 20 },
});
