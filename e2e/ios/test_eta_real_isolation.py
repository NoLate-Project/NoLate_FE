"""Synthetic verifier regressions, never evidence of actual provider/UI accuracy."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
from eta_diagnostic_warning import diagnostic_warning

spec = importlib.util.spec_from_file_location('real_isolation', Path(__file__).with_name('verify-real-isolated-eta.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class RealIsolationVerifierTest(unittest.TestCase):
    def test_route_search_uses_the_same_departure_as_the_future_schedule(self):
        runner_spec = importlib.util.spec_from_file_location('eta_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        requested = '2026-11-19T21:20:00+09:00'
        prepared = {'journeyProvider': 'odsay', 'comparisonRequestedDepartureAt': requested}
        seed = {'provider': 'odsay', 'requestedDepartureAt': '2026-11-19T12:14:00Z',
                'departureAt': '2026-11-19T12:20:00Z'}
        # Even a matching output departure does not validate a different provider request.
        with self.assertRaises(ValueError):
            runner.verify_odsay_departure_input(requested, prepared, seed)
        seed.update(requestedDepartureAt='2026-11-19T12:20:00Z', departureAt='2026-11-19T12:23:00Z')
        self.assertEqual(runner.verify_odsay_departure_input(requested, prepared, seed), seed['requestedDepartureAt'])

    def test_saved_bus_departure_status_rejects_rounded_time_or_unproven_live_data(self):
        runner_spec = importlib.util.spec_from_file_location('bus_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        target = dt.datetime.fromisoformat('2026-11-16T21:48:02Z')
        preview = {'departureAt': '2026-11-16T21:36:59Z', 'arrivalAt': target.isoformat(),
                   'sourceUpdatedAt': '2026-11-16T21:29:54Z'}
        route_info = {'totalDurationMinutes': 12, 'busPreviewObservation': {
            'targetArrivalAt': target.isoformat(), 'sourceUpdatedAt': preview['sourceUpdatedAt'],
        }}
        status = {'scheduleId': 363, 'travelMinutes': 12, 'recommendedDepartureAt': preview['departureAt'],
                  'source': 'SELECTED_ROUTE', 'stale': True, 'liveFetchedAt': None, 'predictedArrivalAt': None}
        self.assertEqual(runner.verify_saved_bus_departure(route_info, status, preview, target)['travelMinutes'], 12)
        for key, value in [('recommendedDepartureAt', '2026-11-16T21:36:02Z'), ('travelMinutes', 15),
                           ('predictedArrivalAt', preview['arrivalAt']), ('source', 'LIVE_PROVIDER')]:
            with self.subTest(field=key), self.assertRaises(AssertionError):
                runner.verify_saved_bus_departure(route_info, {**status, key: value}, preview, target)
        with self.assertRaises(AssertionError):
            runner.verify_saved_bus_departure(route_info, status, preview, target + dt.timedelta(minutes=1))

    def test_walking_rejection_audit_preserves_failure_without_claiming_eta_failed(self):
        value = {'provider': 'odsay-walking', 'httpCalls': 2, 'cacheHits': 5, 'cacheEntries': 1,
                 'unavailableCalls': 1, 'failureCounts': {'ENDPOINT_MISMATCH': 1},
                 'lastFailure': {'reason': 'ENDPOINT_MISMATCH', 'observedAt': '2026-10-13T01:00:00Z',
                                 'httpStatus': None, 'providerCode': None}}
        self.assertEqual(verifier.verify_walking_diagnostics(value)['result'], 'PASSED')
        for mutation in ('count', 'secret', 'reason', 'status', 'code', 'time'):
            changed = copy.deepcopy(value)
            if mutation == 'count': changed['unavailableCalls'] = 0
            elif mutation == 'secret': changed['rawError'] = 'private-key'
            elif mutation == 'reason': changed['lastFailure']['reason'] = 'private-message'
            elif mutation == 'status': changed['lastFailure']['httpStatus'] = '401'
            elif mutation == 'code': changed['lastFailure']['providerCode'] = 'private-key'
            else: changed['lastFailure']['observedAt'] = '2026-10-13T10:00:00'
            with self.subTest(mutation=mutation), self.assertRaises((AssertionError, ValueError)):
                verifier.verify_walking_diagnostics(changed)

    def test_optional_walking_auth_quota_errors_stop_actual_requery_not_path_mismatch(self):
        runner_spec = importlib.util.spec_from_file_location('stop_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        for code in ('HTTP_AUTH', 'HTTP_QUOTA', 'PROVIDER_APPLICATION_ERROR'):
            self.assertTrue(runner.provider_error_requires_stop({'providerWire': [],
                'walkingRefinement': {'failureCounts': {code: 1}}}))
        for code in ('ENDPOINT_MISMATCH', 'NO_PATH', 'TIMEOUT'):
            self.assertFalse(runner.provider_error_requires_stop({'providerWire': [],
                'walkingRefinement': {'failureCounts': {code: 1}}}))
        for outcome in ('error', 'rate_limited', 'application_error', 'local_rate_limited'):
            self.assertTrue(runner.provider_error_requires_stop({'providerWire': [{'outcome': outcome}]}))
        for outcome in ('success', 'empty'):
            self.assertFalse(runner.provider_error_requires_stop({'providerWire': [{'outcome': outcome}]}))

    def test_postdeparture_audit_keeps_recommendation_evidence_separate_from_live_success(self):
        runner_spec = importlib.util.spec_from_file_location('postdeparture_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        records = [{'recommendedDepartureAt': '2026-10-22T05:48:29+09:00', 'automaticAlarmStateCount': 0},
                   {'recommendedDepartureAt': '2026-10-22T05:48:29+09:00', 'automaticAlarmStateCount': 0}]
        partial = runner.postdeparture_audit(records, False)
        self.assertEqual(partial['result'], 'PARTIAL')
        self.assertTrue(partial['departureRecommendationUnchanged'])
        self.assertTrue(partial['automaticAlarmStateAbsent'])
        self.assertFalse(partial['nativeAlarmDeliveryTested'])
        self.assertEqual(runner.postdeparture_audit(records, True)['result'], 'PASSED')
        self.assertEqual(runner.postdeparture_audit(records, True, require_final_alighting=True)['result'], 'PARTIAL')
        direct = [records[0], {**records[1], 'uiResult': 'PROVISIONAL_PASSED',
                               'freshFinalAlighting': {'trainNumber': '2014'}}]
        self.assertEqual(runner.postdeparture_audit(direct, True, require_final_alighting=True)['result'], 'PASSED')
        direct[1]['uiResult'] = 'FALLBACK_PASSED_NOT_LIVE_CORRECTION'
        self.assertEqual(runner.postdeparture_audit(direct, True, require_final_alighting=True)['result'], 'PARTIAL')
        changed = [records[0], {**records[1], 'recommendedDepartureAt': '2026-10-22T05:49:29+09:00'}]
        self.assertEqual(runner.postdeparture_audit(changed, True)['result'], 'PARTIAL')

    def test_new_service_binding_has_an_explicit_gate_and_cannot_pass_original_train_verification(self):
        runner_spec = importlib.util.spec_from_file_location('service_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        first = {'recommendedDepartureAt': '2026-11-20T15:10:00+09:00', 'automaticAlarmStateCount': 0}
        selected = {**first, 'uiResult': 'PROVISIONAL_PASSED', 'observedServiceConnection': {
            'classification': 'TWO_ENDPOINT_ACTUAL_SERVICE_CONNECTION_NOT_TIMETABLE_ALIAS',
            'services': [{'trainNumber': '3202', 'comparisonTimetableTrainNumber': '2202'}]}}
        result = runner.postdeparture_audit([first, selected], False, require_observed_service_connection=True)
        self.assertEqual(result['result'], 'PASSED')
        self.assertTrue(result['observedServiceApiAndAppVerified'])
        self.assertFalse(result['finalAlightingForecastVerified'])
        self.assertFalse(result['physicalArrivalMeasured'])
        self.assertEqual(runner.postdeparture_audit([first, selected], True, require_final_alighting=True)['result'], 'PARTIAL')
        fallback = {**selected, 'uiResult': 'FALLBACK_PASSED_NOT_LIVE_CORRECTION'}
        self.assertEqual(runner.postdeparture_audit([first, fallback], False,
            require_observed_service_connection=True)['result'], 'PARTIAL')

    def test_postdeparture_status_separates_new_origin_failure_from_saved_plan(self):
        runner_spec = importlib.util.spec_from_file_location('split_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        worker = {'travelMinutes': 62, 'source': 'TIMETABLE_PROVIDER', 'stale': True,
                  'failureReason': 'TRANSIT_TRAIN_NOT_YET_OBSERVED: safe'}
        public = {'travelMinutes': None, 'source': None, 'liveFetchedAt': None,
                  'failureReason': None, 'predictedArrivalAt': None,
                  'effectiveTransitRoute': None, 'stale': True,
                  'originReplanDiagnostic': worker.copy()}
        runner.verify_postdeparture_status_split(worker, public)
        for field in ('travelMinutes', 'source', 'failureReason', 'predictedArrivalAt'):
            leaked = copy.deepcopy(public)
            leaked[field] = worker.get(field) or 'leaked'
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                runner.verify_postdeparture_status_split(worker, leaked)
        missing_diagnostic = copy.deepcopy(public)
        missing_diagnostic['originReplanDiagnostic'] = None
        with self.assertRaises(RuntimeError):
            runner.verify_postdeparture_status_split(worker, missing_diagnostic)

    def test_planned_timing_warning_requires_this_worker_read_without_a_cached_arrival(self):
        spec = importlib.util.spec_from_file_location('warning_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        at = '2026-11-18T04:17:40Z'
        departure = '2026-11-18T04:17:28Z'
        update = {'routeIdentity': 'plan', 'failure': 'EARLY_BOARDING_UNCONFIRMED', 'route': None}
        diagnostic = {'travelMinutes': 65, 'source': 'SELECTED_ROUTE', 'stale': True, 'failureReason': None}
        worker = dict(diagnostic, scheduleId=363, evaluatedAt=at, recommendedDepartureAt=departure,
                      effectiveSnapshot={'inProgressPlannedRoute': {'identity': 'plan'}, 'plannedRouteUpdate': update})
        public = dict(scheduleId=363, evaluatedAt=at, recommendedDepartureAt=departure, stale=True,
                      plannedJourneyTimingFailureReason=update['failure'], originReplanDiagnostic=diagnostic,
                      _isolationReadWindow={'startedAt': at, 'finishedAt': at})
        runner.verify_planned_timing_failure(worker, public)
        for key, wrong in (('plannedJourneyTimingFailureReason', None), ('plannedJourneyTimingFailureReason', 'TIMELINE_INCONSISTENT'),
                           ('scheduleId', 364), ('evaluatedAt', departure), ('recommendedDepartureAt', at),
                           ('_isolationReadWindow', {'startedAt': departure, 'finishedAt': at}),
                           ('plannedJourneyArrivalPrediction', {'basis': 'LAST_ACCEPTED_PLAN'}),
                           ('futureTimetablePrediction', {'arrivalAt': at}), ('effectiveTransitRoute', {'identity': 'plan'})):
            with self.subTest(field=key), self.assertRaises(RuntimeError):
                runner.verify_planned_timing_failure(worker, {**public, key: wrong})

    def test_explicit_comparison_appointment_only_changes_future_input(self):
        runner_spec = importlib.util.spec_from_file_location('comparison_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        now = dt.datetime.fromisoformat('2026-10-12T22:00:00+09:00')
        departure = dt.datetime.fromisoformat('2026-10-12T22:30:00+09:00')
        self.assertIsNone(runner.comparison_target(None, departure, now))
        self.assertEqual(runner.comparison_target('2026-10-12T23:35:00+09:00', departure, now),
                         '2026-10-12T14:35:00+00:00')
        for value, start in [
            ('2026-10-12T23:35:00', departure),
            ('2026-10-12T23:35:01+09:00', departure),
            ('2026-10-12T22:30:00+09:00', departure),
            ('2026-10-12T21:59:00+09:00', departure),
            ('2026-10-13T01:01:00+09:00', departure),
            ('2026-10-12T23:35:00+09:00', None),
        ]:
            with self.subTest(value=value, start=start), self.assertRaises(ValueError):
                runner.comparison_target(value, start, now)

    def test_later_expiry_failure_revokes_an_earlier_accepted_e2e_pass(self):
        runner_spec = importlib.util.spec_from_file_location('real_runner', Path(__file__).with_name('run-eta-real-isolated.py'))
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        report = {'result': 'PASSED', 'evaluations': [{'uiResult': 'PASSED'}]}
        runner.mark_failed(report, RuntimeError('private diagnostic must not be exported'))
        self.assertEqual(report, {'result': 'PARTIAL', 'failureKind': 'RuntimeError',
                                  'evaluations': [{'uiResult': 'PASSED'}]})

    def test_expired_api_read_preserves_original_accepted_worker_and_alarm_clock(self):
        worker = {'source': 'LIVE_PROVIDER', 'stale': False, 'failureReason': None,
                  'scheduleId': 363, 'recommendedDepartureAt': '2026-10-12T11:55:00Z',
                  'travelMinutes': 68, 'evaluatedAt': '2026-10-12T11:55:01Z',
                  'effectiveSnapshot': {'accepted': True, 'firstBoardingObservation': {
                      'sourceUpdatedAt': '2026-10-12T11:54:10Z', 'evaluatedAt': '2026-10-12T11:55:00Z'}}}
        public = {k: worker[k] for k in ('source', 'scheduleId', 'recommendedDepartureAt', 'travelMinutes', 'evaluatedAt')}
        public.update(stale=True, confidence='LOW', failureReason='TRANSIT_ARRIVAL_SOURCE_STALE: safe reason',
                      routeChanged=False, _isolationReadWindow={'startedAt': '2026-10-12T11:57:01Z',
                                                              'finishedAt': '2026-10-12T11:57:02Z'})
        public.update({k: None for k in ('predictedArrivalAt', 'onTimeArrivalPossible', 'effectiveTransitRoute',
                                        'transitTimingBasis', 'firstBoardingWaitMinutes', 'firstBoardingObservation',
                                        'futureTimetablePrediction')})
        original = copy.deepcopy(worker)
        self.assertEqual(verifier.verify_expired_observation_read(worker, public)['result'], 'PASSED')
        self.assertEqual(worker, original)
        for key, value in [('stale', False), ('predictedArrivalAt', '2026-10-12T13:04:00Z'),
                           ('firstBoardingObservation', {}), ('effectiveTransitRoute', {}),
                           ('recommendedDepartureAt', '2026-10-12T11:56:00Z'), ('routeChanged', True),
                           ('failureReason', 'TRANSIT_ARRIVAL_UNAVAILABLE: other reason')]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verifier.verify_expired_observation_read(worker, {**public, key: value})
        changed = copy.deepcopy(public)
        changed['_isolationReadWindow']['startedAt'] = '2026-10-12T11:57:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_expired_observation_read(worker, changed)

    def test_rejected_real_route_uses_specific_warning_not_generic_fallback(self):
        expected = {
            'TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE': '현재 확인된 경로로 정시 도착 불가',
            'TRANSIT_TRANSFER_MISSED': '환승 불가 · 경로 재확인 필요',
            'TRANSIT_ITINERARY_REFRESH_UNSUPPORTED': '재조회 미지원 · 경로 재선택 필요',
            'TRANSIT_TRAIN_NOT_YET_OBSERVED': '열차의 실시간 도착 정보가 없어요',
        }
        for code, warning in expected.items():
            with self.subTest(code=code):
                self.assertEqual(diagnostic_warning(code + ': safe reason'), warning)
                self.assertNotEqual(diagnostic_warning(code), '저장 경로 기준')
        self.assertEqual(diagnostic_warning('UNKNOWN: reason'), '예상 출발')

    def test_consecutive_acceptance_cannot_count_separated_successes_or_missing_rounds(self):
        for statuses, expected in [
            (['PASSED', 'PASSED'], 2),
            (['NOT_ACCEPTED', 'PASSED', 'PASSED'], 2),
            (['PASSED', 'NOT_ACCEPTED', 'PASSED'], 1),
            (['PASSED', 'ACCEPTED_UI_NOT_VERIFIED', 'PASSED'], 1),
            ([], 0),
        ]:
            with self.subTest(statuses=statuses):
                records = [{'index': str(i), 'result': status} for i, status in enumerate(statuses, 1)]
                self.assertEqual(verifier.longest_accepted_ui_streak(records), expected)
        self.assertEqual(verifier.longest_accepted_ui_streak([
            {'index': '1', 'result': 'PASSED'}, {'index': '3', 'result': 'PASSED'},
        ]), 1)
        with self.assertRaises(AssertionError):
            verifier.longest_accepted_ui_streak([
                {'index': '1', 'result': 'PASSED'}, {'index': '1', 'result': 'PASSED'},
            ])

    def test_consecutive_evaluations_preserve_target_and_wait_for_saved_due_time(self):
        previous = {'memberId': 296, 'scheduleId': 363, 'journeyProvider': 'tmap',
                    'historyCount': 1, 'targetArrivalAt': '2026-10-12T07:00:00Z',
                    'nextCheckAt': '2026-10-12T06:01:00Z'}
        worker = {**previous, 'historyCount': 2, 'evaluatedAt': '2026-10-12T06:01:00Z'}
        verifier.verify_evaluation_cadence(previous, worker)
        for key, value in [('evaluatedAt', '2026-10-12T06:00:59Z'), ('historyCount', 3),
                           ('targetArrivalAt', '2026-10-12T07:01:00Z'), ('journeyProvider', 'odsay'),
                           ('memberId', 1), ('scheduleId', 364)]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verifier.verify_evaluation_cadence(previous, {**worker, key: value})

    def test_comparison_export_audit_catches_changed_anchor_train_and_accuracy_claim(self):
        # A clean checkout must not depend on an untracked private live-run file.
        # This synthetic payload tests export integrity, never real-provider accuracy.
        arrival = '2026-10-12T04:20:51Z'
        worker = {'classification': 'REAL_PROVIDER_ISOLATED_WORKER', 'providersMocked': False,
            'clockMode': 'SYSTEM_WALL_CLOCK', 'source': 'LIVE_PROVIDER', 'stale': False,
            'failureReason': None, 'scheduleId': 363, 'latestHistoryId': 3,
            'evaluatedAt': '2026-10-12T03:59:30Z',
            'recommendedDepartureAt': '2026-10-12T04:00:00Z', 'predictedArrivalAt': arrival,
            'effectiveSnapshot': {'accepted': True, 'effectiveTransitRoute': {
                'departureAt': '2026-10-12T04:00:26Z', 'arrivalAt': arrival,
                'segments': [
                    {'kind': 'WALK', 'sequence': 0, 'walkingScope': 'ACCESS', 'durationMinutes': 2, 'walkingGeometry': {
                        'from': {'lat': 37.65, 'lng': 127.06}}},
                    {'kind': 'SUBWAY', 'sequence': 1, 'rideTiming': {
                        'basis': 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE',
                        'predictedBoardingAt': '2026-10-12T04:03:13Z',
                        'predictedArrivalAt': '2026-10-12T04:18:00Z',
                        'timetable': {'provider': 'seoul-timetable', 'line': 'LINE_4',
                            'fromStationCode': '0411', 'toStationCode': '0433',
                            'directionCode': 'DOWN', 'serviceClass': 'LOCAL',
                            'serviceDate': '2026-10-12', 'trainNumber': '4012'}}},
                    {'kind': 'WALK', 'sequence': 2, 'walkingScope': 'EGRESS', 'durationMinutes': 3, 'walkingGeometry': {
                        'to': {'lat': 37.48, 'lng': 126.93}}},
                ]}}}
        export_spec = importlib.util.spec_from_file_location('comparison_export', Path(__file__).with_name('verify-eta-comparison.py'))
        exporter = importlib.util.module_from_spec(export_spec)
        export_spec.loader.exec_module(exporter)
        prediction = exporter.worker_prediction(worker, 'synthetic-comparison-export-regression')
        self.assertEqual(verifier.verify_comparison_export(worker, prediction)['result'], 'PASSED')
        for mutation in ('alarm_anchor', 'train', 'round_boarding', 'clock_kind', 'platform', 'actual_accuracy', 'precision', 'coordinate'):
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                changed = copy.deepcopy(prediction)
                if mutation == 'alarm_anchor': changed['requestedDepartureAt'] = worker['recommendedDepartureAt']
                elif mutation == 'train': changed['rides'][0]['trainIdentity']['number'] = '4999'
                elif mutation == 'round_boarding': changed['rides'][0]['boardingAt'] = '2026-10-12T04:03:00Z'
                elif mutation == 'clock_kind': changed['rides'][0]['boardingClockKind'] = 'BOARDING'
                elif mutation == 'platform': changed['walkingBoundaryEvidence'][0]['to']['kind'] = 'STATION_PLATFORM'
                elif mutation == 'precision': changed['arrivalClockEvidence']['resolutionSeconds'] = 60
                elif mutation == 'coordinate': changed['originBoundary'] = 'coordinate:37.5,127.0'
                else: changed['realWorldAccuracyVerified'] = True
                verifier.verify_comparison_export(worker, changed)

        snapshot = worker['effectiveSnapshot']
        route = snapshot['effectiveTransitRoute']
        route.update(provider='odsay', identity='b' * 64)
        ride = route['segments'][1]
        ride.pop('rideTiming')
        ride.update(kind='BUS', busRidePrediction={'boardingAt': '2026-10-12T04:03:13Z',
            'alightingAt': '2026-10-12T04:18:00Z', 'sourceUpdatedAt': worker['evaluatedAt']})
        snapshot['lastAcceptedSeoulBusJourney'] = {'routeIdentity': route['identity'], 'departureAt': route['departureAt'],
            'rides': [{'sequence': 1, 'service': {'routeId': '100100585', 'direction': '서대문 방면',
                'boarding': {'stationId': '100000111', 'arsId': '01011', 'order': 75},
                'alighting': {'stationId': '100000222', 'arsId': '01012', 'order': 76}, 'vehicleKey': 'a' * 64}}]}
        bus_export = exporter.worker_prediction(worker, 'synthetic-comparison-export-regression-bus')
        self.assertEqual(verifier.verify_comparison_export(worker, bus_export)['result'], 'PASSED')
        for field, value in {'from': '100000111:01011:74', 'vehicleKey': 'a' * 64, 'boardingClockKind': 'BOARDING'}.items():
            with self.subTest(bus_field=field), self.assertRaises(AssertionError):
                changed = copy.deepcopy(bus_export)
                changed['rides'][0][field] = value
                verifier.verify_comparison_export(worker, changed)

    def test_expired_future_preview_must_be_hidden_not_promoted(self):
        worker = {'evaluatedAt': '2026-10-12T01:19:01Z', 'targetArrivalAt': '2026-10-12T03:00:00Z'}
        route = {'departureAt': '2026-10-12T01:19:00Z'}
        self.assertFalse(verifier.verify_future_visibility(worker, {'futureTimetablePrediction': None}, route))
        with self.assertRaises(AssertionError):
            verifier.verify_future_visibility(worker, {'futureTimetablePrediction': route}, route)

    def test_nonexpired_future_preview_cannot_silently_disappear(self):
        worker = {'evaluatedAt': '2026-10-12T01:19:01Z', 'targetArrivalAt': '2026-10-12T03:00:00Z'}
        route = {'departureAt': '2026-10-12T01:23:00Z', 'arrivalAt': '2026-10-12T02:30:00Z'}
        self.assertTrue(verifier.verify_future_visibility(worker, {'futureTimetablePrediction': route}, route))
        with self.assertRaises(AssertionError):
            verifier.verify_future_visibility(worker, {'futureTimetablePrediction': None}, route)

    def test_late_timetable_preview_must_be_hidden_even_when_departure_is_future(self):
        worker = {'evaluatedAt': '2026-10-12T01:19:01Z', 'targetArrivalAt': '2026-10-12T02:30:00Z'}
        route = {'departureAt': '2026-10-12T01:23:00Z', 'arrivalAt': '2026-10-12T02:30:01Z'}
        self.assertFalse(verifier.verify_future_visibility(worker, {'futureTimetablePrediction': None}, route))
        with self.assertRaises(AssertionError):
            verifier.verify_future_visibility(worker, {'futureTimetablePrediction': route}, route)

    def test_exact_target_arrival_is_not_misclassified_as_late(self):
        worker = {'evaluatedAt': '2026-10-12T01:19:01Z', 'targetArrivalAt': '2026-10-12T02:30:00Z'}
        route = {'departureAt': '2026-10-12T01:23:00Z', 'arrivalAt': worker['targetArrivalAt']}
        self.assertTrue(verifier.verify_future_visibility(worker, {'futureTimetablePrediction': route}, route))
        self.assertIsNone(verifier.preview_exclusion(worker, route))

    def test_preview_expiring_between_worker_and_real_api_read_is_not_a_clock_mismatch(self):
        worker = {'evaluatedAt': '2026-10-12T01:19:01Z', 'targetArrivalAt': '2026-10-12T03:00:00Z'}
        route = {'departureAt': '2026-10-12T01:20:00Z', 'arrivalAt': '2026-10-12T02:30:00Z'}
        def public(start, end, prediction=None):
            return {'futureTimetablePrediction': prediction, '_isolationReadWindow': {
                'startedAt': start, 'finishedAt': end}}
        self.assertFalse(verifier.verify_future_visibility(worker, public(
            '2026-10-12T01:20:01Z', '2026-10-12T01:20:02Z'), route))
        self.assertTrue(verifier.verify_future_visibility(worker, public(
            '2026-10-12T01:19:58Z', '2026-10-12T01:19:59Z', route), route))
        # 조회가 경계를 가로지르는 경우에는 그 안의 실제 판정 시각에 따라 양쪽이 가능하다.
        for value in (None, route):
            self.assertEqual(verifier.verify_future_visibility(worker, public(
                '2026-10-12T01:19:59Z', '2026-10-12T01:20:01Z', value), route), value is not None)
        for start, end, value in [
            ('2026-10-12T01:19:58Z', '2026-10-12T01:19:59Z', None),
            ('2026-10-12T01:20:01Z', '2026-10-12T01:20:02Z', route),
            ('2026-10-12T01:19:00Z', '2026-10-12T01:19:01Z', None),
            ('2026-10-12T01:19:59Z', '2026-10-12T01:19:58Z', None),
            ('2026-10-12T01:19:59Z', '2026-10-12T01:20:59Z', None),
        ]:
            with self.subTest(start=start, end=end, value=value), self.assertRaises(AssertionError):
                verifier.verify_future_visibility(worker, public(start, end, value), route)

    def test_preview_times_compare_instants_not_timezone_text(self):
        worker = {'evaluatedAt': '2026-10-12T10:19:01+09:00', 'targetArrivalAt': '2026-10-12T11:30:00+09:00'}
        route = {'departureAt': '2026-10-12T01:23:00Z', 'arrivalAt': '2026-10-12T02:30:01Z'}
        self.assertEqual(verifier.preview_exclusion(worker, route), 'ARRIVES_AFTER_TARGET')
        self.assertFalse(verifier.verify_future_visibility(worker, {'futureTimetablePrediction': None}, route))

    def sample(self):
        route = {'provider': 'tmap', 'totalMinutes': 70, 'arrivalAt': '2026-10-08T03:10:00Z',
                 'departureAt': '2026-10-08T02:00:00Z',
                 'segments': [{'kind': 'WALK', 'walkingScope': scope, 'durationSeconds': 120}
                              for scope in ('ACCESS', 'TRANSFER', 'EGRESS')]}
        for walk in route['segments']:
            walk['walkingGeometry'] = {'endpointBasis':'PROVIDER_LEG_ENDPOINTS',
                'pathEvidence':{'provider':'tmap', 'status':'UNAVAILABLE', 'steps':[],
                                'stationInteriorCoverage':'UNKNOWN'}}
        for first in (True, False):
            table = {'provider': 'seoul-timetable', 'trainNumber': 'test-only' if first else 'transfer-test-only',
                     'directionCode': 'DOWN', 'serviceClass': 'LOCAL', 'fromStationCode': 'A', 'toStationCode': 'B',
                     'fetchedAt': '2026-10-08T02:00:00Z',
                     'boardingAt': '2026-10-08T02:03:00Z' if first else '2026-10-08T02:50:00Z',
                     'arrivalAt': '2026-10-08T02:43:00Z' if first else '2026-10-08T03:08:00Z'}
            route['segments'].append({'kind': 'SUBWAY', 'rideTiming': {'timetable': table,
                'predictedBoardingAt': '2026-10-08T02:04:00Z' if first else table['boardingAt'],
                'predictedArrivalAt': '2026-10-08T02:44:00Z' if first else table['arrivalAt'],
                'basis': 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE' if first else 'TIMETABLE'}})
        # Model the actual alternating route order; a bag of walks then rides can
        # satisfy metadata equality but must not pass exact walking/timing accounting.
        route['segments'] = [route['segments'][i] for i in (0, 3, 1, 4, 2)]
        for index, segment in enumerate(route['segments']):
            segment['sequence'] = index
        observation = {'provider': 'seoul-openapi', 'trainNumber': 'test-only',
                       'departureAt': route['departureAt'],
                       'sourceUpdatedAt': '2026-10-08T01:59:20Z', 'evaluatedAt': '2026-10-08T02:00:00Z',
                       'readyAt': '2026-10-08T02:03:00Z', 'expectedBoardingAt': '2026-10-08T02:04:00Z'}
        basis = 'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE'
        worker = {'classification': 'REAL_PROVIDER_ISOLATED_WORKER', 'database': 'H2_MEMORY_ONLY',
                  'providersMocked': False, 'clockMode': 'SYSTEM_WALL_CLOCK', 'memberId': 296, 'scheduleId': 363,
                  'processed': 1, 'source': 'LIVE_PROVIDER', 'stale': False, 'failureReason': None,
                  'evaluatedAt': '2026-10-08T02:00:00Z', 'recommendedDepartureAt': '2026-10-08T02:00:00Z',
                  'predictedArrivalAt': route['arrivalAt'], 'targetArrivalAt': '2026-10-08T03:15:00Z',
                  'travelMinutes': 70, 'effectiveSnapshot': {'accepted': True, 'transitTimingBasis': basis,
                  'effectiveTransitRoute': route, 'firstBoardingObservation': observation}}
        public = {key: worker[key] for key in ('scheduleId', 'source', 'stale', 'failureReason',
                  'recommendedDepartureAt', 'predictedArrivalAt', 'travelMinutes')}
        public.update(transitTimingBasis=basis, effectiveTransitRoute=copy.deepcopy(route))
        return worker, public

    def test_matching_values(self):
        worker, public = self.sample()
        self.assertEqual(verifier.verify_values(worker, public)['sourceAgeSeconds'], 40)
        self.assertEqual(verifier.verify_values(worker, public)['walkingBoundaryAudit']['timingResult'], 'PASSED')

    def test_mixed_eta_checks_bus_freshness_and_transfer_even_when_api_matches_worker(self):
        from eta_planned_route_evidence import accepted_ride_labels, transfer_ride_labels

        for bus_first in (True, False):
            with self.subTest(bus_first=bus_first):
                worker, public = self.sample()
                worker['journeyProvider'] = 'odsay'
                snapshot = worker['effectiveSnapshot']
                route = snapshot['effectiveTransitRoute']
                route['provider'] = 'odsay'
                route['identity'] = 'b' * 64
                for segment in route['segments']:
                    if segment['kind'] == 'WALK':
                        segment.update(durationMinutes=2, durationSeconds=None, walkingGeometry=None)
                basis = 'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE' if bus_first else 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED'
                snapshot.update(transitTimingBasis=basis, transitRouteProvenance='SELECTED_ROUTE_PRESERVED', routeChanged=False)
                bus = route['segments'][1 if bus_first else 3]
                clocks = bus.pop('rideTiming')
                source = '2026-10-08T01:59:20Z'
                bus.update(kind='BUS', lineName='N37', fromName='첫 정류장', toName='다음 정류장', busRidePrediction={
                    'boardingAt': clocks['predictedBoardingAt'], 'alightingAt': clocks['predictedArrivalAt'], 'sourceUpdatedAt': source})
                if bus_first:
                    snapshot['firstBoardingObservation'].update(trainNumber=None, stationName='첫 정류장', lineName='N37')
                route['segments'][3]['transferTiming'] = {
                    'walkingSeconds': 120, 'previousArrivalAt': '2026-10-08T02:44:00Z', 'boardingAt': '2026-10-08T02:50:00Z',
                    'physicalReadyAt': '2026-10-08T02:46:00Z', 'confidenceReadyAt': '2026-10-08T02:47:00Z',
                    'bufferSeconds': 0, 'requiredMarginSeconds': 60, 'confidenceMarginSeconds': 60, 'remainingSlackSeconds': 180}
                public.update(effectiveTransitRoute=copy.deepcopy(route), transitTimingBasis=basis)
                self.assertEqual(verifier.verify_values(worker, public)['walkingBoundaryAudit']['timingResult'], 'PASSED')
                ride_label = accepted_ride_labels(route)[0 if bus_first else 1]
                self.assertIn('승차 정류장 도착 예측 →', ride_label)
                self.assertIn('하차 정류장 도착 예측', ride_label)
                self.assertIn('환승 대기 약 4분', transfer_ride_labels(route)[0])
                for fault in ('stale-bus', 'invalid-transfer', 'reported-as-departure'):
                    changed = copy.deepcopy(worker)
                    changed_route = changed['effectiveSnapshot']['effectiveTransitRoute']
                    changed_bus = changed_route['segments'][bus['sequence']]['busRidePrediction']
                    if fault == 'stale-bus': changed_bus['sourceUpdatedAt'] = '2026-10-08T01:57:59Z'
                    elif fault == 'invalid-transfer': changed_route['segments'][3]['transferTiming']['physicalReadyAt'] = '2026-10-08T02:46:01Z'
                    else: changed_bus['reportedAlightingAt'] = changed_bus['alightingAt']
                    with self.subTest(fault=fault), self.assertRaises(AssertionError):
                        verifier.verify_values(changed, {**public, 'effectiveTransitRoute': changed_route})

    def test_mixed_odsay_audit_rejects_a_different_bus_stop_from_the_provider_seed(self):
        bus = {'sequence': 1, 'mode': 'BUS', 'from': {'name': '첫 정류장', 'providerStopId': 'a', 'localStopId': '100000111', 'arsId': '01011'},
               'to': {'name': '다음 정류장', 'providerStopId': 'b', 'localStopId': '100000222', 'arsId': '01012'},
               'line': {'name': 'N37', 'providerRouteId': '3211', 'localRouteId': '100100585'}}
        train = {'sequence': 3, 'mode': 'SUBWAY', 'from': {'name': '사당', 'providerStopId': '226'},
                 'to': {'name': '신림', 'providerStopId': '230'}, 'directionCode': 'DOWN',
                 'line': {'name': '2호선', 'providerRouteId': '1000:2', 'seoulSubwayLine': 'LINE_2', 'serviceClass': 'LOCAL'}}
        workers = [{'kind': leg['mode'], 'sequence': leg['sequence'], 'fromName': leg['from']['name'],
                    'toName': leg['to']['name'], 'lineName': leg['line']['name']} for leg in (bus, train)]
        workers[1]['rideTiming'] = {'timetable': {'line': 'LINE_2', 'directionCode': 'DOWN', 'serviceClass': 'LOCAL'}}
        route = {'provider': 'odsay', 'identity': 'b' * 64, 'departureAt': '2026-10-08T02:00:00Z', 'segments': workers}
        saved = {'provider': 'odsay', 'providerTimeBasis': 'route_estimate', 'routeInfo': {'provider': 'odsay'},
                 'transitLegs': [{'kind': leg['mode'], 'startID': leg['from']['providerStopId'],
                                  'endID': leg['to']['providerStopId'], 'providerRouteId': leg['line']['providerRouteId']}
                                 for leg in (bus, train)]}
        binding = {'routeIdentity': route['identity'], 'departureAt': route['departureAt'], 'rides': [{'sequence': 1,
            'service': {'routeId': '100100585', 'boarding': {'stationId': '100000111', 'arsId': '01011'},
                        'alighting': {'stationId': '100000222', 'arsId': '01012'}}}]}
        seed = {'provider': 'odsay', 'legs': [bus, train]}
        verifier.verify_odsay_selection(seed, saved, route, bus_binding=binding)
        binding['rides'][0]['service']['boarding']['stationId'] = '100000333'
        with self.assertRaises(AssertionError):
            verifier.verify_odsay_selection(seed, saved, route, bus_binding=binding)

    def test_accepted_early_transfer_needs_station_evidence_and_keeps_scheduled_alighting(self):
        for fault in (None, 'stale', 'shifted_alighting', 'missing_station_clock', 'wrong_journey_basis', 'no_observation'):
            worker, public = self.sample()
            snap = worker['effectiveSnapshot']
            snap['transitTimingBasis'] = public['transitTimingBasis'] = 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED'
            route = snap['effectiveTransitRoute']
            first = route['segments'][1]['rideTiming']
            first['timetable']['arrivalAt'] = '2026-10-08T02:06:00Z'
            first['predictedArrivalAt'] = '2026-10-08T02:07:00Z'
            ride = route['segments'][3]['rideTiming']
            ride['timetable'].update(boardingAt='2026-10-08T02:13:00Z', arrivalAt='2026-10-08T02:20:00Z')
            ride['predictedArrivalAt'] = ride['timetable']['arrivalAt']
            worker['predictedArrivalAt'] = public['predictedArrivalAt'] = route['arrivalAt'] = '2026-10-08T02:22:00Z'
            worker['travelMinutes'] = public['travelMinutes'] = route['totalMinutes'] = 22
            ride.update(basis='TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING',
                        observationSourceUpdatedAt=worker['evaluatedAt'], predictedBoardingAt='2026-10-08T02:12:00Z')
            ride['timetable']['boardingStationArrivalAt'] = '2026-10-08T02:12:30Z'
            if fault == 'stale':
                ride['observationSourceUpdatedAt'] = '2026-10-08T01:57:59Z'
            elif fault == 'shifted_alighting':
                ride['predictedArrivalAt'] = '2026-10-08T02:19:30Z'
            elif fault == 'missing_station_clock':
                del ride['timetable']['boardingStationArrivalAt']
            elif fault == 'wrong_journey_basis':
                snap['transitTimingBasis'] = public['transitTimingBasis'] = 'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE'
            elif fault == 'no_observation':
                ride.update(basis='TIMETABLE', observationSourceUpdatedAt=None, predictedBoardingAt=ride['timetable']['boardingAt'])
            public['effectiveTransitRoute'] = copy.deepcopy(snap['effectiveTransitRoute'])
            with self.subTest(fault=fault):
                if fault is None:
                    self.assertEqual(verifier.verify_values(worker, public)['rides'][1], ride)
                else:
                    with self.assertRaises((AssertionError, KeyError)):
                        verifier.verify_values(worker, public)

    def test_first_live_shift_compares_station_arrivals_with_scheduled_dwell(self):
        worker, public = self.sample()
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        timetable = route['segments'][1]['rideTiming']['timetable']
        timetable['boardingStationArrivalAt'] = '2026-10-08T02:02:40Z'
        timetable['arrivalAt'] = '2026-10-08T02:42:40Z'
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        verifier.verify_values(worker, public)

        timetable['arrivalAt'] = '2026-10-08T02:43:00Z'
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)

    def test_odsay_walk_minutes_are_not_claimed_as_exact_seconds_or_geometry(self):
        worker, public = self.sample()
        worker['journeyProvider'] = 'odsay'
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        route['provider'] = 'odsay'
        for walk in [s for s in route['segments'] if s['kind'] == 'WALK']:
            walk.update(durationMinutes=2, durationSeconds=None, walkingGeometry=None)
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        result = verifier.verify_values(worker, public)['walkingBoundaryAudit']
        self.assertEqual(result['timingResult'], 'PASSED')
        self.assertFalse(result['exactSourceWalkingSecondsVerified'])
        for mutation in ('seconds', 'geometry', 'double-egress', 'too-short-transfer', 'provider'):
            w = copy.deepcopy(worker)
            r = w['effectiveSnapshot']['effectiveTransitRoute']
            if mutation == 'seconds': r['segments'][0]['durationSeconds'] = 120
            elif mutation == 'geometry': r['segments'][0]['walkingGeometry'] = {'endpointBasis': 'UNKNOWN'}
            elif mutation == 'double-egress': r['segments'][4]['durationMinutes'] += 2
            elif mutation == 'too-short-transfer': r['segments'][2]['durationMinutes'] = 7
            else: r['provider'] = 'tmap'
            p = copy.deepcopy(public)
            p['effectiveTransitRoute'] = copy.deepcopy(r)
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                verifier.verify_values(w, p)

    def test_verified_transfer_seconds_and_margin_are_audited_separately(self):
        worker, public = self.sample()
        worker['journeyProvider'] = 'odsay'
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        route['provider'] = 'odsay'
        for walk in [s for s in route['segments'] if s['kind'] == 'WALK']:
            walk.update(durationMinutes=2, durationSeconds=None, walkingGeometry=None)
        walk = route['segments'][2]
        walk.update(durationSeconds=117, walkingTiming={
            'source': 'ODSAY_FULL_PATH_SECONDS', 'originalDurationMinutes': 2,
            'movementSeconds': 117, 'sameOrderedPathVerified': True,
            'fetchedAt': worker['evaluatedAt']})
        first = route['segments'][1]['rideTiming']
        second = route['segments'][3]['rideTiming']
        arrival = verifier.instant(first['predictedArrivalAt'])
        ready = arrival + dt.timedelta(seconds=117)
        confidence = ready + dt.timedelta(seconds=60)
        boarding = verifier.instant(second['predictedBoardingAt'])
        route['segments'][3]['transferTiming'] = {
            'previousArrivalAt': arrival.isoformat(), 'walkingSeconds': 117,
            'bufferSeconds': 0, 'confidenceMarginSeconds': 60, 'requiredMarginSeconds': 60,
            'physicalReadyAt': ready.isoformat(), 'confidenceReadyAt': confidence.isoformat(),
            'boardingAt': boarding.isoformat(), 'remainingSlackSeconds': (boarding - confidence).total_seconds()}
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        result = verifier.verify_values(worker, public)['walkingBoundaryAudit']
        self.assertEqual(result['adoptedFullPathWalkingSeconds'], [117])
        self.assertFalse(result['stationInteriorCoverageVerified'])
        for fault in ('unverified', 'margin', 'walking', 'missing-source-time', 'wrong-seconds'):
            w = copy.deepcopy(worker)
            r = w['effectiveSnapshot']['effectiveTransitRoute']
            if fault == 'unverified': r['segments'][2]['walkingTiming']['sameOrderedPathVerified'] = False
            elif fault == 'margin': r['segments'][3]['transferTiming']['requiredMarginSeconds'] = 0
            elif fault == 'walking': r['segments'][3]['transferTiming']['walkingSeconds'] = 62
            elif fault == 'missing-source-time': r['segments'][2]['walkingTiming']['fetchedAt'] = None
            else: r['segments'][2]['walkingTiming']['movementSeconds'] = 118
            p = copy.deepcopy(public)
            p['effectiveTransitRoute'] = copy.deepcopy(r)
            with self.subTest(fault=fault), self.assertRaises((AssertionError, TypeError, AttributeError)):
                verifier.verify_values(w, p)

    def test_odsay_entrance_and_exit_seconds_preserve_audited_route_boundaries(self):
        worker, public = self.sample()
        worker['journeyProvider'] = 'odsay'
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        route['provider'] = 'odsay'
        for walk in (s for s in route['segments'] if s['kind'] == 'WALK'):
            walk.update(durationMinutes=2, durationSeconds=None, walkingGeometry=None)
        for index, scope, source in ((0, 'ACCESS', 'ODSAY_ENTRANCE_WALK_SECONDS'),
                                     (4, 'EGRESS', 'ODSAY_EXIT_WALK_SECONDS')):
            start, end = {'lat': 37.65, 'lng': 127.06}, {'lat': 37.651, 'lng': 127.06}
            route['segments'][index].update(durationSeconds=120, walkingTiming={
                'source': source, 'originalDurationMinutes': 1, 'movementSeconds': 120,
                'sameOrderedPathVerified': False, 'fetchedAt': worker['evaluatedAt'],
            }, walkingGeometry={
                'endpointBasis': 'PROVIDER_PATH_ENDPOINTS', 'distanceMeters': 148,
                'from': start, 'to': end, 'providerQueryEndpoints': {'start': start.copy(), 'end': end.copy()},
            })
            self.assertEqual(route['segments'][index]['walkingScope'], scope)
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        result = verifier.verify_values(worker, public)['walkingBoundaryAudit']
        self.assertEqual(result['adoptedEntranceExitWalkingSeconds'],
                         [{'scope': 'ACCESS', 'seconds': 120}, {'scope': 'EGRESS', 'seconds': 120}])
        self.assertFalse(result['stationInteriorCoverageVerified'])

        for fault in ('wrong-scope', 'ordered-claim', 'far-from-pin', 'platform-claim'):
            incorrect = copy.deepcopy(route)
            access = incorrect['segments'][0]
            if fault == 'wrong-scope':
                access['walkingTiming']['source'] = 'ODSAY_EXIT_WALK_SECONDS'
            elif fault == 'ordered-claim':
                access['walkingTiming']['sameOrderedPathVerified'] = True
            elif fault == 'far-from-pin':
                access['walkingGeometry']['providerQueryEndpoints']['start']['lat'] += 0.001
            else:
                access['walkingGeometry']['pathEvidence'] = {'stationInteriorCoverage': 'INCLUDED_TO_PLATFORM'}
            with self.subTest(fault=fault), self.assertRaises(AssertionError):
                verifier.verify_odsay_minute_walking(incorrect)

    def test_actual_odsay_diagnostic_never_counts_as_normal_eta_acceptance(self):
        worker, public = self.sample()
        worker.update(journeyProvider='odsay', historyCount=1, source='SELECTED_ROUTE', stale=True,
                      failureReason='TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY: safe message', predictedArrivalAt=None,
                      effectiveSnapshot={'accepted': False})
        for key in ('source', 'stale', 'failureReason', 'predictedArrivalAt'):
            public[key] = worker[key]
        public['effectiveTransitRoute'] = None
        rides = [{'mode': 'SUBWAY', 'from': {'providerStopId': a, 'name': start},
                  'to': {'providerStopId': b, 'name': end}, 'line': {'providerRouteId': line}}
                 for a, b, start, end, line in [('411', '433', '노원', '사당', '1000:4'),
                                                ('226', '230', '사당', '신림', '1000:2')]]
        seed = {'provider': 'odsay', 'legs': rides}
        selected = {'provider': 'odsay', 'routeInfo': {'provider': 'odsay'}, 'providerTimeBasis': 'route_estimate',
                    'transitLegs': [{'kind': 'SUBWAY', 'startID': r['from']['providerStopId'],
                                     'endID': r['to']['providerStopId'], 'providerRouteId': r['line']['providerRouteId']}
                                    for r in rides]}
        result = verifier.verify_diagnostic_values(worker, public, seed, selected)
        self.assertFalse(result['acceptedEtaVerified'])
        self.assertTrue(result['selectedProviderIdsPreserved'])
        for change in ('relabel', 'ids', 'accepted', 'different-public', 'different-provider', 'ineligible-preview'):
            w, p, s = copy.deepcopy(worker), copy.deepcopy(public), copy.deepcopy(selected)
            if change == 'relabel': s['routeInfo']['provider'] = 'tmap'
            elif change == 'ids': s['transitLegs'][0]['startID'] = '110406'
            elif change == 'accepted': w['effectiveSnapshot']['accepted'] = True
            elif change == 'different-provider': p['effectiveTransitRoute'] = {'provider': 'tmap'}
            elif change == 'ineligible-preview': p['futureTimetablePrediction'] = {'departureAt': 'unverified'}
            else: p['failureReason'] = 'DIFFERENT'
            with self.subTest(change=change), self.assertRaises(AssertionError):
                verifier.verify_diagnostic_values(w, p, seed, s)

    def test_short_first_ride_preserves_odsay_stop_ids_and_rejects_other_corridors(self):
        rides = [{'mode': 'SUBWAY', 'from': {'providerStopId': a, 'name': start},
                  'to': {'providerStopId': b, 'name': end}, 'line': {'providerRouteId': line}}
                 for a, b, start, end, line in [('431', '433', '동작', '사당', '1000:4'),
                                                ('226', '230', '사당', '신림', '1000:2')]]
        seed = {'provider': 'odsay', 'legs': rides}
        selected = {'provider': 'odsay', 'routeInfo': {'provider': 'odsay'}, 'providerTimeBasis': 'route_estimate',
                    'transitLegs': [{'kind': 'SUBWAY', 'startID': r['from']['providerStopId'],
                                    'endID': r['to']['providerStopId'], 'providerRouteId': r['line']['providerRouteId']}
                                   for r in rides]}
        verifier.verify_odsay_selection(seed, selected)
        for fault in ('changed-id', 'changed-station'):
            bad_seed, bad_selected = copy.deepcopy(seed), copy.deepcopy(selected)
            if fault == 'changed-id': bad_selected['transitLegs'][0]['startID'] = '411'
            else: bad_seed['legs'][0]['from']['name'] = '서울'
            with self.subTest(fault=fault), self.assertRaises(AssertionError):
                verifier.verify_odsay_selection(bad_seed, bad_selected)

    def test_odsay_link_geometry_does_not_imply_exact_seconds_or_platform_coverage(self):
        worker, public = self.sample()
        worker['journeyProvider'] = 'odsay'
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        route['provider'] = 'odsay'
        for walk in [s for s in route['segments'] if s['kind'] == 'WALK']:
            walk.update(durationMinutes=2, durationSeconds=None, walkingGeometry={
                'endpointBasis':'UNKNOWN', 'from':None, 'to':None, 'distanceMeters':170,
                'pathEvidence':{'provider':'odsay','status':'PROVIDED','stationInteriorCoverage':'UNKNOWN',
                    'steps':[{'coordinates':[{'lat':37.47,'lng':126.98},{'lat':37.48,'lng':126.99}]}]}})
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        result = verifier.verify_values(worker, public)['walkingBoundaryAudit']
        self.assertEqual(result['timingResult'], 'PASSED')
        self.assertFalse(result['exactSourceWalkingSecondsVerified'])
        for mutation in ('platform', 'provider', 'coordinate', 'meters', 'api-mismatch'):
            w, p = copy.deepcopy(worker), copy.deepcopy(public)
            geometry = w['effectiveSnapshot']['effectiveTransitRoute']['segments'][0]['walkingGeometry']
            if mutation == 'platform': geometry['pathEvidence']['stationInteriorCoverage'] = 'INCLUDED_TO_PLATFORM'
            elif mutation == 'provider': geometry['pathEvidence']['provider'] = 'tmap'
            elif mutation == 'coordinate': geometry['pathEvidence']['steps'][0]['coordinates'][0]['lat'] = 137
            else: geometry['distanceMeters'] = -1 if mutation == 'meters' else 171
            if mutation != 'api-mismatch':
                p['effectiveTransitRoute'] = copy.deepcopy(w['effectiveSnapshot']['effectiveTransitRoute'])
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                verifier.verify_values(w, p)

    def test_equal_worker_and_api_cannot_hide_double_egress_or_unboardable_transfer(self):
        for change in ('double-egress', 'short-transfer-gap'):
            with self.subTest(change=change):
                worker, public = self.sample()
                route = worker['effectiveSnapshot']['effectiveTransitRoute']
                route['segments'][4 if change == 'double-egress' else 2]['durationSeconds'] += 360
                public['effectiveTransitRoute'] = copy.deepcopy(route)
                with self.assertRaises(AssertionError):
                    verifier.verify_values(worker, public)

    def test_odsay_future_timetable_is_separate_from_accepted_eta_and_preserves_two_trains(self):
        worker, public = self.sample()
        worker.update(journeyProvider='odsay', historyCount=2, source='TIMETABLE_PROVIDER', stale=True,
            failureReason='TRANSIT_TRAIN_NOT_YET_OBSERVED: safe message', predictedArrivalAt=None)
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        route['provider'] = 'odsay'
        seed = {'provider': 'odsay', 'legs': []}
        selected = {'provider': 'odsay', 'routeInfo': {'provider': 'odsay'}, 'providerTimeBasis': 'route_estimate',
                    'transitLegs': []}
        for segment in route['segments']:
            if segment['kind'] == 'WALK':
                segment.update(durationMinutes=2, durationSeconds=None, walkingGeometry=None)
                continue
            first = segment['sequence'] == 1
            start, end, line, a, b = ('노원', '사당', 'LINE_4', '411', '433') if first else ('사당', '신림', 'LINE_2', '226', '230')
            name, route_id = ('수도권 4호선', '1000:4') if first else ('수도권 2호선', '1000:2')
            segment.update(fromName=start, toName=end, lineName=name)
            timing = segment['rideTiming']
            timing.update(basis='TIMETABLE', predictedBoardingAt=timing['timetable']['boardingAt'],
                          predictedArrivalAt=timing['timetable']['arrivalAt'])
            timing['timetable']['line'] = line
            seed['legs'].append({'mode': 'SUBWAY', 'from': {'providerStopId': a, 'name': start},
                'to': {'providerStopId': b, 'name': end}, 'directionCode': 'DOWN' if first else None,
                'nextStopName': '창동' if first else '낙성대',
                'line': {'providerRouteId': route_id, 'name': name, 'seoulSubwayLine': line, 'serviceClass': 'LOCAL'}})
            selected['transitLegs'].append({'kind': 'SUBWAY', 'startID': a, 'endID': b, 'providerRouteId': route_id})
        worker['effectiveSnapshot'].update(accepted=False, transitTimingBasis='TIMETABLE_ONLY', firstBoardingObservation=None)
        for key in ('source', 'stale', 'failureReason', 'predictedArrivalAt'):
            public[key] = worker[key]
        public.update(transitTimingBasis=None, effectiveTransitRoute=None, futureTimetablePrediction=copy.deepcopy(route))
        result = verifier.verify_diagnostic_values(worker, public, seed, selected)
        self.assertTrue(result['futureTimetablePredictionVerified'])
        self.assertFalse(result['acceptedEtaVerified'])
        for mutation in ('normal-route', 'fresh-basis', 'missing-future', 'wrong-line', 'missing-timing'):
            w, p = copy.deepcopy(worker), copy.deepcopy(public)
            if mutation == 'normal-route': p['effectiveTransitRoute'] = p['futureTimetablePrediction']
            elif mutation == 'fresh-basis': p['transitTimingBasis'] = 'TIMETABLE_ONLY'
            elif mutation == 'missing-future': p['futureTimetablePrediction'] = None
            elif mutation == 'wrong-line': w['effectiveSnapshot']['effectiveTransitRoute']['segments'][3]['rideTiming']['timetable']['line'] = 'LINE_4'
            else: w['effectiveSnapshot']['effectiveTransitRoute']['segments'][3]['rideTiming'] = None
            with self.subTest(mutation=mutation), self.assertRaises((AssertionError, TypeError)):
                verifier.verify_diagnostic_values(w, p, seed, selected)

    def test_safe_earlier_alert_is_distinct_from_route_departure(self):
        worker, public = self.sample()
        worker['recommendedDepartureAt'] = public['recommendedDepartureAt'] = '2026-10-08T01:59:00Z'
        self.assertEqual(verifier.verify_values(worker, public)['recommendationLeadSeconds'], 60)
        worker['recommendedDepartureAt'] = public['recommendedDepartureAt'] = '2026-10-08T02:01:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)

    def test_missing_ui_does_not_mislabel_an_accepted_worker_as_provider_rejection(self):
        worker, _ = self.sample()
        self.assertEqual(verifier.missing_ui_result(worker), 'ACCEPTED_UI_NOT_VERIFIED')
        worker['stale'] = True
        self.assertEqual(verifier.missing_ui_result(worker), 'NOT_ACCEPTED')

    def test_real_run_cannot_drop_metadata_or_claim_unconfirmed_platform_coverage(self):
        for change in ('missing', 'platform', 'wrong-basis', 'provided-without-path'):
            with self.subTest(change=change):
                worker, public = self.sample()
                route = worker['effectiveSnapshot']['effectiveTransitRoute']
                geometry = route['segments'][0]['walkingGeometry']
                if change == 'missing': route['segments'][0].pop('walkingGeometry')
                elif change == 'platform': geometry['pathEvidence']['stationInteriorCoverage'] = 'INCLUDED_TO_PLATFORM'
                elif change == 'wrong-basis': geometry['endpointBasis'] = 'UNKNOWN'
                else: geometry['pathEvidence']['status'] = 'PROVIDED'
                public['effectiveTransitRoute'] = copy.deepcopy(route)
                with self.assertRaises((AssertionError, KeyError)):
                    verifier.verify_values(worker, public)

    def test_partial_observation_is_a_failing_acceptance_gate(self):
        self.assertEqual(verifier.verification_exit_code({'result': 'PARTIAL'}), 1)
        self.assertEqual(verifier.verification_exit_code({'result': 'PASSED'}), 0)

    def test_fallback_mock_clock_and_wrong_scope_are_rejected(self):
        mutations = [('source', 'TIMETABLE_PROVIDER'), ('stale', True), ('providersMocked', True),
                     ('clockMode', 'FIXED'), ('database', 'MYSQL'), ('memberId', 1), ('processed', 0)]
        for key, value in mutations:
            with self.subTest(key=key):
                worker, public = self.sample()
                worker[key] = value
                with self.assertRaises(AssertionError):
                    verifier.verify_values(worker, public)

    def test_accepted_flag_and_fresh_vehicle_are_required(self):
        worker, public = self.sample()
        worker['effectiveSnapshot']['accepted'] = False
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)
        worker, public = self.sample()
        worker['effectiveSnapshot']['firstBoardingObservation']['sourceUpdatedAt'] = '2026-10-08T01:57:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)

    def test_api_mismatch_and_late_arrival_are_rejected(self):
        worker, public = self.sample()
        public['recommendedDepartureAt'] = '2026-10-08T02:01:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)
        worker, public = self.sample()
        worker['targetArrivalAt'] = '2026-10-08T03:09:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)

    def test_missing_walk_scope_and_unboardable_vehicle_are_rejected(self):
        worker, public = self.sample()
        worker['effectiveSnapshot']['firstBoardingObservation']['readyAt'] = '2026-10-08T02:05:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)
        worker, public = self.sample()
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        route['segments'].pop(0)
        public['effectiveTransitRoute'] = copy.deepcopy(route)
        with self.assertRaises(AssertionError):
            verifier.verify_values(worker, public)

    def test_synthetic_train_wrong_train_double_delay_or_realtime_transfer_are_rejected(self):
        for change in ('synthetic', 'train', 'double-delay', 'transfer-live', 'missing'):
            with self.subTest(change=change):
                worker, public = self.sample()
                route = worker['effectiveSnapshot']['effectiveTransitRoute']
                rides = [s for s in route['segments'] if s['kind'] == 'SUBWAY']
                first = rides[0]['rideTiming']
                if change == 'synthetic': first['timetable']['provider'] = 'fixture-timetable'
                elif change == 'train': first['timetable']['trainNumber'] = 'wrong-train'
                elif change == 'double-delay': first['predictedArrivalAt'] = '2026-10-08T02:45:00Z'
                elif change == 'transfer-live': rides[1]['rideTiming']['basis'] = 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
                else: rides[1].pop('rideTiming')
                public['effectiveTransitRoute'] = copy.deepcopy(route)
                with self.assertRaises((AssertionError, KeyError)):
                    verifier.verify_values(worker, public)


if __name__ == '__main__':
    unittest.main()
