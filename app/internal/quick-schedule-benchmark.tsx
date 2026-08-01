import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Alert,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { parseScheduleText } from "../../src/api/schedule";
import {
    buildScheduleSpeechContext,
    recognizeQuickSchedulePhoto,
} from "../../src/modules/schedule/quickInputExtraction";
import {
    buildQuickScheduleBenchmarkResult,
    clearQuickScheduleBenchmarkSession,
    exportQuickScheduleBenchmarkJsonl,
    loadQuickScheduleBenchmarkSession,
    nextQuickScheduleBenchmarkCase,
    recordQuickScheduleBenchmarkResult,
    startQuickScheduleBenchmarkSession,
    type QuickScheduleBenchmarkCase,
    type QuickScheduleBenchmarkPlatform,
    type QuickScheduleBenchmarkSession,
} from "../../src/modules/schedule/quickScheduleDeviceBenchmark";
import {
    startLiveSpeechRecognition,
    stopLiveSpeechRecognition,
} from "../../src/modules/schedule/liveSpeechRecognition";
import { useTheme } from "../../src/modules/theme/ThemeContext";

const enabled = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_QUICK_SCHEDULE_BENCHMARK === "true";

function platformName(): QuickScheduleBenchmarkPlatform {
    if (Platform.OS === "ios") return "IOS";
    if (Platform.OS === "android") return "ANDROID";
    throw new Error("실기기 벤치마크는 iOS 또는 Android에서만 실행할 수 있습니다.");
}

