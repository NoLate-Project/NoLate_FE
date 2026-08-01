package com.anonymous.nolate_fe

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max

internal data class QuickScheduleOcrCandidate(
    val text: String,
    val confidence: Double?,
    val evidenceScore: Double,
)

/** Pure scoring helper kept testable without a device or ML Kit runtime. */
internal fun quickScheduleOcrEvidenceScore(text: String, confidence: Double?): Double {
    val normalized = text.trim()
    if (normalized.isEmpty()) return 0.0
    val evidenceCount = listOf(
        Regex("(?:\\d{1,2}[./-]\\d{1,2}|\\d{1,2}월\\s*\\d{1,2}일|오늘|내일|모레|월요일|화요일|수요일|목요일|금요일|토요일|일요일)")
            .containsMatchIn(normalized),
        Regex("(?:오전|오후)?\\s*\\d{1,2}(?::\\d{2}|시)").containsMatchIn(normalized),
        Regex("(?:역|로|길|동|구|시|장소|회의실|카페|병원|학교|에서|으로|까지)").containsMatchIn(normalized),
    ).count { it }
    val textCoverage = (normalized.length.coerceAtMost(200) / 200.0) * 0.2
    val scheduleEvidence = (evidenceCount / 3.0) * 0.5
    val recognition = confidence?.coerceIn(0.0, 1.0)?.times(0.3) ?: 0.0
    return (textCoverage + scheduleEvidence + recognition).coerceIn(0.0, 1.0)
}

