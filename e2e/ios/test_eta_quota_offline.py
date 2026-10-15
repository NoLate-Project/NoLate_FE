"""Verifier regressions only; actual Worker/UI results come from the offline runner."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('quota_offline', Path(__file__).with_name('run-eta-quota-offline.py'))
quota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quota)


class OfflineQuotaVerifierTest(unittest.TestCase):
    def test_native_cleanup_retry_replays_committed_cancel_without_running_worker_again(self):
        value = self.cleanup_sample()
        evaluate = Mock()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'quota-cleanup.json').write_text(json.dumps(value))
            self.assertEqual(quota.failure_cleanup_snapshot(root, True, evaluate), value)
            self.assertEqual(json.loads((root / 'case-999.json').read_text()), value)
        evaluate.assert_not_called()

    def test_cleanup_retry_rejects_an_uncommitted_or_invalid_cancel_snapshot(self):
        value = self.cleanup_sample()
        value['jobStatus'] = 'ACTIVE'
        evaluate = Mock()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'quota-cleanup.json').write_text(json.dumps(value))
            with self.assertRaises(AssertionError):
                quota.failure_cleanup_snapshot(root, True, evaluate)
            self.assertFalse((root / 'case-999.json').exists())
        evaluate.assert_not_called()

    def test_no_backend_cleanup_yet_runs_the_scoped_worker_transition(self):
        evaluate = Mock(return_value=self.cleanup_sample())
        self.assertEqual(quota.failure_cleanup_snapshot(Path('unused'), False, evaluate), self.cleanup_sample())
        evaluate.assert_called_once_with('quota-cleanup', 999)

    def cleanup_sample(self):
        return {'classification': 'SCOPED_H2_NOTIFICATION_DISABLED_CLEANUP', 'database': 'H2_MEMORY_ONLY',
                'providersMocked': True, 'etaEvaluated': False, 'historyCount': 7, 'historyBefore': 7,
                'processed': 1, 'jobStatus': 'CANCELED', 'retryCount': 0, 'workerFailure': None,
                'savedScheduleInput': {'scheduleId': 363}, 'savedScheduleAfterEvaluation': {'scheduleId': 363},
                'alarmStates': [{'member_id': 296, 'schedule_id': 363, 'operation': 'CANCEL', 'trigger_at': None}]}

    def test_cache_reuse_must_follow_persisted_due_history_and_alarm_before_fault(self):
        value, baseline, previous, public = self.sample()
        previous.update(source='SELECTED_ROUTE', stale=True, failureCode='PROVIDER_ERROR')
        cached = copy.deepcopy(value)
        cached.update(injectedFaults=[], nextCheckAt='2026-10-08T06:02:00Z')
        value.update(cacheEvaluations=[cached], historyCount=3, evaluatedAt=cached['nextCheckAt'],
                     nextCheckAt='2026-10-08T06:03:00Z')
        value['evaluationHistory']['evaluatedAt'] = value['evaluatedAt']
        self.assertEqual(quota.verify_case(value, baseline, previous, public)['validCacheChecks'], 1)
        value['cacheEvaluations'][0]['injectedFaults'] = ['arrival:TIMEOUT']
        with self.assertRaises(AssertionError):
            quota.verify_case(value, baseline, previous, public)

    def test_quality_suite_is_bounded_and_keeps_diagnostic_stages_distinct(self):
        self.assertEqual(len(quota.suite_commands(True)), 7)
        self.assertEqual(quota.suite_commands(True)[-1], 'quota-recovered')
        self.assertEqual(len(set(quota.QUALITY_CODES.values())), 6)
        for scenario, code in quota.QUALITY_CODES.items():
            if not scenario.startswith('quality-'):
                continue
            value, baseline, previous, public = self.sample()
            value.update(scenario=scenario, injectedFaults=[quota.QUALITY_FAULTS[scenario]], failureCode=code)
            value['evaluationHistory']['failureCode'] = code
            public.update(failureReason=code + ': safe', predictedArrivalAt=None, effectiveTransitRoute=None)
            if scenario == 'quality-unobserved':
                preview = {'segments': [{'kind': 'SUBWAY', 'rideTiming': {'basis': 'TIMETABLE'}}]}
                value['effectiveSnapshot'] = {'accepted': False, 'transitTimingBasis': 'TIMETABLE_ONLY',
                                               'effectiveTransitRoute': preview}
                public['futureTimetablePrediction'] = copy.deepcopy(preview)
            self.assertEqual(quota.verify_case(value, baseline, previous, public)['result'], 'PASSED')
            bad = copy.deepcopy(value)
            bad['failureCode'] = 'TRANSIT_ARRIVAL_UNAVAILABLE'
            with self.assertRaises(AssertionError):
                quota.verify_case(bad, baseline, previous, public)
            public['effectiveTransitRoute'] = {'accepted': True}
            with self.assertRaises(AssertionError):
                quota.verify_case(value, baseline, previous, public)

    def test_cleanup_must_really_cancel_without_an_eta_evaluation(self):
        value = {'classification': 'SCOPED_H2_NOTIFICATION_DISABLED_CLEANUP', 'database': 'H2_MEMORY_ONLY',
                 'providersMocked': True, 'etaEvaluated': False, 'historyCount': 7, 'historyBefore': 7,
                 'processed': 1, 'jobStatus': 'CANCELED', 'retryCount': 0, 'workerFailure': None,
                 'savedScheduleInput': {'scheduleId': 363}, 'savedScheduleAfterEvaluation': {'scheduleId': 363},
                 'alarmStates': [{'member_id': 296, 'schedule_id': 363, 'operation': 'CANCEL', 'trigger_at': None}]}
        quota.verify_cleanup(value)
        for key, changed in [('etaEvaluated', True), ('historyCount', 8), ('jobStatus', 'ACTIVE')]:
            with self.subTest(key=key):
                bad = copy.deepcopy(value)
                bad[key] = changed
                with self.assertRaises(AssertionError):
                    quota.verify_cleanup(bad)
        value['alarmStates'][0]['operation'] = 'UPSERT'
        with self.assertRaises(AssertionError):
            quota.verify_cleanup(value)

    def test_ui_summary_rejects_zero_tests_skips_or_another_device(self):
        summary = {'result': 'Passed', 'passedTests': 1, 'totalTestCount': 1, 'failedTests': 0,
                   'skippedTests': 0, 'devicesAndConfigurations': [{'device': {'deviceId': quota.DEVICE}}]}
        quota.verify_ui_summary(summary)
        for key, value in [('passedTests', 0), ('skippedTests', 1), ('devicesAndConfigurations', []),
                           ('devicesAndConfigurations', [{'device': {'deviceId': 'another-device'}}])]:
            with self.subTest(key=key):
                changed = copy.deepcopy(summary)
                changed[key] = value
                with self.assertRaises(AssertionError):
                    quota.verify_ui_summary(changed)

    def sample(self):
        departure = '2026-10-08T06:10:00Z'
        baseline = {'savedScheduleInput': {'scheduleId': 363, 'memberId': 296},
                    'recommendedDepartureAt': departure,
                    'alarmStates': [{'trigger_at': departure}]}
        previous = {'historyCount': 1, 'nextCheckAt': '2026-10-08T06:01:00Z',
                    'alarmStates': [{'member_id': 296, 'schedule_id': 363, 'operation': 'UPSERT', 'trigger_at': departure}]}
        value = {'classification': 'SYNTHETIC_PROVIDER_WORKER', 'database': 'H2_MEMORY_ONLY',
                 'providersMocked': True, 'productionDatabaseModified': False, 'physicalTransitHttpCalls': 0,
                 'processed': 1, 'jobStatus': 'ACTIVE', 'historyCount': 2,
                 'savedScheduleInput': copy.deepcopy(baseline['savedScheduleInput']),
                 'savedScheduleAfterEvaluation': copy.deepcopy(baseline['savedScheduleInput']),
                 'evaluatedAt': previous['nextCheckAt'], 'nextCheckAt': '2026-10-08T06:02:00Z',
                 'recommendedDepartureAt': departure, 'source': 'SELECTED_ROUTE', 'stale': True,
                 'scenario': 'quota-route', 'injectedFaults': ['route:HTTP_429'], 'failureCode': 'PROVIDER_ERROR',
                 'alarmStates': [{'member_id': 296, 'schedule_id': 363, 'operation': 'UPSERT', 'trigger_at': departure}],
                 'alarmBeforeEvaluation': copy.deepcopy(previous['alarmStates']),
                 'evaluationHistory': {'memberId': 296, 'scheduleId': 363, 'source': 'SELECTED_ROUTE',
                    'stale': True, 'failureCode': 'PROVIDER_ERROR', 'evaluatedAt': previous['nextCheckAt']}}
        public = {'scheduleId': 363, 'source': 'SELECTED_ROUTE', 'stale': True,
                  'recommendedDepartureAt': departure, 'failureReason': 'PROVIDER_ERROR: safe message'}
        return value, baseline, previous, public

    def test_fault_and_protected_alarm(self):
        self.assertEqual(quota.verify_case(*self.sample())['result'], 'PASSED')

    def accepted_sample(self):
        value, baseline, previous, public = self.sample()
        value.update(scenario='quota-recovered', source='LIVE_PROVIDER', stale=False, failureCode=None,
                     injectedFaults=[], effectiveSnapshot={'accepted': True}, epoch='2026-10-08T06:10:00Z',
                     predictedArrivalAt='2026-10-08T06:50:52Z')
        value['evaluationHistory'].update(source='LIVE_PROVIDER', stale=False, failureCode=None)
        public.update(source='LIVE_PROVIDER', stale=False, failureReason=None)
        route = {'segments': []}
        epoch = quota.instant(value['epoch'])
        for index in range(5):
            segment = {'kind': 'WALK', 'rideTiming': None}
            if index in (1, 3):
                first = index == 1
                clock = lambda seconds: (epoch + quota.dt.timedelta(seconds=seconds)).isoformat()
                segment.update(kind='SUBWAY', rideTiming={
                    'timetable': {'provider': 'fixture-timetable', 'trainNumber': '4012' if first else '2012',
                        'line': 'LINE_4' if first else 'LINE_2', 'directionCode': 'DOWN', 'serviceClass': 'LOCAL',
                        'fromStationCode': 'N' if first else 'S4', 'toStationCode': 'S4' if first else 'S2',
                        'fetchedAt': value['evaluatedAt'], 'boardingAt': clock(197 if first else 1800),
                        'arrivalAt': clock(1397 if first else 2281)},
                    'predictedBoardingAt': clock(210 if first else 1800),
                    'predictedArrivalAt': clock(1410 if first else 2281),
                    'basis': 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE' if first else 'TIMETABLE'})
            route['segments'].append(segment)
        value['effectiveSnapshot']['effectiveTransitRoute'] = route
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        return value, baseline, previous, public

    def test_second_search_timeout_retains_only_a_verified_same_evaluation_journey(self):
        self.assertEqual(quota.suite_commands(optimization=True), ['optimization-timeout', 'quota-recovered'])
        value, baseline, previous, public = self.accepted_sample()
        value.update(scenario='optimization-timeout', injectedFaults=['route:OPTIMIZATION_TIMEOUT'],
                     routeRequests=[{'searchDttm': '202610081510'}, {'searchDttm': '202610081519'}])
        self.assertEqual(quota.verify_case(value, baseline, previous, public)['result'], 'PASSED')
        for key, changed in [('injectedFaults', []), ('routeRequests', value['routeRequests'][:1]),
                             ('routeRequests', value['routeRequests'] * 2), ('stale', True),
                             ('effectiveSnapshot', {'accepted': False})]:
            with self.subTest(key=key):
                bad = copy.deepcopy(value)
                bad[key] = changed
                with self.assertRaises(AssertionError):
                    quota.verify_case(bad, baseline, previous, public)

    def test_recovery_requires_independent_timetable_calculation(self):
        value, baseline, previous, public = self.accepted_sample()
        route = value['effectiveSnapshot']['effectiveTransitRoute']
        self.assertEqual(quota.verify_case(value, baseline, previous, public)['result'], 'PASSED')
        for index, key, changed in ((1, 'predictedArrivalAt', '2026-10-08T06:33:43Z'),
                                    (3, 'basis', 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE')):
            bad_value, bad_public = copy.deepcopy(value), copy.deepcopy(public)
            bad_value['effectiveSnapshot']['effectiveTransitRoute']['segments'][index]['rideTiming'][key] = changed
            bad_public['effectiveTransitRoute'] = copy.deepcopy(bad_value['effectiveSnapshot']['effectiveTransitRoute'])
            with self.assertRaises(AssertionError):
                quota.verify_case(bad_value, baseline, previous, bad_public)
        public['effectiveTransitRoute']['segments'][1]['rideTiming']['timetable']['trainNumber'] = '4999'
        with self.assertRaises(AssertionError):
            quota.verify_case(value, baseline, previous, public)
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        value['predictedArrivalAt'] = '2026-10-08T06:50:53Z'
        with self.assertRaises(AssertionError):
            quota.verify_case(value, baseline, previous, public)

    def test_real_calls_missing_fault_accepted_fallback_and_wrong_due_time_are_rejected(self):
        mutations = [('physicalTransitHttpCalls', 1), ('providersMocked', False), ('database', 'MYSQL'),
                     ('injectedFaults', []), ('effectiveSnapshot', {'accepted': True}), ('stale', False),
                     ('evaluatedAt', '2026-10-08T06:00:59Z'), ('historyCount', 1)]
        for key, changed in mutations:
            with self.subTest(key=key):
                value, baseline, previous, public = self.sample()
                value[key] = changed
                with self.assertRaises(AssertionError):
                    quota.verify_case(value, baseline, previous, public)

    def test_input_mutation_alarm_cancellation_or_later_alarm_are_rejected(self):
        for mutation in ('input', 'cancel', 'later'):
            with self.subTest(mutation=mutation):
                value, baseline, previous, public = self.sample()
                if mutation == 'input':
                    value['savedScheduleAfterEvaluation']['memberId'] = 1
                elif mutation == 'cancel':
                    value['alarmStates'][0]['operation'] = 'CANCEL'
                else:
                    value['alarmStates'][0]['trigger_at'] = '2026-10-08T06:11:00Z'
                with self.assertRaises(AssertionError):
                    quota.verify_case(value, baseline, previous, public)

    def test_public_api_or_history_mismatch_is_rejected(self):
        value, baseline, previous, public = self.sample()
        public['stale'] = False
        with self.assertRaises(AssertionError):
            quota.verify_case(value, baseline, previous, public)
        value, baseline, previous, public = self.sample()
        value['evaluationHistory']['failureCode'] = None
        with self.assertRaises(AssertionError):
            quota.verify_case(value, baseline, previous, public)


if __name__ == '__main__':
    unittest.main()
