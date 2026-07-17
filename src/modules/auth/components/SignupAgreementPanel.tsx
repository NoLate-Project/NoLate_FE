import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
    getSignupConsentPolicy,
    SIGNUP_CONSENT_POLICY_FALLBACK,
    type LegalDocument,
    type SignupConsentPolicy,
} from "../../../api/legal";
import type { SignupConsentsPayload } from "../../../api/member";
import { useTheme } from "../../theme/ThemeContext";
import { AuthPrimaryButton } from "./AuthScreen";
import {
    buildSignupConsentsPayload,
    EMPTY_SIGNUP_CONSENT_SELECTION,
    hasAllRequiredSignupConsents,
    type SignupConsentSelection,
} from "../signupConsent";

type SignupAgreementPanelProps = {
    submitting: boolean;
    onConfirm: (consents: SignupConsentsPayload) => void | Promise<void>;
    onOpenTerms: () => void;
    onOpenPrivacyCollection: () => void;
    onOpenPrivacyPolicy: () => void;
};

export default function SignupAgreementPanel({
    submitting,
    onConfirm,
    onOpenTerms,
    onOpenPrivacyCollection,
    onOpenPrivacyPolicy,
}: SignupAgreementPanelProps) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    const [policy, setPolicy] = useState<SignupConsentPolicy>(SIGNUP_CONSENT_POLICY_FALLBACK);
    const [selection, setSelection] = useState<SignupConsentSelection>(EMPTY_SIGNUP_CONSENT_SELECTION);
    const [policyLoading, setPolicyLoading] = useState(true);
    const [usingFallbackPolicy, setUsingFallbackPolicy] = useState(false);
    const mountedRef = useRef(true);
    const policyVersionRef = useRef<SignupConsentPolicy>(SIGNUP_CONSENT_POLICY_FALLBACK);
    const allAccepted = hasAllRequiredSignupConsents(selection);

    const loadPolicy = useCallback(async () => {
        setPolicyLoading(true);
        try {
            const latestPolicy = await getSignupConsentPolicy();
            if (!mountedRef.current) return;
            if (!isSamePolicyVersion(policyVersionRef.current, latestPolicy)) {
                setSelection(EMPTY_SIGNUP_CONSENT_SELECTION);
            }
            policyVersionRef.current = latestPolicy;
            setPolicy(latestPolicy);
            setUsingFallbackPolicy(false);
        } catch {
            // 가입 요청은 동일한 버전을 서버에서 다시 검증한다. 번들 문서를 표시하되,
            // 최신 약관이 바뀐 경우를 위해 명시적인 재시도 수단도 함께 제공한다.
            if (mountedRef.current) setUsingFallbackPolicy(true);
        } finally {
            if (mountedRef.current) setPolicyLoading(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        loadPolicy().catch(() => undefined);

        return () => {
            mountedRef.current = false;
        };
    }, [loadPolicy]);

    const toggleAll = () => {
        const next = !allAccepted;
        setSelection({ terms: next, privacyCollection: next });
    };

    const toggle = (key: keyof SignupConsentSelection) => {
        setSelection((current) => ({ ...current, [key]: !current[key] }));
    };

    return (
        <View style={styles.root}>
            <View
                style={[styles.agreementList, { borderColor: colors.border }]}
            >
                <ConsentToggleRow
                    checked={allAccepted}
                    title="필수 항목 모두 동의"
                    subtitle="가입에 필요한 두 항목을 한 번에 선택합니다."
                    onToggle={toggleAll}
                    disabled={submitting}
                    emphasized
                />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <ConsentDocumentRow
                    checked={selection.terms}
                    document={policy.terms}
                    onToggle={() => toggle("terms")}
                    onOpen={onOpenTerms}
                    disabled={submitting}
                />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <ConsentDocumentRow
                    checked={selection.privacyCollection}
                    document={policy.privacyCollection}
                    onToggle={() => toggle("privacyCollection")}
                    onOpen={onOpenPrivacyCollection}
                    disabled={submitting}
                />
            </View>

            {policyLoading ? (
                <View style={styles.policyStatus} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <Text style={[styles.policyStatusText, { color: colors.textSecondary }]}>최신 약관 확인 중</Text>
                </View>
            ) : usingFallbackPolicy ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="최신 가입 약관 다시 확인"
                    accessibilityState={{ disabled: submitting }}
                    disabled={submitting}
                    onPress={loadPolicy}
                    style={({ pressed }) => [styles.policyStatus, { opacity: submitting ? 0.45 : pressed ? 0.55 : 1 }]}
                >
                    <Ionicons name="refresh-outline" size={15} color={colors.textSecondary} />
                    <Text
                        style={[styles.policyStatusText, { color: colors.textSecondary }]}
                    >
                        앱에 포함된 약관 표시 중 · 다시 확인
                    </Text>
                </Pressable>
            ) : null}

            <Pressable
                accessibilityRole="link"
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                onPress={onOpenPrivacyPolicy}
                style={({ pressed }) => [styles.policyLink, { opacity: submitting ? 0.45 : pressed ? 0.55 : 1 }]}
            >
                <Text style={[styles.policyLinkText, { color: colors.textSecondary }]}>개인정보처리방침</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>

            <AuthPrimaryButton
                disabled={!allAccepted || submitting || policyLoading}
                loading={submitting}
                onPress={() => onConfirm(buildSignupConsentsPayload(policy, selection))}
                label={submitting ? "가입 처리 중" : "동의하고 가입하기"}
            />
        </View>
    );
}

