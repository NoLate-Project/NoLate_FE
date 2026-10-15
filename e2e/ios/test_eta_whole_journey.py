import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('verify-eta-fixture.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class WholeJourneyEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.public = {'routeChanged': False, 'effectiveTransitRoute': {'segments': [
            {'kind': kind, 'durationMinutes': minutes}
            for kind, minutes in zip(['WALK', 'SUBWAY', 'WALK', 'SUBWAY', 'WALK'], [2, 22, 5, 11, 3])
        ]}}
        self.snapshot = {'effectiveTransitRoute': copy.deepcopy(self.public['effectiveTransitRoute'])}

    def test_full_corrected_journey_is_accepted(self):
        fixture.verify_current_journey(self.public, self.snapshot, 'success')

    def test_saved_ride_duration_cannot_pass_as_corrected(self):
        self.public['effectiveTransitRoute']['segments'][1]['durationMinutes'] = 49
        with self.assertRaises(AssertionError):
            fixture.verify_current_journey(self.public, self.snapshot, 'success')

    def test_omitting_transfer_walk_is_rejected(self):
        self.public['effectiveTransitRoute']['segments'].pop(2)
        with self.assertRaises(AssertionError):
            fixture.verify_current_journey(self.public, self.snapshot, 'success')

    def test_public_api_must_equal_persisted_worker_snapshot(self):
        self.snapshot['effectiveTransitRoute']['segments'][1]['durationMinutes'] = 25
        with self.assertRaises(AssertionError):
            fixture.verify_current_journey(self.public, self.snapshot, 'success')


class UncertainAlarmEvidenceTest(unittest.TestCase):
    def setUp(self):
        alarm = {'operation': 'UPSERT', 'generation': 2, 'trigger_at': '2026-10-05T14:30:00Z'}
        self.worker = {
            'alarmQualityBoundary': True, 'evaluatedAt': '2026-10-05T14:00:00Z',
            'recommendedDepartureAt': '2026-10-05T13:59:00Z',
            'alarmBeforeEvaluation': [alarm], 'alarmStates': [copy.deepcopy(alarm)],
            'retryCount': 0, 'workerFailure': None,
        }

    def test_identical_future_alarm_survives_past_uncertain_eta(self):
        fixture.verify_uncertain_alarm_boundary(self.worker)

    def test_cancel_or_generation_change_cannot_pass(self):
        for field, value in [('operation', 'CANCEL'), ('generation', 3)]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.worker)
                changed['alarmStates'][0][field] = value
                with self.assertRaises(AssertionError):
                    fixture.verify_uncertain_alarm_boundary(changed)

    def test_already_past_alarm_is_not_this_boundary(self):
        self.worker['alarmBeforeEvaluation'][0]['trigger_at'] = '2026-10-05T13:59:00Z'
        with self.assertRaises(AssertionError):
            fixture.verify_uncertain_alarm_boundary(self.worker)

    def test_failed_worker_does_not_prove_alarm_preservation(self):
        self.worker['retryCount'] = 1
        with self.assertRaises(AssertionError):
            fixture.verify_uncertain_alarm_boundary(self.worker)


class EgressInclusionEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.epoch = fixture.instant('2026-10-06T12:00:00Z')

    def public(self, phase, extra_seconds=0):
        seconds, minutes = (2452, 41) if phase == 'success' else (2752, 46)
        arrival = (self.epoch + fixture.dt.timedelta(seconds=seconds + extra_seconds)).isoformat()
        return {'predictedArrivalAt': arrival, 'travelMinutes': minutes,
                'effectiveTransitRoute': {'departureAt': self.epoch.isoformat(),
                    'arrivalAt': arrival, 'totalMinutes': minutes,
                    'segments': [{'kind': 'WALK', 'walkingScope': 'EGRESS', 'durationSeconds': 171}]}}

    def test_egress_is_included_once_after_both_original_and_reconnected_train(self):
        for phase in ('success', 'reconnect'):
            fixture.verify_egress_included_once(self.public(phase), self.epoch, phase)

    def test_omitted_or_double_counted_egress_is_rejected(self):
        for phase in ('success', 'reconnect'):
            for extra in (-171, 171):
                with self.subTest(phase=phase, extra=extra), self.assertRaises(AssertionError):
                    fixture.verify_egress_included_once(self.public(phase, extra), self.epoch, phase)

    def test_duplicated_or_missing_egress_segment_is_rejected(self):
        for count in (0, 2):
            public = self.public('success')
            public['effectiveTransitRoute']['segments'] *= count
            with self.assertRaises(AssertionError):
                fixture.verify_egress_included_once(public, self.epoch, 'success')

    def test_api_arrival_and_rounded_headline_must_agree_with_exact_walk(self):
        for field, value in [('arrivalAt', self.epoch.isoformat()), ('totalMinutes', 44)]:
            public = self.public('success')
            public['effectiveTransitRoute'][field] = value
            with self.assertRaises(AssertionError):
                fixture.verify_egress_included_once(public, self.epoch, 'success')


class WalkingMetadataEvidenceTest(unittest.TestCase):
    def setUp(self):
        geometries = fixture.expected_walking_geometries()
        self.public = {'effectiveTransitRoute': {'segments': [
            {'kind': 'WALK', 'walkingScope': scope, 'durationSeconds': seconds, 'walkingGeometry': geometry}
            for scope, seconds, geometry in zip(['ACCESS', 'TRANSFER', 'EGRESS'], [111, 243, 171], geometries)
        ]}}
        self.snapshot = copy.deepcopy(self.public)

    def test_original_seconds_and_boundaries_are_retained(self):
        fixture.verify_walking_metadata(self.public, self.snapshot)

    def test_changed_time_role_or_synthesized_boundary_cannot_pass(self):
        for field, value in [('durationSeconds', 300), ('walkingScope', 'ACCESS'),
                             ('walkingGeometry', {'from': None, 'to': None, 'distanceMeters': 155})]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.public)
                changed['effectiveTransitRoute']['segments'][1][field] = value
                with self.assertRaises(AssertionError):
                    fixture.verify_walking_metadata(changed, copy.deepcopy(changed))

    def test_api_must_match_persisted_walking_metadata(self):
        self.snapshot['effectiveTransitRoute']['segments'][0]['durationSeconds'] = 120
        with self.assertRaises(AssertionError):
            fixture.verify_walking_metadata(self.public, self.snapshot)

    def test_polyline_or_platform_claim_cannot_be_synthesized_or_dropped(self):
        for mutation in ('drop', 'claim', 'replace_endpoint', 'wrong_coordinate'):
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                changed = copy.deepcopy(self.public)
                geometry = changed['effectiveTransitRoute']['segments'][0]['walkingGeometry']
                if mutation == 'drop':
                    geometry.pop('pathEvidence')
                elif mutation == 'claim':
                    geometry['pathEvidence']['stationInteriorCoverage'] = 'INCLUDED_TO_PLATFORM'
                elif mutation == 'replace_endpoint':
                    geometry['endpointBasis'] = 'STATION_PLATFORM'
                else:
                    geometry['pathEvidence']['steps'][0]['coordinates'][1]['lat'] = 0
                fixture.verify_walking_metadata(changed, copy.deepcopy(changed))


if __name__ == '__main__':
    unittest.main()
