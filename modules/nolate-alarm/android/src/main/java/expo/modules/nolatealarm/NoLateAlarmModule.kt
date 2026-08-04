package expo.modules.nolatealarm

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

internal class UpsertAlarmCommand : Record {
  @Field
  var operation: String = "UPSERT"

  @Field
  var alarmId: String = ""

  @Field
  var logicalAlarmId: String = ""

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1.0

  @Field
  var recipientMemberId: Double = -1.0

  @Field
  var logicalEventKey: String? = null

  @Field
  var triggerAt: String = ""

  @Field
  var title: String? = null

  @Field
  var body: String? = null

  @Field
  var occurrenceId: String? = null

  @Field
  var decision: String? = null

  @Field
  var minutesBeforeDeparture: Int? = null

  @Field
  var actionEventKey: String? = null

  @Field
  var snoozeMinutes: Int? = null
}

internal class CancelAlarmCommand : Record {
  @Field
  var alarmId: String = ""

  @Field
  var logicalAlarmId: String? = null

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1.0
}

internal class DepartureActionEventCommand : Record {
  @Field
  var eventId: String = ""

  @Field
  var alarmId: String = ""

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1.0

  @Field
  var recipientMemberId: Double = -1.0

  @Field
  var occurrenceId: String? = null

  @Field
  var actionEventKey: String = ""

  @Field
  var occurredAt: String = ""

  @Field
  var requiresRouteNavigation: Boolean = false

  @Field
  var routeNavigationDelivered: Boolean = false
}

class NoLateAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NoLateAlarm")

    AsyncFunction("getCapabilities") {
      val context = requireContext()
      AlarmNotificationFactory.ensureChannel(context)
      AlarmCapabilityReader.read(context).toBridgeMap()
    }

    AsyncFunction("upsertAlarm") { command: UpsertAlarmCommand ->
      mutationOrInvalid {
        require(command.operation == "UPSERT") { "operation must be UPSERT." }
        val context = requireContext()
        val triggerAtMillis = parseIsoTriggerAtMillis(command.triggerAt)
        require(triggerAtMillis in 0..MAX_SAFE_JS_INTEGER) {
          "triggerAt is outside the supported timestamp range."
        }
        DepartureAlarmCoordinator(context).upsert(
          alarmId = requireAlarmId(command.alarmId),
          logicalAlarmId = requireAlarmId(
            command.logicalAlarmId.ifBlank { command.alarmId }
          ),
          scheduleId = requireScheduleId(command.scheduleId),
          title = normalizeAlarmTitle(command.title),
          body = normalizeAlarmBody(command.body),
          occurrenceId = normalizeOccurrenceId(command.occurrenceId),
          decision = command.decision?.trim()?.takeIf { it.isNotEmpty() }?.also {
            require(it == "ADVANCE_NOTICE" || it == "DEPART_NOW") {
              "decision must be ADVANCE_NOTICE or DEPART_NOW."
            }
          },
          minutesBeforeDeparture = command.minutesBeforeDeparture?.also {
            require(it in setOf(0, 5, 10, 15)) {
              "minutesBeforeDeparture must be 0, 5, 10, or 15."
            }
          },
          actionEventKey = normalizeActionEventKey(command.actionEventKey),
          generation = requireSafeJsInteger(command.generation, "generation"),
          recipientMemberId = requireRecipientMemberId(command.recipientMemberId),
          logicalEventKey = normalizeLogicalEventKey(command.logicalEventKey),
          triggerAtMillis = triggerAtMillis,
          snoozeMinutes = (command.snoozeMinutes ?: 5).also {
            require(it in 1..60) { "snoozeMinutes must be between 1 and 60." }
          }
        )
      }
    }

    AsyncFunction("cancelAlarm") { command: CancelAlarmCommand ->
      mutationOrInvalid {
        val context = requireContext()
        val alarmId = requireAlarmId(command.alarmId)
        val scheduleId = requireScheduleId(command.scheduleId)
        val coordinator = DepartureAlarmCoordinator(context)
        val current = coordinator.getScheduledAlarm(alarmId)
        require(current == null || current.scheduleId == scheduleId) {
          "scheduleId does not match the stored alarm."
        }
        val logicalAlarmId = command.logicalAlarmId?.let(::requireAlarmId)
        require(current == null || logicalAlarmId == null || current.logicalAlarmId == logicalAlarmId) {
          "logicalAlarmId does not match the stored alarm."
        }
        coordinator.cancel(
          alarmId = alarmId,
          generation = requireSafeJsInteger(command.generation, "generation")
        )
      }
    }

    AsyncFunction("getScheduledAlarms") {
      DepartureAlarmCoordinator(requireContext()).getScheduledAlarms()
    }

    AsyncFunction("openExactAlarmSettings") {
      AlarmCapabilityReader.openExactAlarmSettings(requireContext())
    }

    AsyncFunction("openFullScreenSettings") {
      AlarmCapabilityReader.openFullScreenSettings(requireContext())
    }

    AsyncFunction("scheduleTestAlarm") { delaySeconds: Int ->
      mutationOrInvalid {
        require(delaySeconds in 3..60) {
          "delaySeconds must be between 3 and 60."
        }
        DepartureAlarmCoordinator(requireContext()).scheduleTestAlarm(delaySeconds)
      }
    }

    AsyncFunction("stopRinging") {
      val context = requireContext()
      val coordinator = DepartureAlarmCoordinator(context)
      val dismissed = coordinator.dismissAllFiring()
      val stopped = context.stopService(
        Intent(context, DepartureAlarmService::class.java)
      )
      dismissed || stopped
    }

    AsyncFunction("clearAllAlarms") {
      DepartureAlarmCoordinator(requireContext()).clearAll()
    }

    AsyncFunction("getPendingAlarmFireEvents") {
      DepartureAlarmFireJournal(requireContext()).getAll().map { it.toBridgeMap() }
    }

    AsyncFunction("removeAlarmFireEvent") { eventId: String ->
      DepartureAlarmFireJournal(requireContext()).remove(eventId)
    }

    AsyncFunction("recordDepartureActionEvent") { command: DepartureActionEventCommand ->
      runCatching {
        val occurredAtMillis = parseIsoTriggerAtMillis(command.occurredAt)
        require(occurredAtMillis in 0..MAX_SAFE_JS_INTEGER) {
          "occurredAt is outside the supported timestamp range."
        }
        val eventId = command.eventId.trim().also {
          require(it.isNotEmpty() && it.length <= 200) { "eventId is invalid." }
        }
        val actionEventKey = command.actionEventKey.trim().also {
          require(isValidActionEventKey(it)) { "actionEventKey has an invalid format." }
        }
        DepartureAlarmActionJournal(requireContext()).record(
          StoredDepartureActionEvent(
            eventId = eventId,
            alarmId = requireAlarmId(command.alarmId),
            scheduleId = requireScheduleId(command.scheduleId),
            generation = requireSafeJsInteger(command.generation, "generation"),
            recipientMemberId = requireRecipientMemberId(command.recipientMemberId),
            occurrenceId = normalizeOccurrenceId(command.occurrenceId),
            actionEventKey = actionEventKey,
            occurredAtMillis = occurredAtMillis,
            requiresRouteNavigation = command.requiresRouteNavigation,
            routeNavigationDelivered = command.routeNavigationDelivered
          )
        )
      }.getOrDefault(false)
    }

    AsyncFunction("getPendingDepartureActionEvents") {
      DepartureAlarmActionJournal(requireContext()).getAll().map { it.toBridgeMap() }
    }

    AsyncFunction("markDepartureActionNavigationDelivered") { eventId: String ->
      DepartureAlarmActionJournal(requireContext()).markNavigationDelivered(eventId)
    }

    AsyncFunction("removeDepartureActionEvent") { eventId: String ->
      DepartureAlarmActionJournal(requireContext()).remove(eventId)
    }

    AsyncFunction("getPendingAlarmNavigationEvents") {
      DepartureAlarmNavigationJournal(requireContext()).getAll().map { it.toBridgeMap() }
    }

    AsyncFunction("removeAlarmNavigationEvent") { eventId: String ->
      DepartureAlarmNavigationJournal(requireContext()).remove(eventId)
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Android application context is unavailable.")

  private inline fun mutationOrInvalid(
    block: () -> AlarmMutationResult
  ): Map<String, Any?> = try {
    block().toBridgeMap()
  } catch (error: IllegalArgumentException) {
    AlarmMutationResult(
      applied = false,
      scheduled = false,
      reason = "INVALID_COMMAND:${error.message ?: "unknown"}"
    ).toBridgeMap()
  } catch (error: IllegalStateException) {
    AlarmMutationResult(
      applied = false,
      scheduled = false,
      reason = "NATIVE_STATE_ERROR:${error.message ?: "unknown"}"
    ).toBridgeMap()
  }
}
