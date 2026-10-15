package expo.modules.nolatealarm

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.VibrationAttributes
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.content.ContextCompat

class DepartureAlarmService : Service() {
  private val activeAlarms = LinkedHashMap<String, StoredAlarm>()
  private val handler = Handler(Looper.getMainLooper())
  private val timeoutRunnable = Runnable { stopAndExpireAll() }

  private var mediaPlayer: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var audioManager: AudioManager? = null
  private var vibrating = false
  private var ringingResourcesStarted = false
  private var ringerModeReceiverRegistered = false
  private val ringerModeReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (
        intent?.action == AudioManager.RINGER_MODE_CHANGED_ACTION &&
        ringingResourcesStarted &&
        activeAlarms.isNotEmpty()
      ) {
        syncAlarmAudioWithRingerMode()
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    AlarmNotificationFactory.ensureChannel(this)
    registerRingerModeReceiver()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      AlarmContract.ACTION_STOP_ALL -> {
        activeAlarms.clear()
        stopRingingResources()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
      AlarmContract.ACTION_REMOVE_FROM_SERVICE -> {
        val alarmId = intent.getStringExtra(AlarmContract.EXTRA_ALARM_ID)
        if (alarmId != null) activeAlarms.remove(alarmId)
        if (activeAlarms.isEmpty()) {
          stopRingingResources()
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        } else {
          promote(activeAlarms.values.last())
        }
      }
      AlarmContract.ACTION_FIRE -> handleFire(intent)
      else -> {
        stopSelf(startId)
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(timeoutRunnable)
    unregisterRingerModeReceiver()
    stopRingingResources()
    super.onDestroy()
  }

  private fun handleFire(intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmContract.EXTRA_ALARM_ID) ?: run {
      stopSelf()
      return
    }
    val generation = intent.getLongExtra(
      AlarmContract.EXTRA_GENERATION,
      Long.MIN_VALUE
    )
    val triggerAtMillis = intent.getLongExtra(
      AlarmContract.EXTRA_TRIGGER_AT,
      Long.MIN_VALUE
    )
    val receiverOccurredAtMillis = intent.getLongExtra(
      AlarmContract.EXTRA_RECEIVER_OCCURRED_AT,
      Long.MIN_VALUE
    )
    val serviceAcceptedAtMillis = System.currentTimeMillis()
    val coordinator = DepartureAlarmCoordinator(this)
    val current = coordinator.findCurrentForIntent(
      alarmId,
      generation,
      triggerAtMillis
    )
    if (current == null || current.state != StoredAlarmState.FIRING) {
      if (activeAlarms.isEmpty()) stopSelf()
      return
    }

    activeAlarms[current.alarmId] = current
    promote(current)
    // Record only after this service accepted and promoted the validated alarm, while preserving
    // the receiver callback timestamp. Missing/implausible dispatch metadata is not reported as
    // EXACT_CALLBACK. The journal survives process death until authenticated server delivery.
    AlarmFireEventPolicy.exactCallbackTimestamp(
      triggerAtMillis = triggerAtMillis,
      receiverOccurredAtMillis = receiverOccurredAtMillis,
      serviceAcceptedAtMillis = serviceAcceptedAtMillis
    )?.let { exactCallbackAtMillis ->
      coordinator.recordFireIfCurrent(current, exactCallbackAtMillis)
    }
    if (!ringingResourcesStarted) startRingingResources()
    handler.removeCallbacks(timeoutRunnable)
    handler.postDelayed(timeoutRunnable, AlarmContract.MAX_RING_DURATION_MILLIS)
  }

  private fun promote(alarm: StoredAlarm) {
    val notification = AlarmNotificationFactory.buildRingingNotification(this, alarm)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        AlarmContract.FOREGROUND_NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      )
    } else {
      startForeground(AlarmContract.FOREGROUND_NOTIFICATION_ID, notification)
    }
  }

  private fun startRingingResources() {
    if (ringingResourcesStarted) {
      syncAlarmAudioWithRingerMode()
      return
    }
    ringingResourcesStarted = true
    acquireWakeLock()
    startVibration()
    syncAlarmAudioWithRingerMode()
  }

  private fun syncAlarmAudioWithRingerMode() {
    val manager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (!AlarmOutputModePolicy.shouldPlaySound(manager.ringerMode)) {
      stopAlarmAudio()
      abandonAudioFocus()
      return
    }
    if (mediaPlayer != null) return
    requestAudioFocus()
    startAlarmAudio()
    if (mediaPlayer == null) abandonAudioFocus()
  }

  private fun startAlarmAudio() {
    val candidateUris = listOfNotNull(
      selectedBundledAlarmSoundUri(),
      RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
      RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_NOTIFICATION),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    ).distinct()

    mediaPlayer = candidateUris.firstNotNullOfOrNull { uri ->
      val candidate = MediaPlayer()
      try {
        candidate.apply {
          setAudioAttributes(ALARM_AUDIO_ATTRIBUTES)
          setDataSource(this@DepartureAlarmService, uri)
          isLooping = true
          setWakeMode(this@DepartureAlarmService, PowerManager.PARTIAL_WAKE_LOCK)
          prepare()
          start()
        }
      } catch (_: Throwable) {
        candidate.release()
        null
      }
    }
  }

  private fun selectedBundledAlarmSoundUri(): Uri? {
    val sound = runCatching {
      AlarmSoundPreferenceStore(this).get()
    }.getOrDefault(NoLateAlarmSound.default)
    val resourceId = runCatching {
      resources.getIdentifier(
        sound.rawResourceName,
        "raw",
        packageName
      )
    }.getOrDefault(0)
    if (resourceId == 0) return null
    return Uri.parse("android.resource://$packageName/$resourceId")
  }

  private fun requestAudioFocus() {
    val manager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audioManager = manager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(ALARM_AUDIO_ATTRIBUTES)
        .setOnAudioFocusChangeListener(AUDIO_FOCUS_LISTENER)
        .build()
      audioFocusRequest = request
      manager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(
        AUDIO_FOCUS_LISTENER,
        AudioManager.STREAM_ALARM,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      )
    }
  }

  private fun abandonAudioFocus() {
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let(manager::abandonAudioFocusRequest)
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(AUDIO_FOCUS_LISTENER)
    }
    audioFocusRequest = null
    audioManager = null
  }

  private fun acquireWakeLock() {
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "${packageName}:departure-alarm"
    ).apply {
      setReferenceCounted(false)
      acquire(AlarmContract.MAX_RING_DURATION_MILLIS + 5_000L)
    }
  }

  private fun startVibration() {
    val pattern = longArrayOf(0, 700, 350, 700, 350)
    runCatching {
      val vibrator = alarmVibrator()
      if (!vibrator.hasVibrator()) return@runCatching
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        vibrator.vibrate(
          VibrationEffect.createWaveform(pattern, 0),
          VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)
        )
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        @Suppress("DEPRECATION")
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), ALARM_AUDIO_ATTRIBUTES)
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(pattern, 0, ALARM_AUDIO_ATTRIBUTES)
      }
      vibrating = true
    }
  }

  private fun cancelVibration() {
    if (!vibrating) return
    vibrating = false
    runCatching { alarmVibrator().cancel() }
  }

  @Suppress("DEPRECATION")
  private fun alarmVibrator(): Vibrator =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      getSystemService(VibratorManager::class.java).defaultVibrator
    } else {
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  private fun stopAlarmAudio() {
    mediaPlayer?.runCatching {
      if (isPlaying) stop()
    }
    mediaPlayer?.release()
    mediaPlayer = null
  }

  private fun stopRingingResources() {
    handler.removeCallbacks(timeoutRunnable)
    ringingResourcesStarted = false
    stopAlarmAudio()
    cancelVibration()
    abandonAudioFocus()
    wakeLock?.let {
      if (it.isHeld) it.release()
    }
    wakeLock = null
  }

  private fun registerRingerModeReceiver() {
    if (ringerModeReceiverRegistered) return
    runCatching {
      ContextCompat.registerReceiver(
        this,
        ringerModeReceiver,
        IntentFilter(AudioManager.RINGER_MODE_CHANGED_ACTION),
        ContextCompat.RECEIVER_EXPORTED
      )
    }.onSuccess {
      ringerModeReceiverRegistered = true
    }
  }

  private fun unregisterRingerModeReceiver() {
    if (!ringerModeReceiverRegistered) return
    ringerModeReceiverRegistered = false
    runCatching { unregisterReceiver(ringerModeReceiver) }
  }

  private fun stopAndExpireAll() {
    val coordinator = DepartureAlarmCoordinator(this)
    val nowMillis = System.currentTimeMillis()
    activeAlarms.values.toList().forEach { alarm ->
      coordinator.cancel(
        alarm.alarmId,
        alarm.generation,
        nowMillis,
        notifyRingingService = false
      )
    }
    activeAlarms.clear()
    stopRingingResources()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private companion object {
    val ALARM_AUDIO_ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    val AUDIO_FOCUS_LISTENER = AudioManager.OnAudioFocusChangeListener {
      // Alarm playback remains user-controlled; focus is abandoned on dismiss.
    }
  }
}
