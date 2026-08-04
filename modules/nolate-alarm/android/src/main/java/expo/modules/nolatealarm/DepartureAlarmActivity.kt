package expo.modules.nolatealarm

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Space
import android.widget.TextView
import android.widget.Toast
import java.text.DateFormat
import java.util.Date

class DepartureAlarmActivity : Activity() {
  private var currentAlarm: StoredAlarm? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    configureLockScreenWindow()
    volumeControlStream = AudioManager.STREAM_ALARM
    renderIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    renderIntent(intent)
  }

  private fun configureLockScreenWindow() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun renderIntent(sourceIntent: Intent?) {
    val alarmId = sourceIntent?.getStringExtra(AlarmContract.EXTRA_ALARM_ID)
      ?: run {
        finish()
        return
      }
    val generation = sourceIntent.getLongExtra(
      AlarmContract.EXTRA_GENERATION,
      Long.MIN_VALUE
    )
    val triggerAtMillis = sourceIntent.getLongExtra(
      AlarmContract.EXTRA_TRIGGER_AT,
      Long.MIN_VALUE
    )
    val alarm = DepartureAlarmCoordinator(this).findCurrentForIntent(
      alarmId,
      generation,
      triggerAtMillis
    )
    // AlarmClockInfo.showIntent can be tapped before the alarm fires. It must
    // not expose dismiss/snooze controls until the receiver marks it FIRING.
    if (alarm == null || alarm.state != StoredAlarmState.FIRING) {
      finish()
      return
    }

    currentAlarm = alarm
    when (sourceIntent.action) {
      AlarmContract.ACTION_DEPART -> {
        handleDepart(alarm)
        return
      }
      AlarmContract.ACTION_OPEN_ROUTE -> {
        handleOpenRoute(alarm)
        return
      }
    }
    setContentView(createContent(alarm))
  }

  private fun createContent(alarm: StoredAlarm): View {
    val density = resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(28), dp(44), dp(28), dp(28))
      setBackgroundColor(getColor(R.color.nolate_alarm_background))
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        setOnApplyWindowInsetsListener { view, insets ->
          val bars = insets.getInsets(WindowInsets.Type.systemBars())
          view.setPadding(
            dp(28) + bars.left,
            dp(44) + bars.top,
            dp(28) + bars.right,
            dp(28) + bars.bottom
          )
          insets
        }
      }
      setOnClickListener { handleOpenRoute(alarm) }
    }

    root.addView(TextView(this).apply {
      text = DateFormat.getTimeInstance(DateFormat.SHORT).format(
        Date(alarm.effectiveTriggerAtMillis)
      )
      textSize = 54f
      setTextColor(getColor(R.color.nolate_alarm_text))
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = alarm.title ?: getString(R.string.nolate_alarm_title)
      textSize = 26f
      setTextColor(getColor(R.color.nolate_alarm_text))
      gravity = Gravity.CENTER
      setPadding(0, dp(24), 0, dp(8))
    })
    root.addView(TextView(this).apply {
      text = alarm.body ?: getString(R.string.nolate_alarm_body)
      textSize = 16f
      setTextColor(getColor(R.color.nolate_alarm_text_secondary))
      gravity = Gravity.CENTER
    })
    root.addView(Space(this), LinearLayout.LayoutParams(1, 0, 1f))

    root.addView(createButton(
      getString(R.string.nolate_alarm_depart),
      getColor(R.color.nolate_alarm_primary)
    ) {
      handleDepart(alarm)
    })
    if (AlarmSnoozePolicy.isAvailable(alarm)) {
      root.addView(createButton(
        getString(R.string.nolate_alarm_snooze),
        getColor(R.color.nolate_alarm_surface)
      ) {
        sendAlarmAction(AlarmContract.ACTION_SNOOZE)
        finish()
      })
    }
    root.addView(createButton(
      getString(R.string.nolate_alarm_stop),
      Color.TRANSPARENT
    ) {
      sendAlarmAction(AlarmContract.ACTION_DISMISS)
      finish()
    })
    return root
  }

  private fun createButton(
    label: String,
    backgroundColor: Int,
    onClick: () -> Unit
  ): Button {
    val density = resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()
    return Button(this).apply {
      text = label
      textSize = 17f
      isAllCaps = false
      setTextColor(getColor(R.color.nolate_alarm_text))
      setBackgroundColor(backgroundColor)
      setOnClickListener { onClick() }
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(56)
      ).apply {
        topMargin = dp(12)
      }
    }
  }

  private fun sendAlarmAction(action: String) {
    val alarm = currentAlarm ?: return
    sendBroadcast(
      Intent(this, AlarmActionReceiver::class.java)
        .setAction(action)
        .setData(AlarmPendingIntents.alarmUri(
          AlarmContract.URI_ACTION_AUTHORITY,
          action,
          alarm
        ))
        .putExtra(AlarmContract.EXTRA_ALARM_ID, alarm.alarmId)
        .putExtra(AlarmContract.EXTRA_SCHEDULE_ID, alarm.scheduleId)
        .putExtra(AlarmContract.EXTRA_GENERATION, alarm.generation)
        .putExtra(AlarmContract.EXTRA_TRIGGER_AT, alarm.effectiveTriggerAtMillis)
    )
  }

  private fun handleDepart(alarm: StoredAlarm) {
    // The journal commit is the acknowledgement boundary. If storage is unavailable, keep the
    // alarm visible/ringing so the user can retry and the action is never silently lost.
    if (!DepartureAlarmActionJournal(this).record(alarm, System.currentTimeMillis())) {
      Toast.makeText(this, R.string.nolate_alarm_action_retry, Toast.LENGTH_LONG).show()
      setContentView(createContent(alarm))
      return
    }
    runCatching {
      DepartureAlarmCoordinator(this).dismiss(alarm.alarmId, alarm.generation)
    }
    // Foreground/cold-launch authenticated JS so the durable action drains promptly. No schedule
    // id or navigation event is attached, therefore this can never force route-detail UI.
    launchMainApp()
    finish()
  }

  private fun handleOpenRoute(alarm: StoredAlarm) {
    // Opening route details is a separate durable intent and must never enqueue a depart action.
    if (!DepartureAlarmNavigationJournal(this).record(alarm, System.currentTimeMillis())) {
      Toast.makeText(this, R.string.nolate_alarm_navigation_retry, Toast.LENGTH_LONG).show()
      setContentView(createContent(alarm))
      return
    }
    runCatching {
      DepartureAlarmCoordinator(this).dismiss(alarm.alarmId, alarm.generation)
    }
    launchMainApp()
    finish()
  }

  private fun launchMainApp() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launchIntent
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(AlarmContract.EXTRA_LAUNCHED_FROM_ALARM, true)
    runCatching { startActivity(launchIntent) }
  }
}
