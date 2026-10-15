"""Synthetic/replayed boundary accounting, not additional live API or UI executions."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('walking_boundaries', Path(__file__).with_name('verify-eta-walking-boundaries.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class WalkingBoundariesTest(unittest.TestCase):
    def sample(self):
        walk = lambda index, scope, seconds: {'sequence': index, 'kind': 'WALK',
            'walkingScope': scope, 'durationSeconds': seconds}
        ride = lambda index, boarding, arrival: {'sequence': index, 'kind': 'SUBWAY', 'rideTiming': {
            'predictedBoardingAt': f'2026-10-11T{boarding}+09:00',
            'predictedArrivalAt': f'2026-10-11T{arrival}+09:00'}}
        return {'departureAt': '2026-10-11T20:00:00+09:00', 'arrivalAt': '2026-10-11T21:00:00+09:00',
            'totalMinutes': 60, 'segments': [walk(0, 'ACCESS', 120), ride(1, '20:03:00', '20:43:00'),
                walk(2, 'TRANSFER', 120), ride(3, '20:50:00', '20:58:00'), walk(4, 'EGRESS', 120)]}

    def test_exact_seconds_include_walks_once_without_summing_rounded_waits(self):
        route = self.sample()
        route['segments'][1]['waitingMinutes'] = 999
        before = copy.deepcopy(route)
        result = audit.audit_route(route)
        self.assertEqual(result['timingResult'], 'PASSED')
        self.assertEqual(result['walkingSeconds'], 360)
        self.assertEqual(result['rideSeconds'], 2880)
        self.assertEqual(result['waitingAndMarginsSeconds'], 360)
        self.assertEqual(result['reconstructedSeconds'], result['elapsedSeconds'])
        self.assertEqual(result['postLastAlightingSeconds'], result['trailingWalkingSeconds'])
        self.assertEqual(route, before)
        self.assertFalse(result['etaOrAlarmModified'])
        self.assertFalse(result['stationInteriorCoverageVerified'])

    def test_missing_seconds_are_unknown_not_zero_or_rounded_minutes(self):
        for missing in (None, -1, True, 1.5):
            route = self.sample()
            route['segments'][0]['durationSeconds'] = missing
            route['segments'][0]['durationMinutes'] = 2
            result = audit.audit_route(route)
            self.assertEqual(result['timingResult'], 'UNVERIFIED')
            self.assertNotIn('walkingSeconds', result)

    def test_zero_seconds_are_explicit_evidence_not_missing(self):
        route = self.sample()
        route['segments'][0]['durationSeconds'] = 0
        self.assertEqual(audit.audit_route(route)['timingResult'], 'PASSED')
        self.assertEqual(audit.audit_route(route)['walkingSeconds'], 240)

    def test_double_egress_and_missing_egress_are_detected(self):
        for seconds in (0, 240):
            route = self.sample()
            route['segments'][-1]['durationSeconds'] = seconds
            result = audit.audit_route(route)
            self.assertEqual(result['timingResult'], 'FAILED')
            self.assertIn('FINAL_ARRIVAL_DOES_NOT_MATCH_TRAILING_WALK', result['reasons'])

    def test_wrong_walk_scope_and_conflicting_rounded_minutes_fail(self):
        route = self.sample()
        route['segments'][0]['walkingScope'] = 'EGRESS'
        self.assertIn('WALKING_SCOPE_POSITION_MISMATCH', audit.audit_route(route)['reasons'])
        route['segments'][0]['durationMinutes'] = 3
        self.assertIn('WALKING_SECONDS_MINUTES_MISMATCH', audit.audit_route(route)['reasons'])

    def test_access_and_transfer_that_miss_the_train_fail(self):
        for index in (0, 2):
            route = self.sample()
            route['segments'][index]['durationSeconds'] = 900
            self.assertIn('UNBOARDABLE_OR_REVERSED_RIDE', audit.audit_route(route)['reasons'])

    def test_bad_total_and_incomplete_ride_timing_cannot_pass(self):
        route = self.sample()
        route['totalMinutes'] = 59
        self.assertIn('TOTAL_DURATION_MISMATCH', audit.audit_route(route)['reasons'])
        route['segments'][1].pop('rideTiming')
        self.assertEqual(audit.audit_route(route)['timingResult'], 'UNVERIFIED')

    def test_malformed_ride_timing_is_invalid_evidence(self):
        route = self.sample()
        route['segments'][1]['rideTiming'] = ['not a timing object']
        with self.assertRaises(ValueError):
            audit.audit_route(route)

    def test_sequence_not_array_position_controls_the_route_and_duplicates_fail(self):
        route = self.sample()
        route['segments'].reverse()
        self.assertEqual(audit.audit_route(route)['timingResult'], 'PASSED')
        route['segments'][0]['sequence'] = route['segments'][1]['sequence']
        with self.assertRaises(ValueError):
            audit.audit_route(route)

    def test_polyline_gaps_do_not_become_made_up_path_or_time(self):
        route = self.sample()
        route['segments'][0]['walkingGeometry'] = {
            'from': {'lat': 0, 'lng': 0}, 'to': {'lat': 0, 'lng': 0.003}, 'distanceMeters': 999,
            'pathEvidence': {'status': 'PROVIDED', 'stationInteriorCoverage': 'UNKNOWN', 'steps': [
                {'coordinates': [{'lat': 0, 'lng': 0}, {'lat': 0, 'lng': 0.001}], 'distanceMeters': 50},
                {'coordinates': [{'lat': 0, 'lng': 0.002}, {'lat': 0, 'lng': 0.003}], 'distanceMeters': 60}]}}
        result = audit.audit_route(route)
        geometry = result['walkingLegs'][0]
        self.assertEqual(geometry['pathStartOffsetMeters'], 0)
        self.assertEqual(geometry['pathEndOffsetMeters'], 0)
        self.assertAlmostEqual(geometry['sumWithinStepPolylineMeters'], 222.39, places=2)
        self.assertEqual(geometry['interStepGapsMeters'], [111.2])
        self.assertEqual(geometry['sumProviderStepDistanceMeters'], 110)
        self.assertEqual(result['walkingSeconds'], 360)
        self.assertFalse(geometry['stationInteriorCoverageVerified'])

    def test_missing_path_and_missing_step_distance_stay_unknown(self):
        result = audit.audit_route(self.sample())
        self.assertIsNone(result['walkingLegs'][0]['pathEndOffsetMeters'])
        self.assertIsNone(result['walkingLegs'][0]['sumProviderStepDistanceMeters'])
        self.assertFalse(result['stationInteriorCoverageVerified'])

    def test_provided_path_requires_steps_and_missing_step_distances_are_not_zero(self):
        segment = self.sample()['segments'][0]
        segment['walkingGeometry'] = {'pathEvidence': {'status': 'PROVIDED', 'steps': []}}
        with self.assertRaises(ValueError):
            audit.geometry_diagnostic(segment)
        segment['walkingGeometry']['pathEvidence']['steps'] = [
            {'coordinates': [{'lat': 0, 'lng': 0}, {'lat': 0, 'lng': 0.001}]}]
        self.assertIsNone(audit.geometry_diagnostic(segment)['sumProviderStepDistanceMeters'])

    def test_invalid_nonfinite_coordinates_and_unbounded_paths_are_rejected(self):
        for value in ({'lat': float('nan'), 'lng': 127}, {'lat': 91, 'lng': 127}, {'lat': True, 'lng': 127}):
            with self.assertRaises(ValueError):
                audit.coordinate(value)
        segment = self.sample()['segments'][0]
        segment['walkingGeometry'] = {'pathEvidence': {'steps': [{}] * 33}}
        with self.assertRaises(ValueError):
            audit.geometry_diagnostic(segment)

    def test_recorded_real_route_accounting_does_not_verify_station_platform_coverage(self):
        # Replay of 10/9 output is a regression, not a new real-provider E2E.
        path = Path(__file__).parents[1] / 'evidence/2026-10-09-arrival-quality-real-repeat-evaluation-3.json'
        document = json.loads(path.read_text())
        result = audit.audit_document(document)
        self.assertEqual(result['timingResult'], 'PASSED')
        self.assertEqual(result['walkingSeconds'], 525)
        self.assertEqual(result['trailingWalkingSeconds'], 171)
        self.assertEqual(result['finalArrivalResidualSeconds'], 0)
        self.assertLess(result['walkingLegs'][0]['nominalEndpointSeparationMeters'], 3)
        self.assertEqual(result['walkingLegs'][0]['providerDistanceMeters'], 128)
        self.assertIsNone(result['walkingLegs'][1]['pathStartOffsetMeters'])
        self.assertFalse(result['realWorldAccuracyVerified'])

    def test_no_saved_or_last_accepted_route_substitution_on_missing_current_evidence(self):
        with self.assertRaises(ValueError):
            audit.audit_document({'effectiveSnapshot': {'lastAcceptedEffectiveTransitRoute': self.sample()}})

    def test_latest_real_accounting_pass_is_not_accepted_or_on_time_proof(self):
        # Replaying saved output adds no live calls or simulator executions.
        root = Path(__file__).parents[1] / 'evidence'
        values = [json.loads((root / f'2026-10-11-walking-boundary-evaluation-{i}.json').read_text())
                  for i in (1, 2, 3)]
        accepted = audit.audit_document(values[0])
        self.assertTrue(values[0]['effectiveSnapshot']['accepted'])
        self.assertEqual(accepted['timingResult'], 'PASSED')
        self.assertEqual(accepted['reconstructedSeconds'], 4071)
        self.assertEqual(accepted['walkingSeconds'], 525)
        self.assertEqual(accepted['waitingAndMarginsSeconds'], 216)
        self.assertEqual(accepted['trailingWalkingSeconds'], 171)
        # A timetable candidate can balance while real boarding is unconfirmed/unsafe.
        # Audit the current 21:02 candidate, not the protected 21:01 accepted route.
        unconfirmed = audit.audit_document(values[1])
        self.assertEqual(unconfirmed['timingResult'], 'PASSED')
        self.assertEqual(unconfirmed['elapsedSeconds'], 4011)
        self.assertFalse(values[1]['effectiveSnapshot']['accepted'])
        self.assertIsNone(values[1]['predictedArrivalAt'])
        late = audit.audit_document(values[2])
        self.assertEqual(late['timingResult'], 'PASSED')
        self.assertFalse(values[2]['effectiveSnapshot']['accepted'])
        self.assertTrue(values[2]['stale'])
        self.assertEqual((audit.instant(values[2]['predictedArrivalAt'])
                          - audit.instant(values[2]['targetArrivalAt'])).total_seconds(), 81)
        self.assertFalse(late['realWorldAccuracyVerified'])


if __name__ == '__main__':
    unittest.main()
