import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alert, Keyboard, Platform } from "react-native";
import { Audio } from "expo-av";

import { buildScheduleSpeechContext } from "../../quickInputExtraction";
import { finalizeQuickScheduleRecording } from "../../quickInputRecording";
import {
  accumulateLiveSpeechTranscript,
  addLiveSpeechLevelListener,
  addLiveSpeechStateListener,
  addLiveSpeechTranscriptListener,
  cancelLiveSpeechRecognition,
  createLiveSpeechTranscriptBuffer,
  createLiveSpeechSessionId,
  getLiveSpeechRecognitionAvailability,
  isLiveSpeechRecognitionAvailable,
  startLiveSpeechRecognition,
  stopLiveSpeechRecognition,
  type LiveSpeechRecognitionAlternative,
} from "../../liveSpeechRecognition";
import {
  LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS,
  LIVE_SPEECH_TOTAL_DURATION_MILLIS,
  appendVoiceMeterHistory,
  createVoiceMeterHistory,
  limitRecognitionAlternatives,
  limitRecognizedText,
  normalizeVoiceMetering,
  waitForAudioForegroundReady,
  type InputMode,
  type LiveSpeechCaptureStartMode,
} from "./quickScheduleModalModel";

type QuickScheduleVoiceControllerOptions = {
  clearPhotoRecognition: () => void;
  closingRef: MutableRefObject<boolean>;
  defaultCategoryTitle?: string;
  mountedRef: MutableRefObject<boolean>;
  selectedCategoryTitle?: string;
  setInputMode: Dispatch<SetStateAction<InputMode>>;
  submitting: boolean;
  text: string;
  visibleRef: MutableRefObject<boolean>;
};