/** Android counterpart of the iOS NoLateQuickInput bridge. Media stays on-device. */
class NoLateQuickInputModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val generation = AtomicLong(0)
    private val requestLock = Any()
    @Volatile private var activeRequestId: String? = null
    private val recognizer by lazy {
        TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    }

    override fun getName(): String = "NoLateQuickInput"

    @ReactMethod
    fun recognizeTextFromImage(uri: String, promise: Promise) {
        recognize(uri, UUID.randomUUID().toString(), promise)
    }

    @ReactMethod
    fun recognizeTextFromImageWithRequestId(uri: String, requestId: String, promise: Promise) {
        val normalizedRequestId = requestId.trim()
        if (normalizedRequestId.isEmpty()) {
            promise.reject("quick_input_invalid_request_id", "사진 인식 요청 식별자가 올바르지 않습니다.")
            return
        }
        recognize(uri, normalizedRequestId, promise)
    }

    private fun recognize(uri: String, requestId: String, promise: Promise) {
        val normalizedUri = uri.trim()
        if (normalizedUri.isEmpty()) {
            promise.reject("quick_input_invalid_image_uri", "분석할 사진 파일 경로가 올바르지 않습니다.")
            return
        }
        val requestGeneration = synchronized(requestLock) {
            generation.incrementAndGet().also { activeRequestId = requestId }
        }
        val decodedUri = Uri.parse(normalizedUri)
        val attempts = try {
            buildRecognitionAttempts(decodedUri)
        } catch (error: Exception) {
            if (claimCompletion(requestGeneration, requestId)) {
                promise.reject("quick_input_image_decode_failed", "사진 파일을 읽지 못했습니다.", error)
            } else {
                promise.reject("quick_input_ocr_cancelled", "사진 텍스트 인식이 취소되었습니다.")
            }
            return
        }
        runRecognitionAttempts(
            attempts = attempts,
            requestGeneration = requestGeneration,
            requestId = requestId,
            promise = promise,
        )
    }

    private data class RecognitionAttempts(
        val images: List<InputImage>,
        val ownedBitmaps: List<Bitmap>,
    )

    /** Original EXIF-aware input plus contrast-enhanced and rotated fallbacks, matching iOS policy. */
    private fun buildRecognitionAttempts(uri: Uri): RecognitionAttempts {
        val images = mutableListOf(InputImage.fromFilePath(reactContext, uri))
        val bitmaps = mutableListOf<Bitmap>()
        val source = decodeDownsampledAndOriented(uri) ?: return RecognitionAttempts(images, bitmaps)
        val enhanced = try {
            enhanceForOcr(source)
        } finally {
            source.recycle()
        }
        bitmaps += enhanced
        images += InputImage.fromBitmap(enhanced, 0)
        images += InputImage.fromBitmap(enhanced, 90)
        return RecognitionAttempts(images.take(MAX_OCR_ATTEMPTS), bitmaps)
    }

    private fun runRecognitionAttempts(
        attempts: RecognitionAttempts,
        requestGeneration: Long,
        requestId: String,
        promise: Promise,
    ) {
        val candidates = mutableListOf<QuickScheduleOcrCandidate>()
        var lastFailure: Exception? = null

        fun finish() {
            attempts.ownedBitmaps.forEach { bitmap ->
                if (!bitmap.isRecycled) bitmap.recycle()
            }
        }

        fun resolveBest(attemptCount: Int) {
            if (!claimCompletion(requestGeneration, requestId)) {
                finish()
                promise.reject("quick_input_ocr_cancelled", "사진 텍스트 인식이 취소되었습니다.")
                return
            }
            val best = candidates.maxByOrNull { it.evidenceScore }
            if (best == null || best.text.isBlank()) {
                finish()
                if (lastFailure != null) {
                    promise.reject(
                        "quick_input_ocr_failed",
                        "사진에서 텍스트를 추출하지 못했습니다.",
                        lastFailure,
                    )
                } else {
                    promise.reject("quick_input_ocr_empty", "사진에서 일정 문장을 찾지 못했습니다.")
                }
                return
            }
            val alternatives = candidates
                .sortedByDescending { it.evidenceScore }
                .map { it.text }
                .filter { it.isNotBlank() }
                .distinct()
                .take(MAX_OCR_ATTEMPTS)
            val response = WritableNativeMap().apply {
                putString("text", best.text)
                best.confidence?.let { putDouble("confidence", it) }
                putString("requestId", requestId)
                putInt("attemptCount", attemptCount)
                putArray("alternatives", WritableNativeArray().apply {
                    alternatives.forEach(::pushString)
                })
            }
            finish()
            promise.resolve(response)
        }

        fun run(index: Int) {
            if (!isCurrent(requestGeneration, requestId)) {
                finish()
                promise.reject("quick_input_ocr_cancelled", "사진 텍스트 인식이 취소되었습니다.")
                return
            }
            if (index >= attempts.images.size) {
                resolveBest(index)
                return
            }
            recognizer.process(attempts.images[index])
                .addOnSuccessListener { result ->
                    if (!isCurrent(requestGeneration, requestId)) {
                        finish()
                        promise.reject("quick_input_ocr_cancelled", "사진 텍스트 인식이 취소되었습니다.")
                        return@addOnSuccessListener
                    }
                    val text = result.text.trim()
                    val confidence = recognitionConfidence(result)
                    val candidate = QuickScheduleOcrCandidate(
                        text = text,
                        confidence = confidence,
                        evidenceScore = quickScheduleOcrEvidenceScore(text, confidence),
                    )
                    candidates += candidate
                    if (isSufficient(candidate)) {
                        resolveBest(index + 1)
                    } else {
                        run(index + 1)
                    }
                }
                .addOnFailureListener { error ->
                    lastFailure = error
                    run(index + 1)
                }
        }

        run(0)
    }

    private fun isSufficient(candidate: QuickScheduleOcrCandidate): Boolean =
        candidate.text.isNotBlank() &&
            candidate.confidence != null &&
            candidate.confidence >= OCR_CONFIDENCE_STOP_THRESHOLD &&
            candidate.evidenceScore >= OCR_EVIDENCE_STOP_THRESHOLD

    private fun decodeDownsampledAndOriented(uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        reactContext.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_IMAGE_DIMENSION) {
            sample *= 2
        }
        val decoded = reactContext.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            })
        } ?: return null
        val orientation = reactContext.contentResolver.openInputStream(uri)?.use {
            ExifInterface(it).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        } ?: ExifInterface.ORIENTATION_NORMAL
        val matrix = Matrix().apply {
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
            }
        }
        if (matrix.isIdentity) return decoded
        val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (oriented !== decoded) decoded.recycle()
        return oriented
    }

    private fun enhanceForOcr(source: Bitmap): Bitmap {
        val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
        val grayscale = ColorMatrix().apply { setSaturation(0f) }
        val contrast = 1.35f
        val translate = (-0.5f * contrast + 0.5f) * 255f
        grayscale.postConcat(ColorMatrix(floatArrayOf(
            contrast, 0f, 0f, 0f, translate,
            0f, contrast, 0f, 0f, translate,
            0f, 0f, contrast, 0f, translate,
            0f, 0f, 0f, 1f, 0f,
        )))
        Canvas(output).drawBitmap(
            source,
            0f,
            0f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                colorFilter = ColorMatrixColorFilter(grayscale)
            },
        )
        return output
    }

    /** Length-weighted line confidence keeps tiny decorative labels from dominating the score. */
    private fun recognitionConfidence(result: Text): Double? {
        var weightedTotal = 0.0
        var totalWeight = 0
        result.textBlocks.flatMap { it.lines }.forEach { line ->
            val confidence = runCatching { line.confidence.toDouble() }.getOrNull()
            if (confidence != null && confidence > 0.0 && confidence <= 1.0) {
                val weight = line.text.trim().length.coerceAtLeast(1)
                weightedTotal += confidence * weight
                totalWeight += weight
            }
        }
        return if (totalWeight > 0) (weightedTotal / totalWeight).coerceIn(0.0, 1.0) else null
    }

    private fun isCurrent(requestGeneration: Long, requestId: String): Boolean =
        synchronized(requestLock) {
            generation.get() == requestGeneration && activeRequestId == requestId
        }

    private fun claimCompletion(requestGeneration: Long, requestId: String): Boolean =
        synchronized(requestLock) {
            if (generation.get() != requestGeneration || activeRequestId != requestId) {
                false
            } else {
                activeRequestId = null
                true
            }
        }

    @ReactMethod
    fun cancelImageRecognition(requestId: String, promise: Promise) {
        val normalizedRequestId = requestId.trim()
        val cancelled = synchronized(requestLock) {
            val matches = normalizedRequestId.isNotEmpty() && activeRequestId == normalizedRequestId
            if (matches) {
                generation.incrementAndGet()
                activeRequestId = null
            }
            matches
        }
        promise.resolve(cancelled)
    }

    @ReactMethod
    fun transcribeAudioFile(
        uri: String,
        localeIdentifier: String?,
        contextualStrings: com.facebook.react.bridge.ReadableArray?,
        promise: Promise,
    ) {
        promise.reject(
            "quick_input_audio_file_unsupported",
            "Android에서는 실시간 음성 인식을 사용해 주세요.",
        )
    }

    override fun invalidate() {
        synchronized(requestLock) {
            generation.incrementAndGet()
            activeRequestId = null
        }
        runCatching { recognizer.close() }
        super.invalidate()
    }

    private companion object {
        const val MAX_OCR_ATTEMPTS = 3
        const val MAX_IMAGE_DIMENSION = 3200
        const val OCR_CONFIDENCE_STOP_THRESHOLD = 0.78
        const val OCR_EVIDENCE_STOP_THRESHOLD = 0.62
    }
}
