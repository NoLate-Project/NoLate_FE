package com.anonymous.nolate_fe

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.roundToInt

/**
 * Android SpeechRecognizer bridge matching the iOS NoLateLiveSpeech event contract.
 * The recognizer owns the microphone and never uploads audio to the NoLate backend.
 */
class NoLateLiveSpeechModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), RecognitionListener {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var speechRecognizer: SpeechRecognizer? = null
    private var activeSessionId: String? = null
    private var latestText = ""
    private var latestConfidence: Double? = null
    private var latestAlternatives: List<Pair<String, Double?>> = emptyList()
    private var startedAtMillis = 0L
    private var stopPromise: Promise? = null
    private var durationStop: Runnable? = null
    private var stopFallback: Runnable? = null

    override fun getName(): String = "NoLateLiveSpeech"

    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    @ReactMethod
    fun getAvailability(localeIdentifier: String, promise: Promise) {
        mainHandler.post {
            val serviceAvailable = SpeechRecognizer.isRecognitionAvailable(reactContext)
            val supportsOnDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(reactContext)
            val result = Arguments.createMap().apply {
                putBoolean("serviceAvailable", serviceAvailable)
                putBoolean("supportsOnDevice", supportsOnDevice)
                if (!serviceAvailable) {
                    putString("reason", "이 기기에는 사용할 수 있는 음성 인식 서비스가 없습니다.")
                } else if (!supportsOnDevice) {
                    putString("reason", "이 기기에는 한국어 온디바이스 음성 인식 모델이 없습니다.")
                }
            }
            promise.resolve(result)
        }
    }

