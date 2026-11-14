import importlib.util
import datetime as dt
import json
from pathlib import Path
import unittest
from test_eta_native_state import evidence

SPEC = importlib.util.spec_from_file_location('native_delivery', Path(__file__).with_name('run-eta-native-delivery.py'))
delivery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(delivery)


def logs(record, mode='foreground', seconds='01'):
    return ('ETA_NATIVE_SCHEDULED_EVIDENCE: ' + json.dumps(record) + '\n'
            'ETA_NATIVE_OS_DELIVERED: ' + mode + ': scheduled=2026-10-06T11:30:00Z '
            'observed=2026-10-06T11:30:' + seconds + 'Z\nETA_NATIVE_AUDIBLE_SOUND_NOT_MEASURED\n')


class NativeDeliveryEvidenceTest(unittest.TestCase):
    def test_native_sampling_resolves_only_the_exact_app_in_pinned_launchctl_output(self):
        own = 'UIKitApplication:com.anonymous.nolatefe[4315][rb-legacy]'
        other = 'UIKitApplication:com.anonymous.nolatefe.ShareExtension[4315][rb-legacy]'
        self.assertEqual(delivery.pinned_launchctl_application_pid('9 0 ' + other + '\n123 0 ' + own), 123)
        for listing in ('9 0 ' + other, '123 0 ' + own + '.debug.dylib', '0 0 ' + own,
                        '1 0 ' + own, '- 0 ' + own, 'PID Status Label', ''):
            with self.subTest(listing=listing):
                self.assertIsNone(delivery.pinned_launchctl_application_pid(listing))

    def test_native_sampling_refuses_ambiguous_app_processes(self):
        label = 'UIKitApplication:com.anonymous.nolatefe[4315][rb-legacy]'
        with self.assertRaises(RuntimeError):
            delivery.pinned_launchctl_application_pid('123 0 ' + label + '\n124 0 ' + label)

    def test_sampling_clock_uses_actual_observation_not_buffered_log_read_time(self):
        observed = dt.datetime(2026, 11, 4, 0, 0, tzinfo=dt.timezone.utc)
        text = ('ETA_NATIVE_OS_DELIVERED: terminated: scheduled=2026-11-04T00:00:00Z '
                'observed=2026-11-04T00:00:00Z\n')
        for age, expected in ((-1, 'INVALID'), (0, 'WAIT'), (5, 'WAIT'),
                              (6, 'READY'), (15, 'READY'), (16, 'EXPIRED'), (80, 'EXPIRED')):
            with self.subTest(age=age):
                self.assertEqual(delivery.cold_start_sampling_window(
                    text, observed + dt.timedelta(seconds=age)), expected)
        self.assertEqual(delivery.cold_start_sampling_window('', observed), 'WAIT')
        self.assertEqual(delivery.cold_start_sampling_window(text.replace('00:00:00Z\n', 'invalid\n'), observed), 'INVALID')
        self.assertEqual(delivery.cold_start_sampling_window(text.replace('observed=2026-11-04T00:00:00Z',
            'observed=2026-11-04T00:00:00'), observed), 'INVALID')

    def test_first_measured_alarm_is_created_after_actual_login_finishes(self):
        summary = {'result': 'Passed', 'passedTests': 1, 'totalTestCount': 1,
                   'failedTests': 0, 'skippedTests': 0,
                   'devicesAndConfigurations': [{'device': {'deviceId': delivery.DEVICE}}],
                   'finishTime': dt.datetime(2026, 11, 4, 0, 0, tzinfo=dt.timezone.utc).timestamp()}
        worker = {'evaluatedAt': '2026-11-04T00:00:01Z',
                  'alarmStates': [{'trigger_at': '2026-11-04T00:05:00Z'}]}
        self.assertEqual(delivery.verify_initial_arming(worker, summary)['result'], 'PASSED')
        for evaluated, scheduled in (('2026-11-03T23:59:59Z', '2026-11-04T00:05:00Z'),
                                     ('2026-11-04T00:00:01Z', '2026-11-04T00:00:00Z')):
            invalid = dict(worker, evaluatedAt=evaluated, alarmStates=[{'trigger_at': scheduled}])
            with self.subTest(evaluated=evaluated), self.assertRaises(AssertionError):
                delivery.verify_initial_arming(invalid, summary)
        summary['skippedTests'] = 1
        with self.assertRaises(AssertionError):
            delivery.verify_initial_arming(worker, summary)

    def test_actual_pending_and_delivery_marker_are_both_required(self):
        worker, record = evidence()
        result = delivery.verify_delivery(worker, logs(record), 'foreground')
        self.assertEqual(result['deliveryDelaySeconds'], 1)
        self.assertFalse(result['audibleSoundMeasured'])

    def test_wrong_mode_and_late_delivery_are_not_accepted(self):
        worker, record = evidence()
        for text in (logs(record, 'background'), logs(record, seconds='26')):
            with self.assertRaises(AssertionError):
                delivery.verify_delivery(worker, text, 'foreground')

    def test_delivery_window_is_inclusive_and_never_accepts_early_observation(self):
        worker, record = evidence()
        for seconds in ('00', '25'):
            with self.subTest(boundary=seconds):
                result = delivery.verify_delivery(worker, logs(record, seconds=seconds), 'foreground')
                self.assertEqual(result['deliveryDelaySeconds'], int(seconds))
        early = logs(record).replace('observed=2026-10-06T11:30:01Z',
                                     'observed=2026-10-06T11:29:59Z')
        with self.assertRaises(AssertionError):
            delivery.verify_delivery(worker, early, 'foreground')

    def test_missing_or_wrong_os_pending_is_not_delivery_proof(self):
        worker, record = evidence()
        record['osPending'] = []
        with self.assertRaises(AssertionError):
            delivery.verify_delivery(worker, logs(record), 'foreground')

    def test_delivery_marker_must_match_worker_clock(self):
        worker, record = evidence()
        text = logs(record).replace('11:30:00Z observed=2026-10-06T11:30:01Z',
                                    '11:31:00Z observed=2026-10-06T11:31:01Z')
        with self.assertRaises(AssertionError):
            delivery.verify_delivery(worker, text, 'foreground')

    def test_lock_needs_observed_real_lock_condition(self):
        worker, record = evidence()
        text = logs(record, 'locked')
        with self.assertRaises(AssertionError):
            delivery.verify_delivery(worker, text, 'locked')
        delivery.verify_delivery(worker, text + 'ETA_NATIVE_LOCK_READY\nETA_NATIVE_LOCK_OBSERVED\n', 'locked')


if __name__ == '__main__':
    unittest.main()
