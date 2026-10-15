"""Synthetic display-comparison regressions, not a live map accuracy result."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('map_display', Path(__file__).with_name('verify-eta-map-display.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class MapDisplayTest(unittest.TestCase):
    def setUp(self):
        evidence = Path(__file__).parents[1] / 'evidence/2026-10-12-odsay-live-and-expiry'
        self.worker = json.loads((evidence / 'evaluation-2.json').read_text())
        self.public = json.loads((evidence / 'ui-status-2.json').read_text())
        self.worker['requestedCoordinates'] = {
            'origin': {'lat': 37.65636195, 'lng': 127.06342739},
            'destination': {'lat': 37.48426844, 'lng': 126.92977778}}
        self.map = {'provider': 'NAVER_MAP_PUBLIC_UI', 'mocked': False, 'queryMode': 'DEPART_AT',
            'requestedCoordinates': copy.deepcopy(self.worker['requestedCoordinates']),
            'requestedDepartureAt': '2026-10-12T21:16:00+09:00',
            'observedAt': '2026-10-12T21:15:00+09:00',
            'suggestedDepartureAt': '2026-10-12T21:16:00+09:00',
            'displayedArrivalAt': '2026-10-12T22:25:00+09:00',
            'arrivalClockRounding': 'UNKNOWN', 'snapshotEvidence': 'SYNTHETIC_TEST_ONLY',
            'rides': [
                {'kind': 'SUBWAY', 'line': 'LINE_4', 'fromName': '노원', 'toName': '사당',
                 'displayedBoardingAt': '2026-10-12T21:19:00+09:00', 'visibleTerminal': '오이도행'},
                {'kind': 'SUBWAY', 'line': 'LINE_2', 'fromName': '사당', 'toName': '신림',
                 'displayedBoardingAt': '2026-10-12T22:16:00+09:00', 'visibleTerminal': '내선순환행'}],
            'visibleEvidenceLabels': ['오늘 오후 09:16 출발', '도착 22:25 주소', '21:19오이도행', '22:16내선순환행']}

    def test_visible_gap_does_not_claim_train_platform_or_actual_accuracy(self):
        result = verifier.compare(self.worker, self.public, self.map)
        self.assertEqual(result['result'], 'DISPLAY_COMPARED')
        self.assertEqual(result['nominalArrivalDeltaSeconds'], 0)
        self.assertTrue(result['nominalDisplayGapWithinTwoMinutes'])
        self.assertEqual(result['appWalkingSeconds'], [60, 180, 60])
        for key in ('sameTrainIdentityVerified', 'stationPlatformWalkingCoverageVerified',
                    'mapAccuracyWithinTwoMinutesVerified', 'actualTripAccuracyVerified'):
            self.assertFalse(result[key])

    def test_protected_alarm_clock_is_not_the_comparison_departure(self):
        self.worker['recommendedDepartureAt'] = '2026-10-12T20:50:00+09:00'
        self.assertEqual(verifier.compare(self.worker, self.public, self.map)['result'], 'DISPLAY_COMPARED')

    def test_different_coordinate_departure_capture_or_line_is_excluded(self):
        cases = []
        changed = copy.deepcopy(self.map)
        changed['requestedCoordinates']['origin']['lat'] += 0.0001
        cases.append((changed, 'REQUEST_COORDINATES_MISMATCH'))
        changed = copy.deepcopy(self.map)
        changed['requestedDepartureAt'] = '2026-10-12T21:15:00+09:00'
        changed['observedAt'] = '2026-10-12T21:14:00+09:00'
        cases.append((changed, 'COMPUTED_DEPARTURE_MISMATCH'))
        changed = copy.deepcopy(self.map)
        changed['observedAt'] = '2026-10-12T21:09:00+09:00'
        cases.append((changed, 'CAPTURE_TIME_SKEW'))
        changed = copy.deepcopy(self.map)
        changed['rides'][0]['line'] = 'LINE_7'
        cases.append((changed, 'VISIBLE_ROUTE_MISMATCH'))
        for changed, reason in cases:
            with self.subTest(reason=reason):
                result = verifier.compare(self.worker, self.public, changed)
                self.assertIn(reason, result['exclusionReasons'])
                self.assertIsNone(result['nominalDisplayGapWithinTwoMinutes'])

    def test_degraded_worker_or_expired_api_cannot_be_compared_as_normal_eta(self):
        for side, key, value in [('worker', 'stale', True), ('worker', 'source', 'TIMETABLE_PROVIDER'),
                                  ('public', 'stale', True), ('public', 'confidence', 'LOW'),
                                  ('worker', 'providersMocked', True)]:
            worker, public = copy.deepcopy(self.worker), copy.deepcopy(self.public)
            (worker if side == 'worker' else public)[key] = value
            with self.subTest(side=side, key=key), self.assertRaises(ValueError):
                verifier.compare(worker, public, self.map)

    def preview(self):
        worker, public = copy.deepcopy(self.worker), copy.deepcopy(self.public)
        reason = 'TRANSIT_TRAIN_NOT_YET_OBSERVED: safe reason'
        worker.update(source='TIMETABLE_PROVIDER', stale=True, failureReason=reason, predictedArrivalAt=None)
        snapshot = worker['effectiveSnapshot']
        snapshot.update(accepted=False, transitTimingBasis='TIMETABLE_ONLY', firstBoardingObservation=None)
        route = snapshot['effectiveTransitRoute']
        for segment in route['segments']:
            if segment['kind'] != 'WALK':
                timing = segment['rideTiming']
                timing.update(basis='TIMETABLE', predictedBoardingAt=timing['timetable']['boardingAt'],
                              predictedArrivalAt=timing['timetable']['arrivalAt'])
        public.update(source=worker['source'], stale=True, failureReason=reason, predictedArrivalAt=None,
                      firstBoardingObservation=None, confidence='LOW',
                      effectiveTransitRoute=None, futureTimetablePrediction=copy.deepcopy(route),
                      _isolationReadWindow={'startedAt': worker['evaluatedAt'], 'finishedAt': worker['evaluatedAt']})
        return worker, public

    def test_explicit_future_preview_comparison_never_counts_as_normal_realtime(self):
        worker, public = self.preview()
        result = verifier.compare_timetable_preview(worker, public, self.map)
        self.assertEqual(result['result'], 'TIMETABLE_DISPLAY_COMPARED')
        self.assertFalse(result['acceptedRealtimeEtaVerified'])
        self.assertTrue(result['futureTimetableDisplayOnly'])
        self.assertFalse(result['actualTripAccuracyVerified'])
        with self.assertRaises(ValueError):
            verifier.compare(worker, public, self.map)

    def test_future_preview_rejects_expiry_stale_errors_and_changed_api_prediction(self):
        worker, public = self.preview()
        for mutation in ('expired', 'stale_error', 'changed_route', 'normal', 'mixed_ride'):
            w, p = copy.deepcopy(worker), copy.deepcopy(public)
            if mutation == 'expired':
                p['_isolationReadWindow']['finishedAt'] = w['effectiveSnapshot']['effectiveTransitRoute']['departureAt']
            elif mutation == 'stale_error': w['failureReason'] = p['failureReason'] = 'TRANSIT_ARRIVAL_SOURCE_STALE: safe'
            elif mutation == 'changed_route': p['futureTimetablePrediction']['arrivalAt'] = '2026-10-12T23:00:00Z'
            elif mutation == 'normal': w['source'] = 'LIVE_PROVIDER'
            else: w['effectiveSnapshot']['effectiveTransitRoute']['segments'][1]['rideTiming']['basis'] = 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                verifier.compare_timetable_preview(w, p, self.map)

    def test_unknown_rounding_cannot_be_replaced_by_an_invented_exact_clock(self):
        self.map['arrivalClockRounding'] = 'EXACT'
        with self.assertRaises(ValueError):
            verifier.compare(self.worker, self.public, self.map)

    def test_snapshot_labels_and_structured_clocks_must_agree(self):
        snapshot = '\n'.join(self.map['visibleEvidenceLabels'])
        verifier.verify_snapshot(self.map, snapshot)
        for key, value in [('displayedArrivalAt', '2026-10-12T22:26:00+09:00'),
                           ('requestedDepartureAt', '2026-10-12T21:17:00+09:00')]:
            changed = copy.deepcopy(self.map)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                verifier.verify_snapshot(changed, snapshot)
        with self.assertRaises(ValueError):
            verifier.verify_snapshot(self.map, 'unrelated map screenshot')


if __name__ == '__main__':
    unittest.main()
