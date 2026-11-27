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
        self.worker['comparisonRequestedDepartureAt'] = '2026-10-12T21:17:00+09:00'
        self.assertIn('ORIGINAL_COMPARISON_DEPARTURE_MISMATCH',
                      verifier.compare(self.worker, self.public, self.map)['exclusionReasons'])

    def mixed(self, bus_first=False):
        worker, public, display = copy.deepcopy(self.worker), copy.deepcopy(self.public), copy.deepcopy(self.map)
        snapshot = worker['effectiveSnapshot']
        route = snapshot['effectiveTransitRoute']
        route['provider'] = 'odsay'
        index = 0 if bus_first else 1
        segment = [seg for seg in route['segments'] if seg['kind'] != 'WALK'][index]
        rail_timing = segment.pop('rideTiming')
        segment.update(kind='BUS', lineName='461', fromName='대림초등학교', toName='신림동별빛거리입구',
                       busRidePrediction={'boardingAt': rail_timing['predictedBoardingAt'],
                                          'alightingAt': rail_timing['predictedArrivalAt']})
        service = {'routeId': '100100585', 'direction': '남쪽', 'vehicleKey': 'a' * 64,
                   'boarding': {'stationId': '100000111', 'arsId': '01011', 'order': 75},
                   'alighting': {'stationId': '100000222', 'arsId': '01012', 'order': 76}}
        snapshot['lastAcceptedSeoulBusJourney'] = {'routeIdentity': route['identity'], 'departureAt': route['departureAt'],
                                                 'rides': [{'sequence': segment['sequence'], 'service': service}]}
        public.update(effectiveTransitRoute=copy.deepcopy(route), confidence='MEDIUM')
        display['rides'][index] = {'kind': 'BUS', 'line': '461', 'fromName': segment['fromName'], 'toName': segment['toName']}
        bus_label = '간선 대림초등학교 461 하차 신림동별빛거리입구'
        rail_label = '지하철 2호선 사당역' if bus_first else '지하철 4호선 노원역'
        route = f'{bus_label} {rail_label}' if bus_first else f'{rail_label} {bus_label}'
        chips = '간선버스 9분 도보 3분 2호선지하철 48분' if bus_first else '4호선지하철 48분 도보 3분 간선버스 9분'
        display['routeEvidenceLabel'] = f'1시간09분 오후 10:25 도착 도보 1분 {chips} 도보 2분 {route} 상세보기'
        display['visibleEvidenceLabels'] = [display['visibleEvidenceLabels'][0], display['routeEvidenceLabel'],
                                           display['visibleEvidenceLabels'][3 if bus_first else 2]]
        return worker, public, display

    def test_mixed_display_supports_the_actual_medium_confidence_and_missing_bus_clock(self):
        for bus_first in (False, True):
            with self.subTest(bus_first=bus_first):
                worker, public, display = self.mixed(bus_first)
                verifier.verify_snapshot(display, '\n'.join(display['visibleEvidenceLabels']))
                result = verifier.compare(worker, public, display)
                self.assertEqual(result['result'], 'DISPLAY_COMPARED')
                self.assertEqual(result['nominalArrivalDeltaSeconds'], 0)
                self.assertIsNone(result['naverVisibleBoardingClocks'][0 if bus_first else 1])
                self.assertEqual(result['appBusRides'][0]['routeId'], '100100585')
                self.assertFalse(result['visibleBusStopArsVerified'])
                self.assertFalse(result['sameBusVehicleIdentityVerified'])
                self.assertFalse(result['stationPlatformWalkingCoverageVerified'])
                self.assertNotIn('vehicleKey', json.dumps(result))
                self.assertEqual(result['naverVisibleComponents']['visibleWalkingMinutes'], {'access': 1, 'transfers': [3], 'egress': 2})
                self.assertEqual(result['naverVisibleComponents']['unallocatedDisplayedMinutes'], 6)
                self.assertEqual(len(result['appTimingComponents']['rideSeconds']), 2)

    def test_mixed_display_does_not_infer_an_unlisted_walk_or_an_unverified_bus_occurrence(self):
        worker, public, display = self.mixed()
        display['routeEvidenceLabel'] = display['routeEvidenceLabel'].replace('도보 2분 ', '')
        display['visibleEvidenceLabels'][1] = display['routeEvidenceLabel']
        display['rides'][1].update(fromArs='01011', toArs='01012', fromArsLabel='대림초등학교 ARS 01011',
                                  toArsLabel='신림동별빛거리입구 ARS 01012')
        snapshot = '\n'.join([*display['visibleEvidenceLabels'], '대림초등학교 ARS 01011', '신림동별빛거리입구 ARS 01012'])
        verifier.verify_snapshot(display, snapshot)
        result = verifier.compare(worker, public, display)
        self.assertTrue(result['visibleBusStopArsVerified'])
        self.assertFalse(result['busStopOccurrencesVerified'])
        self.assertIsNone(result['naverVisibleComponents']['visibleWalkingMinutes']['egress'])
        self.assertIsNone(result['naverVisibleComponents']['unallocatedDisplayedMinutes'])

    def test_mixed_display_rejects_a_different_bus_stop_or_bus_route(self):
        worker, public, display = self.mixed()
        self.assertEqual(verifier.compare(worker, public, display)['result'], 'DISPLAY_COMPARED')
        for key, value in [('line', '506'), ('toName', '다른 정류장')]:
            changed = copy.deepcopy(display)
            changed['rides'][1][key] = value
            self.assertIn('VISIBLE_ROUTE_MISMATCH', verifier.compare(worker, public, changed)['exclusionReasons'])
        display['rides'][1]['toArs'] = '01013'
        self.assertIn('VISIBLE_BUS_STOP_ARS_MISMATCH', verifier.compare(worker, public, display)['exclusionReasons'])
        worker['effectiveSnapshot']['lastAcceptedSeoulBusJourney']['routeIdentity'] = 'other'
        with self.assertRaises(ValueError):
            verifier.compare(worker, public, display)

    def test_mixed_snapshot_cannot_choose_a_route_from_two_bus_numbers_or_an_unlinked_arrival(self):
        _, _, display = self.mixed()
        for text in (display['routeEvidenceLabel'].replace('461 하차', '461 506 하차'),
                     display['routeEvidenceLabel'].replace('10:25 도착', '10:26 도착')):
            changed = copy.deepcopy(display)
            changed['routeEvidenceLabel'] = changed['visibleEvidenceLabels'][1] = text
            with self.assertRaises(ValueError):
                verifier.verify_snapshot(changed, '\n'.join(changed['visibleEvidenceLabels']))
        display['rides'][1]['toArs'] = '01012'
        with self.assertRaises(ValueError):
            verifier.verify_snapshot(display, '\n'.join(display['visibleEvidenceLabels']))

    def expanded_mixed_snapshot(self, display, bus_first):
        routes = [f'- button "{display["routeEvidenceLabel"]}" [expanded]',
                  '- button "다른 경로 상세보기"']
        boarding, alighting = ('2호선사당역', '신림역') if bus_first else ('4호선노원역', '사당역')
        return '\n'.join([display['visibleEvidenceLabels'][0], *routes, display['visibleEvidenceLabels'][2],
                          f'- button "{boarding} 승차 파노라마 보기"', f'- button "도보 3분 {alighting} 하차 파노라마 보기"'])

    def test_mixed_route_selection_requires_fresh_expanded_rail_alighting_evidence(self):
        for bus_first in (True, False):
            worker, _, display = self.mixed(bus_first)
            display['arrivalClockRounding'] = 'UNKNOWN'
            order = 'bus-rail' if bus_first else 'rail-bus'
            departure = verifier.instant(display['requestedDepartureAt'])
            now = verifier.instant(worker['evaluatedAt'])
            snapshot = self.expanded_mixed_snapshot(display, bus_first)
            request = verifier.public_mixed_route_request(display, snapshot, order=order, departure=departure, now=now)
            self.assertEqual(request['route']['railTo'], '신림' if bus_first else '사당')
            self.assertEqual(request['route']['busNumber'], '461')
            with self.assertRaises(ValueError):
                verifier.public_mixed_route_request(display, snapshot.replace(' [expanded]', ''),
                                                     order=order, departure=departure, now=now)
            with self.assertRaises(ValueError):
                verifier.public_mixed_route_request(display, snapshot.replace('역 하차 파노라마', '역 파노라마'),
                                                     order=order, departure=departure, now=now)
            with self.assertRaises(ValueError):
                verifier.public_mixed_route_request(dict(display, observedAt='2026-10-12T21:09:00+09:00'), snapshot,
                                                     order=order, departure=departure, now=now)

    def test_mixed_route_selection_rejects_worker_reselection_even_with_the_same_bus_name(self):
        worker, _, display = self.mixed()
        departure = verifier.instant(display['requestedDepartureAt'])
        request = verifier.public_mixed_route_request(display, self.expanded_mixed_snapshot(display, False),
            order='rail-bus', departure=departure, now=verifier.instant(worker['evaluatedAt']))
        worker['comparisonRequestedDepartureAt'] = display['requestedDepartureAt']
        seed = {'legs': [{'mode': 'BUS', 'line': {'localRouteId': '100100585'},
                          'from': {'localStopId': '100000111'}, 'to': {'localStopId': '100000222'}}]}
        self.assertTrue(verifier.matches_public_mixed_route(worker, seed, request, order='rail-bus'))
        service = worker['effectiveSnapshot']['lastAcceptedSeoulBusJourney']['rides'][0]['service']
        service['routeId'] = '100100586'
        self.assertFalse(verifier.matches_public_mixed_route(worker, seed, request, order='rail-bus'))
        service['routeId'] = seed['legs'][0]['line']['localRouteId']
        worker['effectiveSnapshot']['effectiveTransitRoute']['departureAt'] = '2026-10-12T21:15:00+09:00'
        self.assertFalse(verifier.matches_public_mixed_route(worker, seed, request, order='rail-bus'))

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
        for mutation in ('expired', 'api_error', 'changed_route', 'normal', 'mixed_ride'):
            w, p = copy.deepcopy(worker), copy.deepcopy(public)
            if mutation == 'expired':
                p['_isolationReadWindow']['finishedAt'] = w['effectiveSnapshot']['effectiveTransitRoute']['departureAt']
            elif mutation == 'api_error': w['failureReason'] = p['failureReason'] = 'TRANSIT_ARRIVAL_API_ERROR: safe'
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
