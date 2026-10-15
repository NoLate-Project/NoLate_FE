import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('comparison', Path(__file__).with_name('verify-eta-comparison.py'))
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class ComparisonTest(unittest.TestCase):
    def setUp(self):
        self.left = {
            'id': 'app', 'kind': 'APP_PREDICTION', 'evidence': 'synthetic-unit-test', 'mocked': False,
            'queryMode': 'DEPART_AT', 'observedAt': '2026-10-05T10:00:00Z',
            'requestedDepartureAt': '2026-10-05T11:00:00Z',
            'departureAt': '2026-10-05T11:00:00Z', 'arrivalAt': '2026-10-05T12:00:00Z',
            'arrivalClockEvidence': {'resolutionSeconds': 1, 'rounding': 'EXACT',
                                     'evidence': 'synthetic-second-precision-prediction'},
            'originBoundary': 'PUBLIC_ENTRANCE_A', 'destinationBoundary': 'PUBLIC_ENTRANCE_B',
            'walkingBoundaryEvidence': [
                {'scope': 'ACCESS', 'from': {'kind': 'STATION_ENTRANCE', 'id': 'PUBLIC_ENTRANCE_A'},
                 'to': {'kind': 'STATION_PLATFORM', 'id': 'PLATFORM_A_DOWN'},
                 'stationInteriorCoverage': 'INCLUDED_TO_PLATFORM', 'evidence': 'synthetic-boundary-input'},
                {'scope': 'EGRESS', 'from': {'kind': 'STATION_PLATFORM', 'id': 'PLATFORM_B_DOWN'},
                 'to': {'kind': 'STATION_ENTRANCE', 'id': 'PUBLIC_ENTRANCE_B'},
                 'stationInteriorCoverage': 'INCLUDED_TO_PLATFORM', 'evidence': 'synthetic-boundary-input'},
            ],
            'rides': [{'line': '4', 'from': 'A', 'to': 'B', 'direction': 'DOWN', 'serviceClass': 'LOCAL',
                       'boardingAt': '2026-10-05T11:05:00Z', 'arrivalAt': '2026-10-05T11:55:00Z',
                       'trainIdentity': {'namespace': 'synthetic-operator', 'serviceDate': '2026-10-05',
                                         'number': '4012', 'evidence': 'synthetic-visible-train-id'}}],
        }
        self.right = copy.deepcopy(self.left)
        self.right.update(id='naver', kind='MAP_PREDICTION')

    def test_matching_predictions_are_not_actual_accuracy_or_e2e(self):
        result = comparison.compare(self.left, self.right)
        self.assertTrue(result['withinTwoMinutes'])
        self.assertFalse(result['realWorldAccuracyVerified'])
        self.assertFalse(result['simulatorE2eVerified'])

    def test_same_station_names_or_nominal_endpoints_cannot_prove_walking_equality(self):
        for mutation in ('missing', 'unknown', 'nominal', 'no_evidence', 'omitted_egress'):
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(self.right)
                evidence = changed['walkingBoundaryEvidence']
                if mutation == 'missing':
                    del changed['walkingBoundaryEvidence']
                elif mutation == 'unknown':
                    evidence[0]['stationInteriorCoverage'] = 'UNKNOWN'
                elif mutation == 'nominal':
                    evidence[0]['to']['kind'] = 'STATION_ENTRANCE'
                elif mutation == 'no_evidence':
                    evidence[0]['evidence'] = ''
                else:
                    evidence.pop()
                result = comparison.compare(self.left, changed)
                self.assertIn('WALKING_BOUNDARIES_UNCONFIRMED', result['exclusionReasons'])
                self.assertIsNone(result['withinTwoMinutes'])

    def test_platform_identity_and_interior_coverage_must_match(self):
        changed = copy.deepcopy(self.right)
        changed['walkingBoundaryEvidence'][0]['to']['id'] = 'PLATFORM_A_UP'
        self.assertIn('WALKING_BOUNDARY_MISMATCH', comparison.compare(self.left, changed)['exclusionReasons'])
        self.right['walkingBoundaryEvidence'][0]['stationInteriorCoverage'] = 'EXCLUDED'
        self.assertIn('WALKING_BOUNDARIES_UNCONFIRMED', comparison.compare(self.left,self.right)['exclusionReasons'])

    def test_matching_endpoint_labels_without_walking_evidence_are_legacy_unknown(self):
        del self.left['walkingBoundaryEvidence']
        del self.right['walkingBoundaryEvidence']
        self.assertIsNone(comparison.compare(self.left,self.right)['withinTwoMinutes'])

    def test_exact_threshold_is_inclusive_and_over_threshold_fails(self):
        self.right['arrivalAt'] = '2026-10-05T12:02:00Z'
        self.assertTrue(comparison.compare(self.left, self.right)['withinTwoMinutes'])
        self.right['arrivalAt'] = '2026-10-05T12:02:01Z'
        self.assertFalse(comparison.compare(self.left, self.right)['withinTwoMinutes'])

    def test_equal_route_and_clocks_do_not_prove_same_train(self):
        for change in ('missing', 'number', 'namespace', 'serviceDate', 'evidence', 'line'):
            with self.subTest(change=change):
                right = copy.deepcopy(self.right)
                identity = right['rides'][0]['trainIdentity']
                if change == 'missing':
                    del right['rides'][0]['trainIdentity']
                elif change == 'evidence':
                    identity['evidence'] = ''
                elif change == 'line':
                    right['rides'][0]['line'] = '2'
                else:
                    identity[change] = {'number': '4014', 'namespace': 'other-operator',
                                        'serviceDate': '2026-10-06'}[change]
                result = comparison.compare(self.left, right)
                reason = 'TRAIN_IDENTITY_UNCONFIRMED' if change in ('missing', 'evidence') else 'TRAIN_SELECTION_MISMATCH'
                self.assertIn(reason, result['exclusionReasons'])
                self.assertIsNone(result['withinTwoMinutes'])
                self.assertEqual(result['diagnosticArrivalDeltaSeconds'], 0)

    def test_legacy_or_unknown_rounding_is_not_exact_seconds(self):
        for change in ('missing', 'unknown', 'evidence'):
            with self.subTest(change=change):
                right = copy.deepcopy(self.right)
                if change == 'missing':
                    del right['arrivalClockEvidence']
                else:
                    right['arrivalClockEvidence'] = {'resolutionSeconds': 60,
                        'rounding': 'UNKNOWN' if change == 'unknown' else 'TRUNCATED',
                        'evidence': '' if change == 'evidence' else 'visible-minute-clock-only'}
                result = comparison.compare(self.left, right)
                self.assertIn('ARRIVAL_CLOCK_PRECISION_UNCONFIRMED', result['exclusionReasons'])
                self.assertIsNone(result['arrivalDeltaRangeSeconds'])
                self.assertIsNone(result['withinTwoMinutes'])

    def test_whole_trip_agreement_does_not_hide_different_or_unpublished_train_choice(self):
        for change in ('missing', 'different'):
            with self.subTest(change=change):
                right = copy.deepcopy(self.right)
                if change == 'missing': del right['rides'][0]['trainIdentity']
                else: right['rides'][0]['trainIdentity']['number'] = '4014'
                right['arrivalAt'] = '2026-10-05T12:03:00Z'
                result = comparison.compare(self.left, right, scope='DOOR_TO_DOOR_PREDICTION')
                self.assertTrue(result['comparable'])
                self.assertFalse(result['withinTwoMinutes'])
                self.assertFalse(result['sameTrainComparison']['confirmed'])
                self.assertFalse(result['realWorldAccuracyVerified'])

    def test_whole_trip_scope_cannot_bypass_boundary_or_precision_gates(self):
        for field in ('walkingBoundaryEvidence', 'arrivalClockEvidence'):
            with self.subTest(field=field):
                right = copy.deepcopy(self.right)
                del right[field]
                self.assertIsNone(comparison.compare(self.left, right, scope='DOOR_TO_DOOR_PREDICTION')['withinTwoMinutes'])
        with self.assertRaises(ValueError):
            comparison.compare(self.left, self.right, scope='IGNORE_MISMATCHES')

    def test_report_preserves_explicit_comparison_scope(self):
        del self.right['rides'][0]['trainIdentity']
        result = comparison.report({'comparisonScope': 'DOOR_TO_DOOR_PREDICTION',
                                    'observations': [self.left, self.right]})
        self.assertEqual(result['comparisonScope'], 'DOOR_TO_DOOR_PREDICTION')
        self.assertEqual(result['withinTwoMinutesCount'], 1)

    def test_strict_exit_code_does_not_turn_excluded_comparison_into_success(self):
        good = comparison.report({'observations': [self.left, self.right]})
        self.assertEqual(comparison.agreement_exit_code(good), 0)
        self.assertTrue(good['predictionAgreementVerified'])
        self.right['arrivalAt'] = '2026-10-05T12:03:00Z'
        bad = comparison.report({'observations': [self.left, self.right]})
        self.assertEqual(comparison.agreement_exit_code(bad), 1)
        self.assertFalse(bad['predictionAgreementVerified'])
        del self.right['arrivalClockEvidence']
        unknown = comparison.report({'observations': [self.left, self.right]})
        self.assertEqual(comparison.agreement_exit_code(unknown), 3)
        self.assertFalse(unknown['predictionAgreementVerified'])

    def test_minute_precision_can_straddle_threshold_instead_of_false_pass_or_fail(self):
        self.right['arrivalClockEvidence'] = {'resolutionSeconds': 60, 'rounding': 'TRUNCATED',
                                             'evidence': 'synthetic-formatting-contract'}
        for time, lower, upper, expected in (
            ('12:02:00', -180, -120, None),
            ('11:58:00', 60, 120, True),
            ('11:57:00', 120, 180, None),
            ('11:56:00', 180, 240, False),
        ):
            with self.subTest(time=time):
                self.right['arrivalAt'] = f'2026-10-05T{time}Z'
                result = comparison.compare(self.left, self.right)
                self.assertTrue(result['comparable'])
                self.assertEqual(result['arrivalDeltaRangeSeconds'], {'minimum': lower, 'maximum': upper})
                self.assertIs(result['withinTwoMinutes'], expected)
                if expected is None:
                    self.assertEqual(result['twoMinuteAssessment'], 'INDETERMINATE_CLOCK_PRECISION')
        self.left['arrivalAt'] = '2026-10-05T12:00:01Z'
        self.right['arrivalAt'] = '2026-10-05T11:57:00Z'
        self.assertEqual(comparison.compare(self.left, self.right)['arrivalDeltaRangeSeconds'],
                         {'minimum': 121, 'maximum': 181})
        self.assertFalse(comparison.compare(self.left, self.right)['withinTwoMinutes'])

    def test_both_nearest_minute_clocks_accumulate_precision_bounds(self):
        for item in (self.left, self.right):
            item['arrivalClockEvidence'] = {'resolutionSeconds': 60, 'rounding': 'NEAREST',
                                            'evidence': 'synthetic-rounding-contract'}
        self.right['arrivalAt'] = '2026-10-05T12:02:00Z'
        result = comparison.compare(self.left, self.right)
        self.assertEqual(result['arrivalDeltaRangeSeconds'], {'minimum': -180, 'maximum': -60})
        self.assertIsNone(result['withinTwoMinutes'])

    def test_invalid_precision_or_train_date_fails_closed(self):
        for mutation in ({'resolutionSeconds': True}, {'resolutionSeconds': 0},
                         {'resolutionSeconds': 60}, {'rounding': 'GUESSED'}):
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                right = copy.deepcopy(self.right)
                right['arrivalClockEvidence'].update(mutation)
                comparison.compare(self.left, right)
        self.right['rides'][0]['trainIdentity']['serviceDate'] = '20261005'
        with self.assertRaises(ValueError):
            comparison.compare(self.left, self.right)

    def test_declared_minute_clock_cannot_smuggle_seconds(self):
        self.right['arrivalAt'] = '2026-10-05T12:00:15Z'
        self.right['arrivalClockEvidence'] = {'resolutionSeconds': 60, 'rounding': 'TRUNCATED',
                                             'evidence': 'synthetic-format-contract'}
        with self.assertRaises(ValueError):
            comparison.compare(self.left, self.right)

    def test_report_does_not_count_excluded_or_precision_ambiguous_as_two_minute_pass(self):
        unknown = copy.deepcopy(self.right)
        unknown['id'] = 'unknown'
        del unknown['arrivalClockEvidence']
        coarse = copy.deepcopy(self.right)
        coarse.update(id='coarse', arrivalAt='2026-10-05T12:02:00Z')
        coarse['arrivalClockEvidence'] = {'resolutionSeconds': 60, 'rounding': 'TRUNCATED',
                                          'evidence': 'synthetic-formatting-contract'}
        result = comparison.report({'observations': [self.left, self.right, unknown, coarse]})
        self.assertEqual(result['comparableCount'], 2)
        self.assertEqual(result['withinTwoMinutesCount'], 1)
        self.assertEqual(result['outsideTwoMinutesCount'], 0)
        self.assertEqual(result['inconclusiveCount'], 2)

    def recorded_worker(self):
        # Read-only replay of a previously captured real result, NOT another live E2E.
        path = Path(__file__).parents[1] / 'evidence/2026-10-12-tmap-final-evaluation-3.json'
        return json.loads(path.read_text())

    def test_worker_export_keeps_current_departure_separate_from_protected_alarm(self):
        worker = self.recorded_worker()
        result = comparison.worker_prediction(worker, 'recorded-worker.json')
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        self.assertEqual(result['requestedDepartureAt'], route['departureAt'])
        self.assertEqual(result['protectedAlarmDepartureAt'], worker['recommendedDepartureAt'])
        self.assertNotEqual(result['requestedDepartureAt'], result['protectedAlarmDepartureAt'])
        self.assertEqual(result['arrivalAt'], route['arrivalAt'])
        self.assertEqual(result['rides'][0]['trainIdentity']['number'], '4095')
        self.assertEqual(result['rides'][0]['boardingAt'], '2026-10-12T04:03:50Z')
        self.assertFalse(result['simulatorE2eVerified'])
        self.assertFalse(result['realWorldAccuracyVerified'])

    def test_worker_export_does_not_promote_station_coordinates_to_platform_equality(self):
        result = comparison.worker_prediction(self.recorded_worker(), 'recorded-worker.json')
        self.assertIsNone(comparison.walking_boundaries(result))
        other = copy.deepcopy(result)
        other.update(id='same-captured-result', kind='MAP_PREDICTION')
        pair = comparison.compare(result, other)
        self.assertIn('WALKING_BOUNDARIES_UNCONFIRMED', pair['exclusionReasons'])
        self.assertIsNone(pair['withinTwoMinutes'])
        self.assertTrue(all(w['stationInteriorCoverage'] == 'UNKNOWN' for w in result['walkingBoundaryEvidence']))

    def test_worker_export_rejects_mock_rejected_and_conflicting_current_results(self):
        for mutation in ('mock', 'clock', 'stale', 'fallback', 'not_accepted', 'arrival'):
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                worker = self.recorded_worker()
                if mutation == 'mock': worker['providersMocked'] = True
                elif mutation == 'clock': worker['clockMode'] = 'FIXED_TEST_CLOCK'
                elif mutation == 'stale': worker['stale'] = True
                elif mutation == 'fallback': worker['source'] = 'SELECTED_ROUTE'
                elif mutation == 'arrival': worker['predictedArrivalAt'] = '2026-10-12T05:07:50Z'
                else: worker['effectiveSnapshot']['accepted'] = False
                comparison.worker_prediction(worker, 'recorded-worker.json')

    def test_different_boundaries_do_not_become_failed_accuracy(self):
        self.right['originBoundary'] = 'STATION_PLATFORM'
        result = comparison.compare(self.left, self.right)
        self.assertFalse(result['comparable'])
        self.assertIsNone(result['withinTwoMinutes'])
        self.assertEqual(result['diagnosticArrivalDeltaSeconds'], 0)

    def test_unknown_boundary_is_not_equality(self):
        self.left['originBoundary'] = self.right['originBoundary'] = 'UNKNOWN'
        self.assertFalse(comparison.compare(self.left, self.right)['comparable'])

    def test_mock_data_is_excluded(self):
        self.left['mocked'] = True
        self.assertIn('MOCK_FEED', comparison.compare(self.left, self.right)['exclusionReasons'])

    def test_arrive_by_and_other_departure_are_excluded(self):
        self.right['queryMode'] = 'ARRIVE_BY'
        self.right['requestedDepartureAt'] = '2026-10-05T10:59:00Z'
        result = comparison.compare(self.left, self.right)
        self.assertIn('QUERY_MODE_UNSUPPORTED', result['exclusionReasons'])
        self.assertIn('REQUESTED_DEPARTURE_MISMATCH', result['exclusionReasons'])

    def test_capture_after_departure_is_not_future_prediction(self):
        self.right['observedAt'] = '2026-10-05T11:00:00Z'
        self.assertIn('NOT_CAPTURED_BEFORE_FUTURE_DEPARTURE', comparison.compare(self.left, self.right)['exclusionReasons'])

    def test_stale_pair_capture_is_excluded(self):
        self.right['observedAt'] = '2026-10-05T10:05:01Z'
        self.assertIn('CAPTURE_TIME_SKEW', comparison.compare(self.left, self.right)['exclusionReasons'])

    def test_different_route_and_unknown_identity_are_excluded(self):
        self.right['rides'][0]['direction'] = 'UP'
        self.assertIn('RIDE_ROUTE_MISMATCH', comparison.compare(self.left, self.right)['exclusionReasons'])
        self.right['rides'][0]['direction'] = self.left['rides'][0]['direction'] = 'UNKNOWN'
        self.assertIn('RIDE_IDENTITY_UNCONFIRMED', comparison.compare(self.left, self.right)['exclusionReasons'])

    def test_ride_duration_not_confused_with_waiting(self):
        self.right['rides'][0].update(boardingAt='2026-10-05T11:06:00Z', arrivalAt='2026-10-05T11:56:00Z')
        diagnostic = comparison.compare(self.left, self.right)['rideDiagnostics'][0]
        self.assertEqual(diagnostic['boardingDeltaSeconds'], -60)
        self.assertEqual(diagnostic['rideDurationDeltaSeconds'], 0)

    def test_arrival_boundary_diagnostic_splits_alighting_and_residual(self):
        self.right['rides'][0]['arrivalAt'] = '2026-10-05T11:53:00Z'
        self.right['arrivalAt'] = '2026-10-05T11:55:00Z'
        result = comparison.compare(self.left, self.right)
        diagnostic = result['arrivalBoundaryDiagnostic']
        self.assertEqual(diagnostic['lastAlightingDeltaSeconds'], 120)
        self.assertEqual(diagnostic['leftPostAlightingResidualSeconds'], 300)
        self.assertEqual(diagnostic['rightPostAlightingResidualSeconds'], 120)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], 300)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], result['diagnosticArrivalDeltaSeconds'])
        self.assertFalse(result['withinTwoMinutes'])

    def test_endpoint_arithmetic_does_not_override_unknown_boundaries_or_mock(self):
        self.right.update(destinationBoundary='UNKNOWN', mocked=True)
        result = comparison.compare(self.left, self.right)
        self.assertEqual(result['arrivalBoundaryDiagnostic']['reconstructedArrivalDeltaSeconds'], 0)
        self.assertIsNone(result['withinTwoMinutes'])
        self.assertFalse(result['realWorldAccuracyVerified'])
        self.assertIn('MOCK_FEED', result['exclusionReasons'])

    def test_different_rides_can_have_arithmetic_but_not_route_agreement(self):
        self.right['rides'][0]['line'] = '7'
        result = comparison.compare(self.left, self.right)
        self.assertEqual(result['rideDiagnostics'], [])
        self.assertIn('RIDE_ROUTE_MISMATCH', result['exclusionReasons'])
        self.assertIsNone(result['withinTwoMinutes'])
        self.assertEqual(result['arrivalBoundaryDiagnostic']['classification'],
                         'ARITHMETIC_ONLY_NOT_WALKING_COVERAGE_PROOF')

    def test_invalid_naive_time_missing_mock_flag_and_reversed_ride_are_rejected(self):
        mutations = [ {'observedAt': '2026-10-05T10:00:00'}, {'mocked': None} ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                comparison.compare(self.left, self.right | mutation)
        self.right['rides'][0]['arrivalAt'] = '2026-10-05T11:04:00Z'
        with self.assertRaises(ValueError):
            comparison.compare(self.left, self.right)

    def test_actual_trip_claim_cannot_enter_prediction_verifier(self):
        self.right['kind'] = 'ACTUAL_TRIP'
        with self.assertRaises(ValueError):
            comparison.compare(self.left, self.right)

    def test_budget_separates_suggested_departure_from_access_wait(self):
        self.right['departureAt'] = '2026-10-05T11:02:00Z'
        diagnostic = comparison.compare(self.left, self.right)['timelineDiagnostic']
        self.assertEqual(diagnostic['leftMinusRight']['suggestedDepartureOffsetSeconds'], -120)
        self.assertEqual(diagnostic['leftMinusRight']['accessAndFirstWaitSeconds'], 120)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], 0)

    def test_budget_reconstructs_multi_ride_transfer_and_endpoint_difference(self):
        for observation in (self.left, self.right):
            observation['rides'][0]['arrivalAt'] = '2026-10-05T11:25:00Z'
            observation['rides'].append({
                'line': '2', 'from': 'B', 'to': 'C', 'direction': 'UP', 'serviceClass': 'LOCAL',
                'boardingAt': '2026-10-05T11:30:00Z', 'arrivalAt': '2026-10-05T11:50:00Z',
            })
        self.right['rides'][1].update(boardingAt='2026-10-05T11:28:00Z', arrivalAt='2026-10-05T11:48:00Z')
        self.right['arrivalAt'] = '2026-10-05T11:48:00Z'
        result = comparison.compare(self.left, self.right)
        diagnostic = result['timelineDiagnostic']
        self.assertEqual(diagnostic['leftMinusRight']['rideSeconds'], [0, 0])
        self.assertEqual(diagnostic['leftMinusRight']['transferAndWaitSeconds'], [120])
        self.assertEqual(diagnostic['leftMinusRight']['postAlightingResidualSeconds'], 600)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], 720)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], result['diagnosticArrivalDeltaSeconds'])

    def test_budget_does_not_promote_unknown_boundaries_or_identity(self):
        self.right['destinationBoundary'] = 'UNKNOWN'
        self.right['rides'][0]['serviceClass'] = self.left['rides'][0]['serviceClass'] = 'UNKNOWN'
        result = comparison.compare(self.left, self.right)
        self.assertIsNotNone(result['timelineDiagnostic'])
        self.assertIsNone(result['withinTwoMinutes'])
        self.assertFalse(result['realWorldAccuracyVerified'])

    def test_budget_can_be_negative_and_is_signed_left_minus_right(self):
        self.right['arrivalAt'] = '2026-10-05T12:03:00Z'
        diagnostic = comparison.compare(self.left, self.right)['timelineDiagnostic']
        self.assertEqual(diagnostic['leftMinusRight']['postAlightingResidualSeconds'], -180)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], -180)

    def test_visible_topology_allows_diagnostic_but_not_unknown_class_accuracy(self):
        self.right['rides'][0]['serviceClass'] = 'UNKNOWN'
        result = comparison.compare(self.left, self.right)
        self.assertIsNotNone(result['timelineDiagnostic'])
        self.assertIn('RIDE_ROUTE_MISMATCH', result['exclusionReasons'])
        self.assertIsNone(result['withinTwoMinutes'])

    def test_different_ride_identity_has_no_paired_timeline_decomposition(self):
        self.right['rides'][0]['line'] = '7'
        self.assertIsNone(comparison.compare(self.left, self.right)['timelineDiagnostic'])

    def test_budget_preserves_absolute_offset_in_excluded_different_requests(self):
        self.right['requestedDepartureAt'] = '2026-10-05T10:59:00Z'
        result = comparison.compare(self.left, self.right)
        diagnostic = result['timelineDiagnostic']
        self.assertEqual(diagnostic['leftMinusRight']['requestedDepartureDeltaSeconds'], 60)
        self.assertEqual(diagnostic['leftMinusRight']['requestedToArrivalSeconds'], -60)
        self.assertEqual(diagnostic['reconstructedArrivalDeltaSeconds'], 0)
        self.assertIsNone(result['withinTwoMinutes'])

    def test_duplicate_ids_and_empty_pairs_rejected(self):
        with self.assertRaises(ValueError):
            comparison.report({'observations': [self.left, self.left]})
        with self.assertRaises(ValueError):
            comparison.report({'observations': [self.left]})

    def test_recorded_2050_same_boardings_do_not_turn_egress_difference_into_accuracy_pass(self):
        # Replay recorded evidence only; this regression does not make live API calls
        # or count as another simulator E2E. Missing walking/class proof stays missing.
        path = Path(__file__).parents[1] / 'evidence/2026-10-09-future-2050-same-coordinates.json'
        result = comparison.report(json.loads(path.read_text()))
        pair = result['pairs'][0]
        budget = pair['timelineDiagnostic']['leftMinusRight']
        self.assertEqual(budget['suggestedDepartureOffsetSeconds'], -180)
        self.assertEqual(budget['accessAndFirstWaitSeconds'], 180)
        self.assertEqual(budget['rideSeconds'], [0, 30])
        self.assertEqual(budget['transferAndWaitSeconds'], [0])
        self.assertEqual(budget['postAlightingResidualSeconds'], 171)
        self.assertEqual(pair['diagnosticArrivalDeltaSeconds'], 201)
        self.assertEqual(pair['arrivalBoundaryDiagnostic']['reconstructedArrivalDeltaSeconds'], 201)
        self.assertEqual(result['comparableCount'], 0)
        self.assertIn('WALKING_BOUNDARIES_UNCONFIRMED', pair['exclusionReasons'])
        self.assertIn('RIDE_ROUTE_MISMATCH', pair['exclusionReasons'])
        self.assertIsNone(pair['withinTwoMinutes'])
        self.assertFalse(pair['realWorldAccuracyVerified'])
        self.assertFalse(pair['simulatorE2eVerified'])


if __name__ == '__main__':
    unittest.main()