export default function QuickScheduleBenchmarkScreen() {
    const { colors } = useTheme();
    const [manifestText, setManifestText] = useState("");
    const [session, setSession] = useState<QuickScheduleBenchmarkSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [speechSessionId, setSpeechSessionId] = useState<string | null>(null);
    const current = useMemo(
        () => session ? nextQuickScheduleBenchmarkCase(session) : undefined,
        [session],
    );

    useEffect(() => {
        if (!enabled) return;
        loadQuickScheduleBenchmarkSession()
            .then((saved) => {
                if (saved) setSession(saved);
            })
            .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, []);

    const saveParseResult = useCallback(async (
        benchmarkCase: QuickScheduleBenchmarkCase,
        text: string,
        inputType: "CONVERSATION" | "IMAGE_OCR" | "VOICE_TRANSCRIPT",
        recognitionConfidence?: number,
        recognitionAlternatives?: Array<{ text: string; confidence?: number }>,
        attemptCount?: number,
    ) => {
        if (!session) return;
        setBusy(true);
        setError("");
        try {
            const result = await parseScheduleText({
                text,
                inputType,
                ...(benchmarkCase.referenceDate
                    ? { referenceDate: benchmarkCase.referenceDate }
                    : {}),
                ...(recognitionConfidence === undefined ? {} : { recognitionConfidence }),
                ...(recognitionAlternatives?.length ? { recognitionAlternatives } : {}),
                clientPlatform: platformName(),
            });
            const benchmarkResult = buildQuickScheduleBenchmarkResult(
                benchmarkCase,
                platformName(),
                result,
                {
                    recognitionConfidence,
                    attemptCount,
                    appVersion: Constants.expoConfig?.version,
                },
            );
            setSession(await recordQuickScheduleBenchmarkResult(session, benchmarkResult));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [session]);

    const startSession = useCallback(async () => {
        setBusy(true);
        setError("");
        try {
            setSession(await startQuickScheduleBenchmarkSession(manifestText));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [manifestText]);

    const runTextCase = useCallback(() => {
        if (!current?.sourceText) return;
        saveParseResult(current, current.sourceText, "CONVERSATION").catch(() => undefined);
    }, [current, saveParseResult]);

    const runPhotoCase = useCallback(async () => {
        if (!current || current.channel !== "PHOTO") return;
        setBusy(true);
        setError("");
        try {
            if (Platform.OS !== "ios") {
                const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!permission.granted) throw new Error("사진 보관함 권한이 필요합니다.");
            }
            const selected = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: false,
                quality: 1,
                preferredAssetRepresentationMode:
                    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
            });
            if (selected.canceled || !selected.assets[0]?.uri) return;
            const recognition = await recognizeQuickSchedulePhoto(
                selected.assets[0].uri,
                `benchmark-${current.id}-${Date.now()}`,
            );
            setBusy(false);
            await saveParseResult(
                current,
                recognition.text,
                "IMAGE_OCR",
                recognition.recognitionConfidence,
                undefined,
                recognition.attemptCount,
            );
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [current, saveParseResult]);

    const startVoiceCase = useCallback(async () => {
        if (!current || current.channel !== "VOICE") return;
        setBusy(true);
        setError("");
        try {
            const nextId = await startLiveSpeechRecognition({
                localeIdentifier: "ko-KR",
                contextualStrings: buildScheduleSpeechContext(current.prompt ?? ""),
                requiresOnDeviceRecognition: true,
            });
            setSpeechSessionId(nextId);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [current]);

    const stopVoiceCase = useCallback(async () => {
        if (!current || current.channel !== "VOICE" || !speechSessionId) return;
        setBusy(true);
        setError("");
        try {
            const recognition = await stopLiveSpeechRecognition(speechSessionId);
            setSpeechSessionId(null);
            if (!recognition.text.trim()) throw new Error("음성 인식 결과가 비어 있습니다.");
            setBusy(false);
            await saveParseResult(
                current,
                recognition.text,
                "VOICE_TRANSCRIPT",
                recognition.confidence,
                recognition.alternatives,
                1,
            );
        } catch (reason) {
            setSpeechSessionId(null);
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    }, [current, saveParseResult, speechSessionId]);

    const shareResults = useCallback(async () => {
        if (!session) return;
        const jsonl = exportQuickScheduleBenchmarkJsonl(session);
        if (!jsonl) {
            setError("내보낼 결과가 없습니다.");
            return;
        }
        await Share.share({ message: jsonl, title: "quick-schedule-results.jsonl" });
    }, [session]);

    const reset = useCallback(() => {
        Alert.alert("측정 세션 삭제", "단말에 저장된 manifest와 결과를 삭제할까요?", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: () => {
                    clearQuickScheduleBenchmarkSession().then(() => {
                        setSession(null);
                        setManifestText("");
                        setError("");
                    }).catch((reason) => {
                        setError(reason instanceof Error ? reason.message : String(reason));
                    });
                },
            },
        ]);
    }, []);

    if (!enabled) {
        return (
            <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>실기기 신뢰도 측정 비활성화</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>
                    이 내부 화면은 개발 빌드 또는 측정 전용 릴리스 후보 빌드에서만 열립니다.
                </Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={[styles.title, { color: colors.textPrimary }]}>빠른 일정 실기기 측정</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>원문·미디어 경로는 결과에 포함되지 않습니다.</Text>

                {!session ? (
                    <>
                        <TextInput
                            value={manifestText}
                            onChangeText={setManifestText}
                            multiline
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="비공개 benchmark manifest JSON 붙여넣기"
                            placeholderTextColor={colors.textDisabled}
                            style={[
                                styles.manifest,
                                {
                                    color: colors.textPrimary,
                                    borderColor: colors.border,
                                    backgroundColor: colors.surface2,
                                },
                            ]}
                        />
                        <ActionButton label="측정 시작" disabled={busy || !manifestText.trim()} onPress={startSession} />
                    </>
                ) : (
                    <>
                        <Text style={[styles.progress, { color: colors.textPrimary }]}>
                            {session.results.length} / {session.manifest.cases.length} 완료
                        </Text>
                        {current ? (
                            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
                                <Text style={[styles.caseId, { color: colors.textPrimary }]}>{current.id} · {current.channel}</Text>
                                {current.mediaAssetId ? (
                                    <Text style={[styles.body, { color: colors.textSecondary }]}>미디어 ID: {current.mediaAssetId}</Text>
                                ) : null}
                                {current.channel === "TEXT" ? (
                                    <Text style={[styles.prompt, { color: colors.textPrimary }]}>{current.sourceText}</Text>
                                ) : null}
                                {current.channel === "VOICE" ? (
                                    <Text style={[styles.prompt, { color: colors.textPrimary }]}>읽을 문장: {current.prompt}</Text>
                                ) : null}
                                <Text style={[styles.expected, { color: colors.textSecondary }]}>
                                    정답: {current.expected.date} {current.expected.time} · {current.expected.destination}
                                </Text>
                                {current.channel === "TEXT" ? (
                                    <ActionButton label="텍스트 분석 및 기록" disabled={busy} onPress={runTextCase} />
                                ) : null}
                                {current.channel === "PHOTO" ? (
                                    <ActionButton label="해당 사진 선택 및 기록" disabled={busy} onPress={runPhotoCase} />
                                ) : null}
                                {current.channel === "VOICE" && !speechSessionId ? (
                                    <ActionButton label="음성 인식 시작" disabled={busy} onPress={startVoiceCase} />
                                ) : null}
                                {current.channel === "VOICE" && speechSessionId ? (
                                    <ActionButton label="음성 인식 종료 및 기록" disabled={busy} onPress={stopVoiceCase} />
                                ) : null}
                            </View>
                        ) : (
                            <Text style={[styles.done, { color: colors.textPrimary }]}>모든 표본 측정이 완료되었습니다.</Text>
                        )}
                        <ActionButton label="JSONL 내보내기" disabled={session.results.length === 0} onPress={shareResults} />
                        <ActionButton label="세션 삭제" destructive onPress={reset} />
                    </>
                )}
                {busy ? <Text style={[styles.body, { color: colors.textSecondary }]}>처리 중…</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>
        </SafeAreaView>
    );
}

function ActionButton({
    label,
    disabled = false,
    destructive = false,
    onPress,
}: {
    label: string;
    disabled?: boolean;
    destructive?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                { backgroundColor: destructive ? "#c62828" : "#1769e0" },
                (pressed || disabled) && styles.buttonMuted,
            ]}
        >
            <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { padding: 20, gap: 14 },
    title: { fontSize: 24, fontWeight: "700" },
    body: { fontSize: 14, lineHeight: 20 },
    progress: { fontSize: 18, fontWeight: "700" },
    manifest: {
        minHeight: 260,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        textAlignVertical: "top",
        fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    },
    card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
    caseId: { fontSize: 18, fontWeight: "700" },
    prompt: { fontSize: 17, lineHeight: 25 },
    expected: { fontSize: 14, lineHeight: 20 },
    done: { fontSize: 18, fontWeight: "700", paddingVertical: 20 },
    button: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13, alignItems: "center" },
    buttonMuted: { opacity: 0.45 },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
    error: { color: "#e53935", fontSize: 14, lineHeight: 20 },
});