    @ReactMethod
    fun start(options: ReadableMap, promise: Promise) {
        val sessionId = options.getString("sessionId")?.trim().orEmpty()
        if (sessionId.isEmpty()) {
            promise.reject("live_speech_invalid_session", "음성 인식 세션 식별자가 올바르지 않습니다.")
            return
        }
        val locale = options.getString("localeIdentifier")?.trim().takeUnless { it.isNullOrEmpty() }
            ?: "ko-KR"
        val maxDurationMillis = options.getDouble("maxDurationMillis")
            .takeIf { it.isFinite() }
            ?.roundToInt()
            ?.coerceIn(5_000, 120_000)
            ?: 60_000
        val requiresOnDevice = options.hasKey("requiresOnDeviceRecognition") &&
            options.getBoolean("requiresOnDeviceRecognition")
        val contextWords = buildList {
            if (options.hasKey("contextualStrings")) {
                val source = options.getArray("contextualStrings")
                if (source != null) {
                    for (index in 0 until source.size()) {
                        source.getString(index)?.trim()?.takeIf { it.length in 2..20 }?.let(::add)
                    }
                }
            }
        }.distinct().take(100)

        mainHandler.post {
            if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                promise.reject("live_speech_permission_denied", "마이크 권한이 필요합니다.")
                return@post
            }
            if (!SpeechRecognizer.isRecognitionAvailable(reactContext)) {
                promise.reject("live_speech_unavailable", "음성 인식 서비스를 사용할 수 없습니다.")
                return@post
            }
            val supportsOnDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(reactContext)
            if (requiresOnDevice && !supportsOnDevice) {
                promise.reject("live_speech_on_device_unavailable", "기기 내 음성 인식을 사용할 수 없습니다.")
                return@post
            }

            cancelActiveSession(emitCancelled = true)
            activeSessionId = sessionId
            latestText = ""
            latestConfidence = null
            latestAlternatives = emptyList()
            startedAtMillis = System.currentTimeMillis()
            emitState("starting")

            val recognizer = try {
                if (requiresOnDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    SpeechRecognizer.createOnDeviceSpeechRecognizer(reactContext)
                } else {
                    SpeechRecognizer.createSpeechRecognizer(reactContext)
                }
            } catch (error: Exception) {
                activeSessionId = null
                promise.reject("live_speech_start_failed", "음성 인식기를 시작하지 못했습니다.", error)
                return@post
            }
            speechRecognizer = recognizer
            recognizer.setRecognitionListener(this)
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, requiresOnDevice)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && contextWords.isNotEmpty()) {
                    putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(contextWords))
                }
            }
            try {
                recognizer.startListening(intent)
            } catch (error: Exception) {
                cancelActiveSession(emitCancelled = false)
                promise.reject("live_speech_start_failed", "음성 인식을 시작하지 못했습니다.", error)
                return@post
            }
            durationStop = Runnable {
                if (activeSessionId == sessionId) {
                    emitState("stopping")
                    speechRecognizer?.stopListening()
                }
            }.also { mainHandler.postDelayed(it, maxDurationMillis.toLong()) }
            promise.resolve(Arguments.createMap().apply { putString("sessionId", sessionId) })
        }
    }

    @ReactMethod
    fun stop(sessionId: String, promise: Promise) {
        val normalized = sessionId.trim()
        mainHandler.post {
            if (normalized.isEmpty() || activeSessionId != normalized || speechRecognizer == null) {
                promise.reject("live_speech_invalid_session", "종료할 음성 인식 세션이 없습니다.")
                return@post
            }
            stopPromise?.reject("live_speech_stop_replaced", "이전 음성 인식 종료 요청이 대체되었습니다.")
            stopPromise = promise
            durationStop?.let(mainHandler::removeCallbacks)
            durationStop = null
            emitState("stopping")
            speechRecognizer?.stopListening()
            stopFallback = Runnable {
                if (activeSessionId != normalized || stopPromise !== promise) return@Runnable
                if (latestText.isNotBlank()) {
                    completeSession(emitFinalTranscript = true)
                } else {
                    stopPromise = null
                    cancelActiveSession(emitCancelled = false)
                    promise.reject("live_speech_no_result", "음성을 인식하지 못했습니다. 다시 말해 주세요.")
                }
            }.also { mainHandler.postDelayed(it, 4_000) }
        }
    }

    @ReactMethod
    fun cancel(sessionId: String, promise: Promise) {
        mainHandler.post {
            if (activeSessionId == sessionId.trim()) cancelActiveSession(emitCancelled = true)
            promise.resolve(null)
        }
    }

    override fun onReadyForSpeech(params: Bundle?) = emitState("listening")
    override fun onBeginningOfSpeech() = emitState("listening")
    override fun onEndOfSpeech() = emitState("stopping")
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    override fun onRmsChanged(rmsdB: Float) {
        val normalized = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f).toDouble()
        emit("NoLateLiveSpeechLevel", Arguments.createMap().apply {
            putString("sessionId", activeSessionId ?: return)
            putDouble("rms", normalized)
            putDouble("peak", normalized)
            putDouble("elapsedMillis", elapsedMillis())
        })
    }

    override fun onPartialResults(partialResults: Bundle?) {
        updateRecognitionResult(partialResults, isFinal = false)
    }

    override fun onResults(results: Bundle?) {
        updateRecognitionResult(results, isFinal = true)
        if (activeSessionId != null) completeSession(emitFinalTranscript = false)
    }

    override fun onError(error: Int) {
        val message = speechErrorMessage(error)
        val pendingStop = stopPromise
        if (pendingStop != null && latestText.isNotBlank()) {
            completeSession(emitFinalTranscript = true)
            return
        }
        stopPromise = null
        pendingStop?.reject("live_speech_failed", message)
        emitState("failed", message)
        cancelActiveSession(emitCancelled = false)
    }

    private fun updateRecognitionResult(bundle: Bundle?, isFinal: Boolean) {
        val texts = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
            .map(String::trim)
            .filter(String::isNotEmpty)
            .distinct()
            .take(3)
        if (texts.isEmpty()) return
        val confidences = bundle?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
        latestText = texts.first()
        latestConfidence = confidences?.getOrNull(0)?.toDouble()?.takeIf { it > 0.0 }?.coerceIn(0.0, 1.0)
        latestAlternatives = texts.mapIndexed { index, text ->
            text to confidences?.getOrNull(index)?.toDouble()?.takeIf { it > 0.0 }?.coerceIn(0.0, 1.0)
        }
        emitTranscript(isFinal)
    }

    private fun emitTranscript(isFinal: Boolean) {
        val sessionId = activeSessionId ?: return
        if (latestText.isBlank()) return
        emit("NoLateLiveSpeechTranscript", resultMap(sessionId, isFinal))
    }

    private fun completeSession(emitFinalTranscript: Boolean) {
        val sessionId = activeSessionId ?: return
        if (emitFinalTranscript) emitTranscript(isFinal = true)
        val result = resultMap(sessionId, isFinal = true)
        val pendingStop = stopPromise
        stopPromise = null
        stopFallback?.let(mainHandler::removeCallbacks)
        stopFallback = null
        durationStop?.let(mainHandler::removeCallbacks)
        durationStop = null
        speechRecognizer?.destroy()
        speechRecognizer = null
        activeSessionId = null
        pendingStop?.resolve(result)
        emitStateForSession(sessionId, "finished")
    }

    private fun resultMap(sessionId: String, isFinal: Boolean): WritableMap =
        Arguments.createMap().apply {
            putString("sessionId", sessionId)
            putString("text", latestText)
            putBoolean("isFinal", isFinal)
            putDouble("elapsedMillis", elapsedMillis())
            latestConfidence?.let { putDouble("confidence", it) }
            putArray("alternatives", Arguments.createArray().apply {
                latestAlternatives.forEach { (text, confidence) ->
                    pushMap(Arguments.createMap().apply {
                        putString("text", text)
                        confidence?.let { putDouble("confidence", it) }
                    })
                }
            })
        }

    private fun cancelActiveSession(emitCancelled: Boolean) {
        val sessionId = activeSessionId
        durationStop?.let(mainHandler::removeCallbacks)
        durationStop = null
        stopFallback?.let(mainHandler::removeCallbacks)
        stopFallback = null
        stopPromise?.reject("live_speech_cancelled", "음성 인식이 취소되었습니다.")
        stopPromise = null
        speechRecognizer?.cancel()
        speechRecognizer?.destroy()
        speechRecognizer = null
        activeSessionId = null
        if (emitCancelled && sessionId != null) emitStateForSession(sessionId, "cancelled")
    }

    private fun emitState(state: String, message: String? = null) {
        activeSessionId?.let { emitStateForSession(it, state, message) }
    }

    private fun emitStateForSession(sessionId: String, state: String, message: String? = null) {
        emit("NoLateLiveSpeechState", Arguments.createMap().apply {
            putString("sessionId", sessionId)
            putString("state", state)
            message?.let { putString("message", it) }
        })
    }

    private fun emit(eventName: String, payload: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    private fun elapsedMillis(): Double =
        if (startedAtMillis == 0L) 0.0 else (System.currentTimeMillis() - startedAtMillis).coerceAtLeast(0).toDouble()

    private fun speechErrorMessage(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "마이크 입력을 처리하지 못했습니다."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "마이크 권한이 필요합니다."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "온라인 음성 인식에 연결하지 못했습니다."
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
            "음성을 인식하지 못했습니다. 다시 말해 주세요."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "음성 인식기가 사용 중입니다. 잠시 후 다시 시도해 주세요."
        else -> "음성 인식을 완료하지 못했습니다."
    }

    override fun invalidate() {
        mainHandler.post { cancelActiveSession(emitCancelled = false) }
        super.invalidate()
    }
}