function isSamePolicyVersion(current: SignupConsentPolicy, next: SignupConsentPolicy): boolean {
    return current.terms.version === next.terms.version &&
        current.privacyCollection.version === next.privacyCollection.version;
}

type ConsentToggleRowProps = {
    checked: boolean;
    title: string;
    subtitle?: string;
    onToggle: () => void;
    disabled?: boolean;
    emphasized?: boolean;
};

function ConsentToggleRow({
    checked,
    title,
    subtitle,
    onToggle,
    disabled = false,
    emphasized = false,
}: ConsentToggleRowProps) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled }}
            accessibilityLabel={title}
            disabled={disabled}
            onPress={onToggle}
            style={({ pressed }) => [
                styles.toggleRow,
                emphasized && styles.toggleRowEmphasized,
                { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 },
            ]}
        >
            <ConsentCheckbox checked={checked} />
            <View style={styles.copy}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                {subtitle ? (
                    <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
                ) : null}
            </View>
        </Pressable>
    );
}

type ConsentDocumentRowProps = {
    checked: boolean;
    document: LegalDocument;
    onToggle: () => void;
    onOpen: () => void;
    disabled?: boolean;
};

function ConsentDocumentRow({ checked, document, onToggle, onOpen, disabled = false }: ConsentDocumentRowProps) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.documentRow}>
            <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled }}
                accessibilityLabel={`${document.title} 필수 동의`}
                disabled={disabled}
                onPress={onToggle}
                style={({ pressed }) => [styles.documentToggle, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}
            >
                <ConsentCheckbox checked={checked} />
                <View style={styles.copy}>
                    <View style={styles.documentTitleRow}>
                        <Text style={[styles.required, { color: colors.textSecondary }]}>필수</Text>
                        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
                            {document.title}
                        </Text>
                    </View>
                    <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                        {document.summary}
                    </Text>
                </View>
            </Pressable>
            <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${document.title} 자세히 보기`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={onOpen}
                hitSlop={6}
                style={({ pressed }) => [styles.openButton, { opacity: disabled ? 0.45 : pressed ? 0.5 : 1 }]}
            >
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
        </View>
    );
}

function ConsentCheckbox({ checked }: { checked: boolean }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View
            style={[
                styles.checkbox,
                checked ? styles.checkboxChecked : styles.checkboxUnchecked,
            ]}
        >
            {checked ? (
                <Ionicons name="checkmark" size={15} color={colors.selectedDayText} />
            ) : null}
        </View>
    );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"], mode: "dark" | "light") {
    return StyleSheet.create({
        root: {
            gap: 12,
        },
        agreementList: {
            borderWidth: 1,
            borderRadius: 8,
            overflow: "hidden",
            backgroundColor: mode === "dark" ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.018)",
        },
        toggleRow: {
            minHeight: 62,
            paddingHorizontal: 14,
            paddingVertical: 11,
            flexDirection: "row",
            alignItems: "center",
            gap: 11,
        },
        toggleRowEmphasized: {
            minHeight: 68,
        },
        documentRow: {
            minHeight: 74,
            flexDirection: "row",
            alignItems: "stretch",
        },
        documentToggle: {
            flex: 1,
            minWidth: 0,
            paddingLeft: 14,
            paddingVertical: 11,
            flexDirection: "row",
            alignItems: "center",
            gap: 11,
        },
        openButton: {
            width: 44,
            alignItems: "center",
            justifyContent: "center",
        },
        checkbox: {
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 1.5,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        checkboxChecked: {
            borderColor: colors.selectedDayBg,
            backgroundColor: colors.selectedDayBg,
        },
        checkboxUnchecked: {
            borderColor: colors.border,
            backgroundColor: "transparent",
        },
        copy: {
            flex: 1,
            minWidth: 0,
            gap: 3,
        },
        documentTitleRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
        },
        required: {
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "900",
        },
        title: {
            flexShrink: 1,
            fontSize: 14,
            lineHeight: 19,
            fontWeight: "900",
        },
        subtitle: {
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "700",
        },
        divider: {
            height: StyleSheet.hairlineWidth,
        },
        policyLink: {
            minHeight: 32,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
        },
        policyLinkText: {
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "800",
            textDecorationLine: "underline",
        },
        policyStatus: {
            minHeight: 34,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
        },
        policyStatusText: {
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "800",
        },
    });
}