/** 실시간 음성 인식과 녹음 폴백의 상태·권한·세션 정리를 한 경계에서 관리한다. */
export function useQuickScheduleVoiceController({
  clearPhotoRecognition,
  closingRef,
  defaultCategoryTitle,
  mountedRef,
  selectedCategoryTitle,
  setInputMode,
  submitting,
  text,
  visibleRef,
}: QuickScheduleVoiceControllerOptions) {
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [voiceDurationMillis, setVoiceDurationMillis] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceTranscriptTruncated, setVoiceTranscriptTruncated] = useState(false);
  const [voiceRecognitionConfidence, setVoiceRecognitionConfidence] = useState<number>();
  const [voiceRecognitionAlternatives, setVoiceRecognitionAlternatives] = useState<LiveSpeechRecognitionAlternative[]>([]);
  const [voiceStatusMessage, setVoiceStatusMessage] = useState("");
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isVoiceFinalizing, setIsVoiceFinalizing] = useState(false);
  const [voiceMeterHistory, setVoiceMeterHistory] = useState(() => createVoiceMeterHistory(0));
  const audioRecordingRef = useRef<Audio.Recording | null>(null);
  const recordingCleanupPromiseRef = useRef<Promise<string | null> | null>(null);
  const liveSpeechSessionIdRef = useRef<string | null>(null);
  const liveSpeechStartingRef = useRef(false);
  const liveSpeechOperationRef = useRef(0);
  const liveSpeechStopInFlightRef = useRef<{ operation: number; sessionId: string } | null>(null);
  const liveSpeechTranscriptBufferRef = useRef(createLiveSpeechTranscriptBuffer());
  const liveSpeechBaseDurationMillisRef = useRef(0);
  const liveSpeechCaptureActiveRef = useRef(false);
  const liveSpeechCaptureStartedAtRef = useRef(0);
  const liveSpeechRequiresOnDeviceRecognitionRef = useRef(true);
  const beginLiveSpeechCaptureRef = useRef<((requiresOnDeviceRecognition: boolean, startMode: LiveSpeechCaptureStartMode) => Promise<void>) | null>(null);
  const voiceTranscriptRef = useRef("");
  const voiceDurationMillisRef = useRef(0);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 녹음 상태 폴링 타이머를 중지한다. */
  const clearVoiceTimer = useCallback(() => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }, []);

  /** 진행 중인 음성 세션을 무효화해 늦게 도착한 콜백이 화면 상태를 바꾸지 못하게 한다. */
  const invalidateVoiceOperations = useCallback(() => {
    liveSpeechOperationRef.current += 1;
    liveSpeechStartingRef.current = false;
    liveSpeechCaptureActiveRef.current = false;
    liveSpeechCaptureStartedAtRef.current = 0;
  }, []);

  /** 음성 입력 값과 내부 버퍼를 모달 최초 상태로 되돌린다. */
  const resetVoiceInput = useCallback(() => {
    invalidateVoiceOperations();
    clearVoiceTimer();
    voiceDurationMillisRef.current = 0;
    voiceTranscriptRef.current = "";
    liveSpeechBaseDurationMillisRef.current = 0;
    liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
    setVoiceUri(null);
    setVoiceDurationMillis(0);
    setVoiceTranscript("");
    setVoiceTranscriptTruncated(false);
    setVoiceRecognitionConfidence(undefined);
    setVoiceRecognitionAlternatives([]);
    setVoiceStatusMessage("");
    setIsVoiceRecording(false);
    setIsVoiceFinalizing(false);
    setVoiceMeterHistory(createVoiceMeterHistory());
  }, [clearVoiceTimer, invalidateVoiceOperations]);

  /** 활성 녹음·실시간 인식을 중지하고 요청 시 완성된 녹음 URI를 보존한다. */
  const stopActiveRecording = useCallback((preserveRecording = false): Promise<string | null> => {
    const pendingCleanup = recordingCleanupPromiseRef.current;
    const recorder = audioRecordingRef.current;
    const liveSpeechSessionId = liveSpeechSessionIdRef.current;
    const cleanupOperation = liveSpeechOperationRef.current + 1;
    liveSpeechOperationRef.current = cleanupOperation;
    liveSpeechCaptureActiveRef.current = false;
    liveSpeechCaptureStartedAtRef.current = 0;
    audioRecordingRef.current = null;
    liveSpeechSessionIdRef.current = null;
    liveSpeechStartingRef.current = false;
    liveSpeechStopInFlightRef.current = null;
    clearVoiceTimer();
    setIsVoiceRecording(false);
    if (!preserveRecording) setIsVoiceFinalizing(false);
    setVoiceMeterHistory(createVoiceMeterHistory());
    if (!preserveRecording) {
      voiceDurationMillisRef.current = 0;
      voiceTranscriptRef.current = "";
      liveSpeechBaseDurationMillisRef.current = 0;
      liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
      setVoiceUri(null);
      setVoiceDurationMillis(0);
      setVoiceTranscript("");
      setVoiceTranscriptTruncated(false);
      setVoiceRecognitionConfidence(undefined);
      setVoiceRecognitionAlternatives([]);
      setVoiceStatusMessage("");
    }
    const cleanupPromise = (async () => {
      let pendingResult: string | null = null;
      if (pendingCleanup) {
        try { pendingResult = await pendingCleanup; }
        catch (error) { if (preserveRecording && !recorder && !liveSpeechSessionId) throw error; }
      }
      if (liveSpeechSessionId) await cancelLiveSpeechRecognition(liveSpeechSessionId).catch(() => undefined);
      if (!recorder) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
        return preserveRecording ? pendingResult : null;
      }
      try {
        if (!preserveRecording) {
          await recorder.stopAndUnloadAsync();
          return null;
        }
        const recordedUri = await finalizeQuickScheduleRecording(recorder);
        if (liveSpeechOperationRef.current === cleanupOperation && mountedRef.current && visibleRef.current && !closingRef.current) setVoiceUri(recordedUri);
        return recordedUri;
      } catch (error) {
        if (preserveRecording) throw error;
        return null;
      } finally {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
      }
    })();
    recordingCleanupPromiseRef.current = cleanupPromise;
    /** 완료된 정리 Promise가 아직 현재 작업일 때만 참조를 비운다. */
    const clearCleanup = () => {
      if (recordingCleanupPromiseRef.current === cleanupPromise) recordingCleanupPromiseRef.current = null;
    };
    cleanupPromise.then(clearCleanup, clearCleanup);
    return cleanupPromise;
  }, [clearVoiceTimer, closingRef, mountedRef, visibleRef]);

  useEffect(() => {
    /** 수신 이벤트가 현재 음성 세션에 속하는지 확인한다. */
    const belongsToActiveSession = (sessionId: string) => liveSpeechSessionIdRef.current === sessionId;
    const transcriptSubscription = addLiveSpeechTranscriptListener(event => {
      if (!belongsToActiveSession(event.sessionId)) return;
      const snapshot = accumulateLiveSpeechTranscript(liveSpeechTranscriptBufferRef.current, event);
      liveSpeechTranscriptBufferRef.current = snapshot.buffer;
      const limited = limitRecognizedText(snapshot.text);
      voiceTranscriptRef.current = limited.text;
      setVoiceTranscript(limited.text);
      setVoiceTranscriptTruncated(limited.truncated);
      setVoiceRecognitionAlternatives(limitRecognitionAlternatives(snapshot.alternatives));
      setVoiceRecognitionConfidence(event.confidence);
      if (event.elapsedMillis !== undefined) {
        const duration = Math.min(LIVE_SPEECH_TOTAL_DURATION_MILLIS, liveSpeechBaseDurationMillisRef.current + event.elapsedMillis);
        voiceDurationMillisRef.current = duration;
        setVoiceDurationMillis(duration);
      }
    });
    const levelSubscription = addLiveSpeechLevelListener(event => {
      if (!belongsToActiveSession(event.sessionId)) return;
      setVoiceMeterHistory(current => appendVoiceMeterHistory(current, Math.max(event.rms, event.peak * 0.72)));
      if (event.elapsedMillis !== undefined) {
        const duration = Math.min(LIVE_SPEECH_TOTAL_DURATION_MILLIS, liveSpeechBaseDurationMillisRef.current + event.elapsedMillis);
        voiceDurationMillisRef.current = duration;
        setVoiceDurationMillis(duration);
      }
    });
    const stateSubscription = addLiveSpeechStateListener(event => {
      if (!belongsToActiveSession(event.sessionId)) return;
      if (event.state === "listening") {
        setIsVoiceFinalizing(false); setIsVoiceRecording(true); setVoiceStatusMessage(""); return;
      }
      if (event.state === "stopping") {
        setIsVoiceRecording(false); setIsVoiceFinalizing(true); setVoiceStatusMessage("마지막 문장을 정리하고 있어요."); return;
      }
      if (event.state === "finished" || event.state === "cancelled" || event.state === "failed") {
        const shouldRollover = event.state === "finished" && liveSpeechCaptureActiveRef.current && !liveSpeechStopInFlightRef.current && mountedRef.current && visibleRef.current && !closingRef.current;
        liveSpeechSessionIdRef.current = null;
        liveSpeechStartingRef.current = false;
        const wallTime = liveSpeechCaptureStartedAtRef.current > 0 ? Date.now() - liveSpeechCaptureStartedAtRef.current : 0;
        const remaining = LIVE_SPEECH_TOTAL_DURATION_MILLIS - Math.max(voiceDurationMillisRef.current, wallTime);
        const restartCapture = beginLiveSpeechCaptureRef.current;
        if (shouldRollover && remaining >= LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS && restartCapture) {
          setIsVoiceRecording(true); setIsVoiceFinalizing(true); setVoiceStatusMessage("계속 듣고 있어요.");
          restartCapture(liveSpeechRequiresOnDeviceRecognitionRef.current, "rollover").catch(() => undefined);
          return;
        }
        liveSpeechCaptureActiveRef.current = false;
        liveSpeechCaptureStartedAtRef.current = 0;
        setIsVoiceRecording(false); setIsVoiceFinalizing(false); setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceStatusMessage(event.state === "failed" ? event.message ?? "음성을 인식하지 못했습니다. 다시 말해 주세요." : "");
      }
    });
    return () => { transcriptSubscription?.remove(); levelSubscription?.remove(); stateSubscription?.remove(); };
  }, [closingRef, mountedRef, visibleRef]);

  /** 기기 음성 인식 세션을 시작하고 60초 제한 내에서는 종료 시 다음 세션으로 이어간다. */
  const beginLiveSpeechCapture = useCallback(async (requiresOnDeviceRecognition: boolean, startMode: LiveSpeechCaptureStartMode = "fresh") => {
    if (!mountedRef.current || !visibleRef.current || closingRef.current || liveSpeechSessionIdRef.current || liveSpeechStartingRef.current || liveSpeechStopInFlightRef.current) return;
    if (startMode === "rollover" && !liveSpeechCaptureActiveRef.current) return;
    if (startMode === "fresh") {
      liveSpeechCaptureActiveRef.current = true;
      liveSpeechCaptureStartedAtRef.current = Date.now();
      voiceDurationMillisRef.current = 0; voiceTranscriptRef.current = ""; liveSpeechBaseDurationMillisRef.current = 0;
      liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
      setVoiceDurationMillis(0); setVoiceTranscript(""); setVoiceTranscriptTruncated(false);
      setVoiceRecognitionConfidence(undefined); setVoiceRecognitionAlternatives([]);
    }
    liveSpeechRequiresOnDeviceRecognitionRef.current = requiresOnDeviceRecognition;
    const wallTime = liveSpeechCaptureStartedAtRef.current > 0 ? Date.now() - liveSpeechCaptureStartedAtRef.current : 0;
    const remaining = LIVE_SPEECH_TOTAL_DURATION_MILLIS - Math.max(voiceDurationMillisRef.current, wallTime);
    if (remaining < LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS) {
      liveSpeechCaptureActiveRef.current = false; liveSpeechCaptureStartedAtRef.current = 0;
      setIsVoiceRecording(false); setIsVoiceFinalizing(false); setVoiceStatusMessage(""); return;
    }
    const operation = liveSpeechOperationRef.current + 1;
    liveSpeechOperationRef.current = operation;
    const requestedSessionId = createLiveSpeechSessionId();
    liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer(voiceTranscriptRef.current);
    liveSpeechBaseDurationMillisRef.current = voiceDurationMillisRef.current;
    liveSpeechSessionIdRef.current = requestedSessionId;
    liveSpeechStartingRef.current = true;
    setIsVoiceFinalizing(true);
    setVoiceStatusMessage(requiresOnDeviceRecognition ? "오프라인 음성 입력을 시작하고 있어요." : "인터넷 음성 입력을 시작하고 있어요.");
    try {
      const sessionId = await startLiveSpeechRecognition({
        sessionId: requestedSessionId,
        localeIdentifier: "ko-KR",
        contextualStrings: buildScheduleSpeechContext(`${text} ${voiceTranscriptRef.current} ${selectedCategoryTitle ?? defaultCategoryTitle ?? ""}`),
        maxDurationMillis: remaining,
        requiresOnDeviceRecognition,
      });
      if (!liveSpeechStartingRef.current || liveSpeechOperationRef.current !== operation || liveSpeechSessionIdRef.current !== sessionId || !visibleRef.current || closingRef.current || !liveSpeechCaptureActiveRef.current) {
        await cancelLiveSpeechRecognition(sessionId).catch(() => undefined); return;
      }
      liveSpeechSessionIdRef.current = sessionId;
      liveSpeechStartingRef.current = false;
      setIsVoiceFinalizing(false); setIsVoiceRecording(true);
      const recognizer = Platform.OS === "ios" ? "Apple" : "Android";
      setVoiceStatusMessage(requiresOnDeviceRecognition ? "음성을 글자로 옮기고 있어요." : `인터넷 음성 입력 사용 중 · 음성은 ${recognizer} 서비스로 전송될 수 있지만 NoLate에는 저장되지 않아요.`);
    } catch (error) {
      if (liveSpeechOperationRef.current !== operation) return;
      if (liveSpeechSessionIdRef.current === requestedSessionId) liveSpeechSessionIdRef.current = null;
      liveSpeechStartingRef.current = false; liveSpeechCaptureActiveRef.current = false; liveSpeechCaptureStartedAtRef.current = 0;
      if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
      setIsVoiceRecording(false); setIsVoiceFinalizing(false); setVoiceMeterHistory(createVoiceMeterHistory());
      const message = error instanceof Error ? error.message : "음성 입력을 시작하지 못했어요.";
      setVoiceStatusMessage(message); Alert.alert("음성 입력을 시작하지 못했어요", message);
    }
  }, [closingRef, defaultCategoryTitle, mountedRef, selectedCategoryTitle, text, visibleRef]);

  useEffect(() => {
    beginLiveSpeechCaptureRef.current = beginLiveSpeechCapture;
    return () => { if (beginLiveSpeechCaptureRef.current === beginLiveSpeechCapture) beginLiveSpeechCaptureRef.current = null; };
  }, [beginLiveSpeechCapture]);

  /** 마이크 권한과 인식 가능 여부를 확인한 뒤 실시간 인식 또는 녹음 폴백을 시작한다. */
  const startVoiceRecording = useCallback(async () => {
    if (submitting || isVoiceRecording || isVoiceFinalizing || audioRecordingRef.current || liveSpeechSessionIdRef.current || liveSpeechStartingRef.current || liveSpeechStopInFlightRef.current || !mountedRef.current || !visibleRef.current || closingRef.current) return;
    const operation = liveSpeechOperationRef.current + 1;
    liveSpeechOperationRef.current = operation; liveSpeechStartingRef.current = true; setIsVoiceFinalizing(true);
    /** 비동기 준비 결과가 아직 현재 시작 요청에 속하는지 확인한다. */
    const startIsCurrent = () => liveSpeechOperationRef.current === operation && liveSpeechStartingRef.current && mountedRef.current && visibleRef.current && !closingRef.current;
    const pendingCleanup = recordingCleanupPromiseRef.current;
    if (pendingCleanup) { setVoiceStatusMessage("이전 음성 입력을 마무리하고 있어요."); await pendingCleanup.catch(() => undefined); if (!startIsCurrent()) return; }
    Keyboard.dismiss(); setInputMode("voice"); clearPhotoRecognition(); setVoiceUri(null); setVoiceStatusMessage(""); setVoiceMeterHistory(createVoiceMeterHistory()); clearVoiceTimer();
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!startIsCurrent()) return;
      if (!permission.granted) { liveSpeechStartingRef.current = false; setIsVoiceFinalizing(false); Alert.alert("마이크 권한 필요", "음성으로 빠른 일정을 만들려면 마이크 권한이 필요합니다."); return; }
    } catch (error) {
      if (!startIsCurrent()) return;
      liveSpeechStartingRef.current = false; setIsVoiceFinalizing(false);
      Alert.alert("마이크 권한 확인 실패", error instanceof Error ? error.message : "마이크 권한을 확인하지 못했습니다."); return;
    }
    if (isLiveSpeechRecognitionAvailable) {
      setVoiceStatusMessage("음성 입력을 준비하고 있어요.");
      try {
        const availability = await getLiveSpeechRecognitionAvailability("ko-KR");
        if (!startIsCurrent()) return;
        liveSpeechStartingRef.current = false; setIsVoiceFinalizing(false);
        if (!availability.serviceAvailable) {
          const message = availability.reason ?? "현재 이 기기에서 한국어 음성 인식 서비스를 사용할 수 없습니다.";
          setVoiceStatusMessage(`${message} 아래 입력칸에 직접 입력할 수 있어요.`);
          Alert.alert("음성 인식 사용 불가", `${message}\n\n아래 인식 문장 칸에 일정을 직접 입력해 주세요.`); return;
        }
        if (availability.supportsOnDevice) { await beginLiveSpeechCapture(true); return; }
        const reason = availability.reason ?? "이 기기에서는 오프라인 음성 입력을 사용할 수 없어요.";
        setVoiceStatusMessage(`${reason} 직접 입력하거나 온라인 인식을 선택할 수 있어요.`);
        Alert.alert("음성 입력 방법을 선택해 주세요", `${reason}\n\n인터넷 음성 입력으로 계속하면 음성이 ${Platform.OS === "ios" ? "Apple 음성 인식 서비스" : "Android 음성 인식 서비스"}로 전송될 수 있지만, NoLate에는 저장되지 않아요.`, [
          { text: "직접 입력", style: "cancel" },
          { text: "인터넷 음성 입력", onPress: () => { if (liveSpeechOperationRef.current === operation && visibleRef.current && !closingRef.current) beginLiveSpeechCapture(false).catch(() => undefined); } },
        ]);
      } catch (error) {
        if (liveSpeechOperationRef.current !== operation) return;
        liveSpeechStartingRef.current = false;
        if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
        setIsVoiceRecording(false); setIsVoiceFinalizing(false); setVoiceMeterHistory(createVoiceMeterHistory());
        const message = error instanceof Error ? error.message : "음성 입력을 준비하지 못했어요.";
        setVoiceStatusMessage(`${message} 아래 입력칸에 직접 입력할 수 있어요.`); Alert.alert("음성 인식 확인 실패", message);
      }
      return;
    }
    voiceDurationMillisRef.current = 0; voiceTranscriptRef.current = ""; liveSpeechBaseDurationMillisRef.current = 0;
    liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
    setVoiceDurationMillis(0); setVoiceTranscript(""); setVoiceTranscriptTruncated(false); setVoiceRecognitionConfidence(undefined); setVoiceRecognitionAlternatives([]);
    let recorder: Audio.Recording | null = null;
    let recordingAudioModeEnabled = false;
    /** 녹음 모드를 일반 재생 모드로 되돌린다. */
    const restorePlaybackAudioMode = async () => { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined); };
    /** 아직 소유권을 넘기지 않은 녹음기를 버리고 오디오 모드를 복원한다. */
    const discardPreparedRecorder = async () => {
      const staleRecorder = recorder; recorder = null;
      if (staleRecorder) await staleRecorder.stopAndUnloadAsync().catch(() => undefined);
      if (recordingAudioModeEnabled) { recordingAudioModeEnabled = false; await restorePlaybackAudioMode(); }
    };
    try {
      await waitForAudioForegroundReady(); if (!startIsCurrent()) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); recordingAudioModeEnabled = true;
      if (!startIsCurrent()) { await discardPreparedRecorder(); return; }
      /** 고품질 미터링 녹음기를 준비하고 실제 녹음을 시작한다. */
      const prepareAndStartRecording = async () => {
        const candidate = new Audio.Recording(); recorder = candidate;
        try { await candidate.prepareToRecordAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true }); await candidate.startAsync(); return candidate; }
        catch (error) { await candidate.stopAndUnloadAsync().catch(() => undefined); if (recorder === candidate) recorder = null; throw error; }
      };
      try { recorder = await prepareAndStartRecording(); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("background")) throw error;
        if (!startIsCurrent()) { await discardPreparedRecorder(); return; }
        await waitForAudioForegroundReady();
        if (!startIsCurrent()) { await discardPreparedRecorder(); return; }
        recorder = await prepareAndStartRecording();
      }
      if (!startIsCurrent()) { await discardPreparedRecorder(); return; }
      audioRecordingRef.current = recorder; recorder = null; liveSpeechStartingRef.current = false;
      setIsVoiceFinalizing(false); setIsVoiceRecording(true);
      voiceTimerRef.current = setInterval(() => {
        const activeRecorder = audioRecordingRef.current; if (!activeRecorder) return;
        activeRecorder.getStatusAsync().then(status => {
          if ("durationMillis" in status) setVoiceDurationMillis(status.durationMillis ?? 0);
          const level = normalizeVoiceMetering(status.metering);
          if (level !== null) setVoiceMeterHistory(current => appendVoiceMeterHistory(current, level));
        }).catch(() => undefined);
      }, 110);
    } catch (error) {
      await discardPreparedRecorder(); if (!startIsCurrent()) return;
      audioRecordingRef.current = null; liveSpeechStartingRef.current = false; clearVoiceTimer();
      setIsVoiceRecording(false); setIsVoiceFinalizing(false); setVoiceMeterHistory(createVoiceMeterHistory());
      console.warn("[QuickSchedule] Voice recording failed to start.", error);
      Alert.alert("녹음 시작 실패", "음성 녹음을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }, [beginLiveSpeechCapture, clearPhotoRecognition, clearVoiceTimer, closingRef, isVoiceFinalizing, isVoiceRecording, mountedRef, setInputMode, submitting, visibleRef]);

  /** 실시간 인식의 마지막 문장을 확정하거나 녹음 파일을 안전하게 저장한다. */
  const stopVoiceRecording = useCallback(async () => {
    if (isVoiceFinalizing || liveSpeechStopInFlightRef.current) return;
    liveSpeechCaptureActiveRef.current = false; liveSpeechCaptureStartedAtRef.current = 0;
    const sessionId = liveSpeechSessionIdRef.current;
    if (sessionId) {
      const operation = liveSpeechOperationRef.current;
      const stopOperation = { operation, sessionId };
      liveSpeechStopInFlightRef.current = stopOperation;
      setIsVoiceRecording(false); setIsVoiceFinalizing(true); setVoiceStatusMessage("마지막 문장을 정리하고 있어요.");
      try {
        const result = await stopLiveSpeechRecognition(sessionId);
        if (liveSpeechStopInFlightRef.current !== stopOperation || liveSpeechOperationRef.current !== operation || !mountedRef.current || !visibleRef.current || closingRef.current) return;
        const snapshot = accumulateLiveSpeechTranscript(liveSpeechTranscriptBufferRef.current, result);
        liveSpeechTranscriptBufferRef.current = snapshot.buffer;
        const limited = limitRecognizedText(snapshot.text);
        voiceTranscriptRef.current = limited.text; setVoiceTranscript(limited.text); setVoiceTranscriptTruncated(limited.truncated);
        setVoiceRecognitionAlternatives(limitRecognitionAlternatives(snapshot.alternatives)); setVoiceRecognitionConfidence(result.confidence);
        if (result.elapsedMillis !== undefined) {
          const duration = Math.min(LIVE_SPEECH_TOTAL_DURATION_MILLIS, liveSpeechBaseDurationMillisRef.current + result.elapsedMillis);
          voiceDurationMillisRef.current = duration; setVoiceDurationMillis(duration);
        }
        setVoiceStatusMessage("");
      } catch (error) {
        if (liveSpeechStopInFlightRef.current !== stopOperation || liveSpeechOperationRef.current !== operation || !mountedRef.current || !visibleRef.current || closingRef.current) return;
        const message = error instanceof Error ? error.message : "말한 내용을 불러오지 못했어요.";
        setVoiceStatusMessage(message); Alert.alert("음성 입력을 마치지 못했어요", message);
      } finally {
        const owns = liveSpeechStopInFlightRef.current === stopOperation;
        if (owns) liveSpeechStopInFlightRef.current = null;
        if (!owns || liveSpeechOperationRef.current !== operation) return;
        if (liveSpeechSessionIdRef.current === sessionId) liveSpeechSessionIdRef.current = null;
        liveSpeechStartingRef.current = false;
        if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
        setIsVoiceRecording(false); setIsVoiceFinalizing(false); setVoiceMeterHistory(createVoiceMeterHistory());
      }
      return;
    }
    if (!audioRecordingRef.current) return;
    setIsVoiceFinalizing(true);
    const cleanupPromise = stopActiveRecording(true);
    const operation = liveSpeechOperationRef.current;
    try { await cleanupPromise; }
    catch (error) {
      if (liveSpeechOperationRef.current !== operation || !mountedRef.current || !visibleRef.current || closingRef.current) return;
      setVoiceUri(null); Alert.alert("녹음 저장 실패", error instanceof Error ? error.message : "녹음 파일을 저장하지 못했습니다. 다시 녹음해 주세요.");
    } finally {
      if (liveSpeechOperationRef.current === operation && mountedRef.current && visibleRef.current && !closingRef.current) setIsVoiceFinalizing(false);
    }
  }, [closingRef, isVoiceFinalizing, mountedRef, stopActiveRecording, visibleRef]);

  /** 사용자가 인식 문장을 직접 고치면 표시 상태와 누적 인식 버퍼를 같은 값으로 맞춘다. */
  const updateVoiceTranscript = useCallback((value: string) => {
    voiceTranscriptRef.current = value;
    liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer(value);
    setVoiceTranscript(value); setVoiceTranscriptTruncated(false); setVoiceRecognitionConfidence(undefined);
    setVoiceRecognitionAlternatives([]); setVoiceStatusMessage("");
  }, []);

  useEffect(() => () => { invalidateVoiceOperations(); clearVoiceTimer(); }, [clearVoiceTimer, invalidateVoiceOperations]);

  return {
    hasActiveVoiceSession: Boolean(audioRecordingRef.current || isVoiceRecording || isVoiceFinalizing || voiceUri),
    invalidateVoiceOperations,
    isVoiceFinalizing,
    isVoiceRecording,
    resetVoiceInput,
    startVoiceRecording,
    stopActiveRecording,
    stopVoiceRecording,
    updateVoiceTranscript,
    voiceDurationMillis,
    voiceMeterHistory,
    voiceRecognitionAlternatives,
    voiceRecognitionConfidence,
    voiceStatusMessage,
    voiceTranscript,
    voiceTranscriptTruncated,
    voiceUri,
  };
}
