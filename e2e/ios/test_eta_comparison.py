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

    def test_displayed_destination_delta_has_no_hidden_train_or_rounding_assumption(self):
        for item, clock in ((self.left, '12:00'), (self.right, '12:03')):
            item['originBoundary'] = item['destinationBoundary'] = 'UNKNOWN'
            item['requestedCoordinateEvidence'] = {
                'origin': {'lat': 37.65, 'lng': 127.06},
                'destination': {'lat': 37.48, 'lng': 126.93},
                'evidence': 'captured pin inputs',
            }
            item['arrivalAt'] = f'2026-10-05T{clock}:00Z'
            item['displayedArrivalEvidence'] = {
                'scope': 'REQUESTED_DESTINATION', 'arrivalAt': item['arrivalAt'],
                'evidence': 'captured visible destination clock',
            }
            del item['rides'][0]['trainIdentity']
            del item['arrivalClockEvidence']
            del item['walkingBoundaryEvidence']
        result = comparison.compare(self.left, self.right)
        self.assertEqual(result['displayedDestinationComparison'], {
            'comparable': True, 'exclusionReasons': [],
            'leftMinusRightDisplayedMinutes': -3,
        })
        self.assertIsNone(result['withinTwoMinutes'])
        self.assertFalse(result['realWorldAccuracyVerified'])
        self.assertEqual(comparison.report({'observations': [self.left, self.right]})
                         ['displayedDestinationComparableCount'], 1)
        self.right['requestedCoordinateEvidence']['destination']['lat'] = 37.48001
        different_pins = comparison.compare(self.left, self.right)['displayedDestinationComparison']
        self.assertEqual(different_pins['exclusionReasons'], ['DISPLAY_QUERY_COORDINATES_MISMATCH'])
        self.assertIsNone(different_pins['leftMinusRightDisplayedMinutes'])

    def test_display_difference_requires_visible_destination_and_same_future_departure(self):
        for item in (self.left, self.right):
            item['originBoundary'] = '노원역'
            item['destinationBoundary'] = '신림역'
            item['displayedArrivalEvidence'] = {'scope': 'LAST_STATION', 'arrivalAt': item['arrivalAt'],
                                               'evidence': 'visible station clock'}
        self.left['departureAt'] = '2026-10-05T11:01:00Z'
        result = comparison.compare(self.left, self.right)['displayedDestinationComparison']
        self.assertFalse(result['comparable'])
        self.assertIsNone(result['leftMinusRightDisplayedMinutes'])
        self.assertIn('CALCULATED_DEPARTURE_DIFFERS_FROM_COMPARISON_INPUT', result['exclusionReasons'])
        self.assertIn('DISPLAY_QUERY_COORDINATES_UNCONFIRMED', result['exclusionReasons'])
        self.assertIn('DISPLAYED_DESTINATION_CLOCK_UNCONFIRMED', result['exclusionReasons'])

    def test_paired_naver_uses_same_samples_for_both_error_summaries(self):
        before, after, naver = copy.deepcopy(self.left), copy.deepcopy(self.left), self.right
        after['id'] = 'app-after'
        for item, clock in ((before, '12:05'), (after, '11:58'), (naver, '12:00')):
            item['requestedCoordinateEvidence'] = {
                'origin': {'lat': 37.65, 'lng': 127.06},
                'destination': {'lat': 37.48, 'lng': 126.93},
                'evidence': 'pinned inputs',
            }
            item['arrivalAt'] = f'2026-10-05T{clock}:00Z'
            item['displayedArrivalEvidence'] = {'scope': 'REQUESTED_DESTINATION',
                                                'arrivalAt': item['arrivalAt'], 'evidence': 'visible ETA'}
            del item['arrivalClockEvidence']
            del item['rides'][0]['trainIdentity']
        del naver['rides'][0]['arrivalAt']
        del after['displayedArrivalEvidence']
        after['arrivalAt'] = '2026-10-05T11:58:30Z'
        sample = {'id': 'same-trip', 'before': before, 'after': after, 'naver': naver}
        report = comparison.paired_map_report({'samples': [sample]})
        self.assertEqual(report['comparableCount'], 1)
        self.assertEqual(report['before'], {'meanAbsoluteErrorMinutes': 5, 'largeErrorCount': 1,
                                            'withinTwoMinutesCount': 0})
        self.assertEqual(report['after'], {'meanAbsoluteErrorMinutes': 1.5, 'largeErrorCount': 0,
                                           'withinTwoMinutesCount': 1})
        self.assertEqual(report['samples'][0]['after']['appMinusNaverMinutes'], -1.5)
        self.assertIsNone(report['samples'][0]['after']['routeClockDurationDifferenceMinutes'])
        self.assertIsNone(report['samples'][0]['after']['routeClockComparison'][2]['mapMinute'])
        after['rides'][0]['boardingAt'] = '2026-10-05T11:05:59Z'
        naver['rides'][0]['publishedClockEvidence'] = {'boardingAt': 'Public boarding time on map'}
        naver['departureAt'] = '2026-10-05T11:02:00Z'
        naver['publishedClockEvidence'] = {'departureAt': 'Displayed walking departure'}
        phase = comparison.paired_map_report({'samples': [sample]})['samples'][0]['after']
        self.assertEqual(phase['routeClockDurationDifferenceMinutes'], 0)
        checkpoints = phase['routeClockComparison']
        self.assertEqual([(c['event'], c['appMinusMapMinutes']) for c in checkpoints],
                         [('QUERY_DEPARTURE', 0), ('ROUTE_DEPARTURE', -2), ('RIDE_1_BOARDING', 0),
                          ('RIDE_1_ALIGHTING', None), ('DESTINATION', -2)])
        self.assertEqual(checkpoints[2]['changeInGapMinutes'], 2)
        self.assertEqual(checkpoints[-1]['fromEvent'], 'RIDE_1_BOARDING')
        self.assertEqual(checkpoints[-1]['changeInGapMinutes'], -2)
        after['rides'][0]['boardingClockKind'] = 'STATION_ARRIVAL_PREDICTION'
        checkpoints = comparison.paired_map_report({'samples': [sample]})['samples'][0]['after']['routeClockComparison']
        self.assertEqual(checkpoints[-1]['fromEvent'], 'ROUTE_DEPARTURE')
        naver['rides'][0]['boardingAt'] = '2026-10-05T11:05:01Z'
        with self.assertRaisesRegex(ValueError, 'hidden seconds'):
            comparison.paired_map_report({'samples': [sample]})
        naver['rides'][0]['boardingAt'] = '2026-10-05T11:05:00Z'
        after['walkingBoundaryEvidence'][1]['stationInteriorCoverage'] = 'UNKNOWN'
        report = comparison.paired_map_report({'samples': [sample]})
        self.assertEqual(report['comparableCount'], 0)
        self.assertIsNone(report['before']['meanAbsoluteErrorMinutes'])
        self.assertIsNone(report['after']['largeErrorCount'])
        self.assertIn('WALKING_BOUNDARIES_UNCONFIRMED', report['samples'][0]['after']['exclusionReasons'])
        self.assertIsNone(report['samples'][0]['after']['routeClockComparison'])
        sample['before'] = None
        report = comparison.paired_map_report({'samples': [sample]})
        self.assertEqual(report['candidateCount'], 1)
        self.assertEqual(report['comparableCount'], 0)
        self.assertEqual(report['samples'][0]['before']['exclusionReasons'], ['APP_PREDICTION_MISSING'])

    def test_moved_route_start_cannot_replace_the_original_map_query(self):
        self.left['comparisonRequestedDepartureAt'] = '2026-10-05T10:59:00Z'
        result = comparison.compare(self.left, self.right)
        self.assertIn('ORIGINAL_COMPARISON_DEPARTURE_MISMATCH', result['exclusionReasons'])
        self.assertIn('ORIGINAL_COMPARISON_DEPARTURE_MISMATCH',
                      result['displayedDestinationComparison']['exclusionReasons'])
        self.assertIsNone(result['withinTwoMinutes'])

    def test_destination_minute_distribution_counts_each_future_route_query_once(self):
        cases = []
        for idx, error in enumerate([0, 1, 2, 3, 4, 5, 6, 7, 8, 120]):
            before, after, naver = (copy.deepcopy(item) for item in (self.left, self.left, self.right))
            for item in (before, after, naver):
                item['requestedCoordinateEvidence'] = {'origin': {'lat': 37.5, 'lng': 127.0 + idx / 1000},
                                                       'destination': {'lat': 37.6, 'lng': 127.0}, 'evidence': 'test pins'}
            naver['id'] = f'map-{idx}'
            naver['displayedArrivalEvidence'] = {'scope': 'REQUESTED_DESTINATION', 'arrivalAt': naver['arrivalAt'], 'evidence': 'map clock'}
            before['arrivalAt'] = (comparison.instant(naver['arrivalAt']) + comparison.dt.timedelta(minutes=error)).isoformat()
            cases.append({'id': f'case-{idx}', 'before': before, 'after': after, 'naver': naver})
        repeat = copy.deepcopy(cases[-1])
        repeat['id'], repeat['naver']['id'] = 'repeat', 'map-repeat'
        report = comparison.paired_map_report({'samples': [repeat, *cases]})
        distribution = report['destinationMinuteDistribution']
        self.assertEqual(distribution['distinctRouteQueryCount'], 10)
        self.assertEqual(distribution['repeatCaptureIds'], ['repeat'])
        self.assertEqual(distribution['before'], {'medianAbsoluteMinutes': 4.5, 'p90AbsoluteMinutes': 8, 'maximumAbsoluteMinutes': 120})
        self.assertEqual(distribution['after']['p90AbsoluteMinutes'], 0)

    def test_whole_journey_display_comparison_requires_every_walk_and_preserves_input_checks(self):
        before, after, naver = copy.deepcopy(self.left), copy.deepcopy(self.left), self.right
        after['id'] = 'app-after'
        for item in (before, after, naver):
            item['requestedCoordinateEvidence'] = {
                'origin': {'lat': 37.65, 'lng': 127.06},
                'destination': {'lat': 37.48, 'lng': 126.93}, 'evidence': 'captured inputs',
            }
            item['displayedArrivalEvidence'] = {'scope': 'REQUESTED_DESTINATION',
                                                'arrivalAt': item['arrivalAt'], 'evidence': 'visible clock'}
            item['walkingCoverageEvidence'] = [
                {'scope': scope, 'included': True, 'evidence': 'visible whole-journey legs'}
                for scope in ('ACCESS', 'EGRESS')]
            del item['walkingBoundaryEvidence']
        case = {'id': 'whole-trip', 'before': before, 'after': after, 'naver': naver}
        document = {'walkingComparisonScope': 'WHOLE_JOURNEY', 'samples': [case]}
        result = comparison.paired_map_report(document)
        self.assertEqual(result['comparableCount'], 1)
        self.assertFalse(result['stationInteriorAllocationVerified'])
        self.assertFalse(result['realWorldAccuracyVerified'])
        self.assertEqual(comparison.paired_map_report({'samples': [case]})['comparableCount'], 0)

        for change in ('missing_egress', 'unknown_inclusion', 'missing_source', 'wrong_scope', 'different_pin', 'different_time'):
            with self.subTest(change=change):
                changed = copy.deepcopy(document)
                candidate = changed['samples'][0]['after']
                coverage = candidate['walkingCoverageEvidence']
                if change == 'missing_egress':
                    coverage.pop()
                elif change == 'unknown_inclusion':
                    coverage[-1]['included'] = None
                elif change == 'missing_source':
                    coverage[-1]['evidence'] = ''
                elif change == 'wrong_scope':
                    coverage[-1]['scope'] = 'TRANSFER'
                elif change == 'different_pin':
                    candidate['requestedCoordinateEvidence']['destination']['lat'] += 0.01
                else:
                    candidate['requestedDepartureAt'] = '2026-10-05T10:59:00Z'
                self.assertEqual(comparison.paired_map_report(changed)['comparableCount'], 0)

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

    def mixed_worker_fixture(self, bus_first):
        # Substitutes a synthetic bus for one of the rides to exercise both data shapes.
        # This is not a mixed-route provider capture.
        worker = self.recorded_worker()
        snapshot = worker['effectiveSnapshot']
        route = snapshot['effectiveTransitRoute']
        route['provider'] = 'odsay'
        index = 1 if bus_first else 3
        timing = route['segments'][index].pop('rideTiming')
        board, alight = timing['predictedBoardingAt'], timing['predictedArrivalAt']
        board = comparison.instant(board) + comparison.dt.timedelta(milliseconds=250)
        route['segments'][index].update(kind='BUS', busRidePrediction={
            'boardingAt': board.isoformat(), 'alightingAt': alight, 'sourceUpdatedAt': worker['evaluatedAt']})
        service = {'routeId': '100100585', 'direction': '서대문 방면', 'vehicleKey': 'a' * 64,
                   'boarding': {'stationId': '100000111', 'arsId': '01011', 'order': 75},
                   'alighting': {'stationId': '100000222', 'arsId': '01012', 'order': 76}}
        snapshot['lastAcceptedSeoulBusJourney'] = {'routeIdentity': route['identity'],
            'departureAt': route['departureAt'], 'rides': [{'sequence': index, 'service': service}]}
        previous = comparison.instant(route['segments'][1]['busRidePrediction']['alightingAt'] if bus_first
                                      else route['segments'][1]['rideTiming']['predictedArrivalAt'])
        onward = comparison.instant(route['segments'][3]['rideTiming']['predictedBoardingAt']) if bus_first else board
        walk = route['segments'][2]['durationSeconds']
        ready = previous + comparison.dt.timedelta(seconds=walk)
        route['segments'][3]['transferTiming'] = {'previousArrivalAt': previous.isoformat(),
            'physicalReadyAt': ready.isoformat(), 'boardingAt': onward.isoformat(), 'walkingSeconds': walk,
            'requiredMarginSeconds': 60, 'remainingSlackSeconds': 37}
        return worker

    def test_mixed_worker_export_keeps_public_stop_occurrences_and_separates_each_wait(self):
        for bus_first in (True, False):
            with self.subTest(bus_first=bus_first):
                result = comparison.worker_prediction(self.mixed_worker_fixture(bus_first), 'synthetic-mixed-worker')
                bus = result['rides'][0 if bus_first else 1]
                self.assertEqual((bus['mode'], bus['line'], bus['from'], bus['to']),
                                 ('BUS', 'SEOUL_BUS:100100585', '100000111:01011:75', '100000222:01012:76'))
                self.assertIn('.250000', bus['boardingAt'])
                self.assertEqual(bus['boardingClockKind'], 'STATION_ARRIVAL_PREDICTION')
                self.assertNotIn('vehicleKey', json.dumps(result))
                self.assertNotIn('a' * 64, json.dumps(result))
                self.assertIsNone(comparison.train_identities(result))
                budget = comparison.timeline_budget(result)
                access = budget['providerAccessComponents']
                self.assertEqual(access['walkingSeconds'], 111)
                self.assertEqual(access['waitAfterWalkingSeconds'], 155.25 if bus_first else 155)
                transfer, = budget['providerTransferComponents']
                self.assertEqual(transfer['walkingSeconds'], 243)
                self.assertEqual(transfer['waitAfterWalkingSeconds'], 97 if bus_first else 97.25)
                self.assertEqual(transfer['remainingSlackSeconds'], 37)
                self.assertEqual(transfer['waitEndsAt'], 'BOARDING' if bus_first else 'STATION_ARRIVAL_PREDICTION')

    def test_mixed_worker_export_rejects_unbound_route_and_wrong_fractional_slack(self):
        for field in ('routeIdentity', 'departureAt', 'sequence', 'stopOrder', 'slack'):
            with self.subTest(field=field):
                worker = self.mixed_worker_fixture(False)
                snapshot = worker['effectiveSnapshot']
                binding = snapshot['lastAcceptedSeoulBusJourney']
                ride = binding['rides'][0]
                if field == 'routeIdentity': binding['routeIdentity'] = 'b' * 64
                elif field == 'departureAt': binding['departureAt'] = '2026-10-12T03:59:25Z'
                elif field == 'sequence': ride['sequence'] = 1
                elif field == 'stopOrder': ride['service']['boarding']['order'] = 76
                else: snapshot['effectiveTransitRoute']['segments'][3]['transferTiming']['remainingSlackSeconds'] = 38
                with self.assertRaises(ValueError):
                    comparison.worker_prediction(worker, 'contradictory-bus-route')

    def test_mixed_map_comparison_requires_exact_topology_and_does_not_identify_bus_vehicle(self):
        prediction = comparison.worker_prediction(self.mixed_worker_fixture(False), 'synthetic-mixed-worker')
        pins = {'origin': {'lat': 37.655, 'lng': 127.061}, 'destination': {'lat': 37.485, 'lng': 126.93},
                'evidence': 'exact synthetic pins'}
        prediction['requestedCoordinateEvidence'] = pins
        prediction['observedAt'] = '2026-10-12T03:57:00Z'
        prediction['walkingCoverageEvidence'] = [{'scope': scope, 'included': True, 'evidence': 'synthetic visible walk'}
                                                for scope in ('ACCESS', 'TRANSFER', 'EGRESS')]
        reference = copy.deepcopy(prediction)
        reference.update(id='map-synthetic-mixed', kind='MAP_PREDICTION',
                         displayedArrivalEvidence={'arrivalAt': '2026-10-12T05:07:00Z',
                                                   'scope': 'REQUESTED_DESTINATION', 'evidence': 'synthetic map clock'})
        reference['rides'][1].update(boardingClockKind='BOARDING', boardingAt='2026-10-12T04:57:00Z',
                                     publishedClockEvidence={'boardingAt': 'synthetic shown boarding'})
        strict = comparison.compare(prediction, reference)
        self.assertIn('BUS_VEHICLE_IDENTITY_UNCONFIRMED', strict['exclusionReasons'])
        self.assertIsNone(strict['rideDiagnostics'][1]['boardingDeltaSeconds'])
        self.assertIsNone(strict['rideDiagnostics'][1]['rideDurationDeltaSeconds'])
        paired = {'walkingComparisonScope': 'WHOLE_JOURNEY',
                  'samples': [{'id': 'synthetic-trip', 'before': prediction, 'after': prediction, 'naver': reference}]}
        report = comparison.paired_map_report(paired)
        self.assertEqual(report['comparableCount'], 1)
        self.assertIsNone(next(row for row in report['samples'][0]['after']['routeClockComparison']
                               if row['event'] == 'RIDE_2_BOARDING')['appMinusMapMinutes'])
        reference['rides'][1]['from'] = '100000111:01011:74'
        report = comparison.paired_map_report(paired)
        self.assertEqual(report['comparableCount'], 0)
        self.assertIn('VISIBLE_ROUTE_TOPOLOGY_UNCONFIRMED', report['samples'][0]['after']['exclusionReasons'])

    def test_mixed_walking_boundary_requires_the_same_ordered_bus_stop(self):
        prediction = comparison.worker_prediction(self.mixed_worker_fixture(False), 'synthetic-mixed-worker')
        bus = prediction['rides'][1]
        access, transfer, egress = prediction['walkingBoundaryEvidence']
        access.update(to={'kind': 'STATION_PLATFORM', 'id': 'platform-in'}, stationInteriorCoverage='INCLUDED_TO_PLATFORM')
        transfer.update(**{'from': {'kind': 'STATION_PLATFORM', 'id': 'platform-out'},
                           'to': {'kind': 'BUS_STOP', 'id': bus['from']},
                           'stationInteriorCoverage': 'INCLUDED_TO_PLATFORM'})
        egress.update(**{'from': {'kind': 'BUS_STOP', 'id': bus['to']}, 'stationInteriorCoverage': 'EXCLUDED'})
        self.assertIsNotNone(comparison.walking_boundaries(prediction))
        transfer['to']['id'] = '100000111:01011:74'
        self.assertIsNone(comparison.walking_boundaries(prediction))
        self.assertIsNone(comparison.walking_boundaries(prediction, require_platform_coverage=False))

    def test_worker_export_keeps_current_departure_separate_from_protected_alarm(self):
        worker = self.recorded_worker()
        worker['comparisonRequestedDepartureAt'] = worker['recommendedDepartureAt']
        result = comparison.worker_prediction(worker, 'recorded-worker.json')
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        self.assertEqual(result['requestedDepartureAt'], route['departureAt'])
        self.assertEqual(result['protectedAlarmDepartureAt'], worker['recommendedDepartureAt'])
        self.assertNotEqual(result['requestedDepartureAt'], result['protectedAlarmDepartureAt'])
        self.assertEqual(result['comparisonRequestedDepartureAt'], worker['comparisonRequestedDepartureAt'])
        self.assertEqual(result['arrivalAt'], route['arrivalAt'])
        self.assertEqual(result['rides'][0]['trainIdentity']['number'], '4095')
        self.assertEqual(result['rides'][0]['boardingAt'], '2026-10-12T04:03:50Z')
        self.assertFalse(result['simulatorE2eVerified'])
        self.assertFalse(result['realWorldAccuracyVerified'])

    def test_fixed_departure_diagnostic_keeps_only_matching_complete_timetable(self):
        worker = self.recorded_worker()
        worker['journeyProvider'] = 'tmap'
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        shift = comparison.dt.timedelta(seconds=600)

        def shifted(value):
            return (comparison.instant(value) + shift).isoformat()

        legs = []
        for segment in route['segments']:
            if segment['kind'] == 'WALK':
                legs.append({'mode': 'WALK', 'walkingScope': segment['walkingScope'],
                             'movementSeconds': segment['durationMinutes'] * 60})
                continue
            timing = segment['rideTiming']
            table = timing['timetable'].copy()
            table.update(boardingAt=shifted(timing['predictedBoardingAt']),
                         arrivalAt=shifted(timing['predictedArrivalAt']), trainNumber='later-' + table['trainNumber'])
            legs.append({'mode': 'SUBWAY', 'timingBasis': 'TIMETABLE', 'timetable': table})
        departure = shifted(route['departureAt'])
        worker['comparisonRequestedDepartureAt'] = departure
        candidate = {'method': 'enrich', 'provider': 'tmap', 'requestedDepartureAt': departure,
                     'departureAt': departure, 'arrivalAt': shifted(route['arrivalAt']), 'legs': legs}
        wrong_route = copy.deepcopy(candidate)
        next(leg for leg in wrong_route['legs'] if leg['mode'] == 'SUBWAY')['timetable']['directionCode'] = 'UP'
        worker['journeyTimingTrace'] = {
            'classification': 'PASSIVE_REAL_JOURNEY_TIMING_TRACE', 'responseModified': False,
            'events': [candidate | {'departureAt': route['departureAt']}, wrong_route,
                       candidate | {'legs': legs[:-1]}, candidate],
        }

        result = comparison.fixed_departure_diagnostic(worker, 'recorded-worker.json')
        observed, = result['candidates']
        self.assertEqual(result['acceptedDepartureAt'], route['departureAt'])
        self.assertEqual(result['requestedDepartureAt'], departure)
        self.assertEqual(observed['lastStationArrivalDeltaSeconds'], 600)
        self.assertEqual(observed['destinationArrivalDeltaSeconds'], 600)
        self.assertTrue(observed['evidence'].endswith('events[3]'))
        self.assertNotIn('withinTwoMinutes', result)

        worker['journeyTimingTrace']['responseModified'] = True
        with self.assertRaisesRegex(ValueError, 'Unmodified Worker timing trace'):
            comparison.fixed_departure_diagnostic(worker, 'modified-worker.json')

    def test_worker_export_does_not_promote_station_coordinates_to_platform_equality(self):
        worker = self.recorded_worker()
        worker['requestedCoordinates'] = {'origin': {'lat': 37.65, 'lng': 127.06},
                                          'destination': {'lat': 37.48, 'lng': 126.93}}
        result = comparison.worker_prediction(worker, 'recorded-worker.json')
        self.assertEqual(result['requestedCoordinateEvidence'], {
            **worker['requestedCoordinates'], 'evidence': 'recorded-worker.json#requestedCoordinates',
        })
        self.assertIsNone(comparison.walking_boundaries(result))
        other = copy.deepcopy(result)
        other.update(id='same-captured-result', kind='MAP_PREDICTION')
        pair = comparison.compare(result, other)
        self.assertIn('WALKING_BOUNDARIES_UNCONFIRMED', pair['exclusionReasons'])
        self.assertIsNone(pair['withinTwoMinutes'])
        self.assertTrue(all(w['stationInteriorCoverage'] == 'UNKNOWN' for w in result['walkingBoundaryEvidence']))

    def test_worker_export_keeps_routed_egress_endpoint_distinct_from_requested_pin(self):
        worker = self.recorded_worker()
        egress = worker['effectiveSnapshot']['effectiveTransitRoute']['segments'][-1]
        origin = {'lat': 37.484, 'lng': 126.93}
        pin = {'lat': 37.48427, 'lng': 126.92977}
        routed = {'lat': 37.48428, 'lng': 126.92977}
        egress['walkingGeometry'] = {'from': origin, 'to': routed, 'endpointBasis': 'PROVIDER_PATH_ENDPOINTS',
                                      'providerQueryEndpoints': {'start': origin, 'end': pin}}
        result = comparison.worker_prediction(worker, 'recorded-worker-with-verified-egress')
        self.assertEqual(result['providerWalkingPathEndpoints'], [{'scope': 'EGRESS',
            'pathStart': origin, 'pathEnd': routed, 'requestedStart': origin, 'requestedEnd': pin}])
        self.assertIsNone(comparison.walking_boundaries(result))

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

    def test_station_arrival_prediction_is_not_a_boarding_or_in_vehicle_delta(self):
        self.left['rides'][0]['boardingClockKind'] = 'STATION_ARRIVAL_PREDICTION'
        self.right['rides'][0].update(boardingAt='2026-10-05T11:06:00Z', arrivalAt='2026-10-05T11:56:00Z')
        result = comparison.compare(self.left, self.right)
        ride = result['rideDiagnostics'][0]
        self.assertIsNone(ride['boardingDeltaSeconds'])
        self.assertIsNone(ride['stationArrivalPredictionDeltaSeconds'])
        self.assertIsNone(ride['rideDurationDeltaSeconds'])
        self.assertEqual(ride['alightingDeltaSeconds'], -60)
        self.assertEqual(result['timelineDiagnostic']['leftBudget']['rideStartClockKinds'], ['STATION_ARRIVAL_PREDICTION'])
        self.assertEqual(result['timelineDiagnostic']['reconstructedArrivalDeltaSeconds'], 0)

        self.right['rides'][0]['boardingClockKind'] = 'STATION_ARRIVAL_PREDICTION'
        ride = comparison.compare(self.left, self.right)['rideDiagnostics'][0]
        self.assertEqual(ride['stationArrivalPredictionDeltaSeconds'], -60)
        self.assertIsNone(ride['boardingDeltaSeconds'])

    def test_worker_export_marks_arrival_based_live_clocks_only(self):
        worker = self.recorded_worker()
        rides = [segment['rideTiming'] for segment in worker['effectiveSnapshot']['effectiveTransitRoute']['segments']
                 if segment['kind'] == 'SUBWAY']
        for has_station_clock in (False, True):
            with self.subTest(has_station_clock=has_station_clock):
                for timing in rides:
                    timing['timetable']['boardingStationArrivalAt'] = timing['timetable']['boardingAt'] if has_station_clock else None
                result = comparison.worker_prediction(worker, 'recorded-worker-with-arrival-event')
                self.assertEqual([ride['boardingClockKind'] for ride in result['rides']],
                                 ['STATION_ARRIVAL_PREDICTION', 'BOARDING'])

    def test_planned_station_arrival_does_not_become_a_map_boarding_difference(self):
        worker = self.recorded_worker()
        timing = next(segment['rideTiming'] for segment in worker['effectiveSnapshot']['effectiveTransitRoute']['segments']
                      if segment['kind'] == 'SUBWAY')
        reference = comparison.worker_prediction(worker, 'station-clock')
        public = reference['rides'][0]
        public['boardingAt'] = comparison.instant(public['boardingAt']).replace(second=0, microsecond=0).isoformat()
        public.update(boardingClockKind='BOARDING', publishedClockEvidence={'boardingAt': 'displayed boarding'})
        reference['displayedArrivalEvidence'] = {'arrivalAt': comparison.instant(reference['arrivalAt']).replace(
            second=0, microsecond=0).isoformat()}
        for basis, flag, expected in (
            ('PLANNED_RIDE_BOARDING_REALTIME', None, 'STATION_ARRIVAL_PREDICTION'),
            ('PLANNED_RIDE_ALIGHTING_REALTIME', True, 'STATION_ARRIVAL_PREDICTION'),
            ('PLANNED_RIDE_BASELINE', True, 'STATION_ARRIVAL_PREDICTION'),
            ('PLANNED_RIDE_ALIGHTING_REALTIME', False, 'BOARDING'),
            ('PLANNED_RIDE_BASELINE', None, 'BOARDING'),
            ('TRANSFER_ALIGHTING_REALTIME', None, 'BOARDING'),
            ('FUTURE_UNRECOGNIZED_BASIS', None, 'UNKNOWN'),
        ):
            with self.subTest(basis=basis, flag=flag):
                timing.update(basis=basis, plannedBoardingIsStationArrival=flag)
                app = comparison.worker_prediction(worker, 'station-clock')
                self.assertEqual(app['rides'][0]['boardingClockKind'], expected)
                clocks = comparison.paired_route_clocks(app, reference)
                boarding = next(clock for clock in clocks if clock['event'] == 'RIDE_1_BOARDING')
                self.assertEqual(boarding['appMinusMapMinutes'], 0 if expected == 'BOARDING' else None)

    def test_worker_distinguishes_walk_wait_and_unused_slack(self):
        worker = self.recorded_worker()
        segments = worker['effectiveSnapshot']['effectiveTransitRoute']['segments']
        first, onward = [segment for segment in segments if segment['kind'] == 'SUBWAY']
        transfer_walk = segments[first['sequence'] + 1]
        walking = transfer_walk.get('durationSeconds') or transfer_walk['durationMinutes'] * 60
        alight = comparison.instant(first['rideTiming']['predictedArrivalAt'])
        board = comparison.instant(onward['rideTiming']['predictedBoardingAt'])
        wait = int((board - alight).total_seconds()) - walking
        onward['transferTiming'] = {'previousArrivalAt': alight.isoformat(), 'boardingAt': board.isoformat(),
                                    'walkingSeconds': walking, 'requiredMarginSeconds': 25,
                                    'physicalReadyAt': (alight + comparison.dt.timedelta(seconds=walking)).isoformat(),
                                    'remainingSlackSeconds': wait - 25}
        result = comparison.worker_prediction(worker, 'recorded-worker-with-transfer-components')
        budget = comparison.timeline_budget(result)
        actual, = budget['providerTransferComponents']
        self.assertEqual((actual['walkingSeconds'], actual['waitAfterWalkingSeconds'], actual['remainingSlackSeconds']),
                         (walking, wait, wait - 25))
        self.assertEqual(actual['waitEndsAt'], 'BOARDING')
        onward['transferTiming']['walkingSeconds'] = walking - 1
        with self.assertRaises(ValueError):
            comparison.worker_prediction(worker, 'contradictory-components')

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
