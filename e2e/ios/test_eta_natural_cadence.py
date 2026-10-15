import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('natural', Path(__file__).with_name('verify-eta-natural-cadence.py'))
natural = importlib.util.module_from_spec(spec)
spec.loader.exec_module(natural)


class NaturalCadenceTest(unittest.TestCase):
    def setUp(self):
        saved = {'targetArrivalAt': '2026-10-05T14:30:00Z', 'originLng': 127.061, 'originLat': 37.6551,
                 'destinationLng': 126.9297, 'destinationLat': 37.4842}
        before = {'next_check_at': '2026-10-05T13:10:00Z', 'check_count': 3, 'status': 'ACTIVE',
                  'last_recommended_departure_at': '2026-10-05T13:45:00Z'}
        after = before | {'check_count': 4, 'retry_count': 0, 'next_check_at': '2026-10-05T13:15:00Z',
                          'last_eta_source': 'LIVE_PROVIDER', 'last_eta_stale': False,
                          'last_eta_failure_reason': None, 'last_predicted_arrival_at': '2026-10-05T14:25:52Z'}
        self.row = {'command': 'natural-next', 'clockMode': 'TEST_CLOCK_NO_WALL_TIME_WAIT',
                    'before': before, 'after': after, 'now': '2026-10-05T13:10:00Z',
                    'savedScheduleInput': saved, 'savedScheduleAfterEvaluation': copy.deepcopy(saved),
                    'successfulUiCreateCount': 1, 'processed': 1, 'historyBefore': 3, 'historyAfter': 4,
                    'latestTargetArrivalAt': saved['targetArrivalAt'], 'epoch': '2026-10-05T13:45:00Z',
                    'routeRequests': [{'startX': 127.061, 'startY': 37.6551, 'endX': 126.9297,
                                      'endY': 37.4842, 'searchDttm': '202610052245'}]}

    def test_fourth_evaluation_is_allowed(self):
        self.assertEqual(300, natural.verify_round(self.row))

    def test_wrong_next_due_time_is_rejected(self):
        self.row['after']['next_check_at'] = '2026-10-05T13:20:00Z'
        with self.assertRaises(AssertionError):
            natural.verify_round(self.row)

    def test_missing_history_is_rejected(self):
        self.row['historyAfter'] = 3
        with self.assertRaises(AssertionError):
            natural.verify_round(self.row)

    def test_sql_forced_due_time_is_not_natural_progress(self):
        self.row['before']['next_check_at'] = '2026-10-05T13:09:00Z'
        with self.assertRaises(AssertionError):
            natural.verify_round(self.row)

    def test_stale_old_generation_cannot_mutate_current_job(self):
        self.row.update(command='natural-persist-stale', processed=0, historyAfter=3,
                        rejection='LEASE_LOST_AFTER_UI_EDIT')
        self.row['after'] = copy.deepcopy(self.row['before'])
        natural.verify_round(self.row)
        self.row['after']['check_count'] += 1
        with self.assertRaises(AssertionError):
            natural.verify_round(self.row)

    def test_not_due_call_must_not_create_history(self):
        self.row.update(command='natural-early', processed=0, historyAfter=3)
        self.row['after'] = copy.deepcopy(self.row['before'])
        natural.verify_round(self.row)
        self.row['historyAfter'] = 4
        with self.assertRaises(AssertionError):
            natural.verify_round(self.row)

    def test_recovery_cannot_claim_stale_feed_as_success(self):
        self.row['after']['last_eta_stale'] = True
        with self.assertRaises(AssertionError):
            natural.verify_round(self.row)


if __name__ == '__main__':
    unittest.main()
