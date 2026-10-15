import copy
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('native_state', Path(__file__).with_name('verify-eta-native-state.py'))
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


def evidence():
    worker = {'processed': 1, 'retryCount': 0, 'workerFailure': None,
              'savedScheduleInput': {'memberId': 296, 'scheduleId': 363},
              'savedScheduleAfterEvaluation': {'memberId': 296, 'scheduleId': 363},
              'alarmStates': [{'member_id': 296, 'schedule_id': 363, 'operation': 'UPSERT',
                               'generation': 3, 'trigger_at': '2026-10-06T11:30:00Z',
                               'alarm_occurrences_json': json.dumps([{'occurrenceId': 'M0', 'triggerAt': '2026-10-06T11:30:00Z'}])}]}
    alarm = {'generation': 3, 'nativeAlarmId': native.NATIVE_ID, 'occurrenceId': 'M0',
             'triggerAt': '2026-10-06T11:30:00Z'}
    request = {'generation': 3, 'nativeAlarmId': native.NATIVE_ID, 'occurrenceId': 'M0',
               'identifier': native.request_id(), 'trigger': {'type': 'calendar', 'repeats': False,
               'dateComponents': {'year': 2026, 'month': 10, 'day': 6, 'hour': 11,
                                  'minute': 30, 'second': 0, 'timeZone': 'GMT'}}}
    record = {'classification': 'REAL_NATIVE_SIMULATOR_H2_SNAPSHOT',
              'sync': {'fetched': True, 'failedCount': 0}, 'capabilities': {'notificationAuthorized': True},
              'alarms': [alarm], 'osPending': [request], 'observedAt': '2026-10-06T11:20:00Z'}
    return worker, record


class NativePendingEvidenceTest(unittest.TestCase):
    def test_automatic_real_chain_rejects_diagnostic_resynchronization(self):
        worker, record = evidence()
        worker.update(automaticScheduling=True, providersMocked=False)
        with self.assertRaises(AssertionError):
            native.verify_record(worker, record)
        record['sync'] = {'fetched': False, 'inspectionOnly': True, 'failedCount': 0}
        native.verify_record(worker, record)
        record['sync']['fetched'] = True
        with self.assertRaises(AssertionError):
            native.verify_record(worker, record)

    def test_actual_os_date_and_generation_match(self):
        native.verify_record(*evidence())

    def test_planned_preparation_alarm_is_not_a_duplicate(self):
        worker, record = evidence()
        plan = json.loads(worker['alarmStates'][0]['alarm_occurrences_json'])
        plan.append({'occurrenceId': 'M5', 'triggerAt': '2026-10-06T11:25:00Z'})
        worker['alarmStates'][0]['alarm_occurrences_json'] = json.dumps(plan)
        alarm = copy.deepcopy(record['alarms'][0])
        alarm.update(nativeAlarmId='schedule:363:member:296:occurrence:M5', occurrenceId='M5', triggerAt='2026-10-06T11:25:00Z')
        record['alarms'].append(alarm)
        request = copy.deepcopy(record['osPending'][0])
        request.update(nativeAlarmId=alarm['nativeAlarmId'], occurrenceId='M5', identifier=native.request_id(alarm['nativeAlarmId']))
        request['trigger']['dateComponents']['minute'] = 25
        record['osPending'].append(request)
        native.verify_record(worker, record)

    def test_empty_native_store_is_not_os_cancellation(self):
        worker, record = evidence()
        worker['alarmStates'][0].update(operation='CANCEL', trigger_at=None)
        record['alarms'] = []
        with self.assertRaises(AssertionError):
            native.verify_record(worker, record)
        record['osPending'] = []
        native.verify_record(worker, record)

    def test_duplicates_old_generation_wrong_clock_and_repeating_request_fail(self):
        for mutation in ('duplicate', 'generation', 'clock', 'repeat', 'identity'):
            worker, record = evidence()
            request = record['osPending'][0]
            if mutation == 'duplicate':
                record['osPending'].append(copy.deepcopy(request))
            elif mutation == 'generation':
                request['generation'] -= 1
            elif mutation == 'clock':
                request['trigger']['dateComponents']['minute'] += 1
            elif mutation == 'repeat':
                request['trigger']['repeats'] = True
            else:
                request['identifier'] = 'nolate.departure.other'
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                native.verify_record(worker, record)

    def test_already_fired_alarm_is_not_pending_proof(self):
        worker, record = evidence()
        record['observedAt'] = '2026-10-06T11:30:01Z'
        with self.assertRaises(AssertionError):
            native.verify_record(worker, record)


if __name__ == '__main__':
    unittest.main()
