import importlib.util
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
