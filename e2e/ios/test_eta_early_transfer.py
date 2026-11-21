"""Independent verifier regressions; synthetic inputs, no app or external API calls."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('early_transfer', Path(__file__).with_name('run-eta-early-transfer.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class EarlyTransferAuditTest(unittest.TestCase):
    def test_reported_boarding_chain_cannot_promote_pending_or_conditional_eta(self):
        import json
        fixture = json.loads(Path(__file__).with_name('fixtures').joinpath('reported-boarding-worker-chain.json').read_text())
        self.assertEqual(verifier.verify_reported_boarding(fixture['worker'], fixture['public'])['result'], 'PASSED')
        mutations = [
            lambda w, p: p.update(predictedArrivalAt=p['plannedJourneyArrivalPrediction']['predictedArrivalAt']),
            lambda w, p: p.update(recommendedDepartureAt=w['evaluatedAt']),
            lambda w, p: w['pendingUpdate'].update(route=w['provisionalPrediction']['effectiveTransitRoute']),
            lambda w, p: w.update(historyCount=2),
            lambda w, p: p['plannedJourneyArrivalPrediction']['effectiveTransitRoute']['segments'][3]['rideTiming']['observedService'].update(trainNumber='2012'),
            lambda w, p: p['plannedJourneyArrivalPrediction']['effectiveTransitRoute']['segments'][2].update(durationSeconds=120),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                worker, public = copy.deepcopy(fixture['worker']), copy.deepcopy(fixture['public'])
                mutate(worker, public)
                with self.assertRaises(AssertionError):
                    verifier.verify_reported_boarding(worker, public)

    def test_calendar_title_comes_from_one_actual_ui_save(self):
        marker = 'SYNTHETIC_SCHEDULE_EDITED_TITLE XCUITest 1793728000 edited\n'
        self.assertEqual(verifier.calendar_smoke_title('XCTest output\n' + marker),
                         'XCUITest 1793728000 edited')
        for text in ('', marker + marker, marker.replace('XCUITest 1793728000', 'personal schedule')):
            with self.subTest(text=text), self.assertRaises(AssertionError):
                verifier.calendar_smoke_title(text)

    def test_calendar_smoke_requires_one_owned_all_day_record_without_notifications(self):
        row = {'id': 364, 'ownerMemberId': 296, 'title': 'XCUITest 1793728000 edited',
               'startAt': '2026-11-03T15:00:00Z', 'allDay': True, 'notificationEnabled': False}
        saved = verifier.verify_calendar_smoke_record([{'id': 363, 'title': 'ETA E2E isolated fixture'}, row])
        self.assertEqual(saved['id'], 364)
        for key, value in (('id', 363), ('ownerMemberId', 297), ('allDay', False),
                           ('notificationEnabled', True), ('title', 'personal schedule')):
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verifier.verify_calendar_smoke_record([dict(row, **{key: value})])
        with self.assertRaises(AssertionError):
            verifier.verify_calendar_smoke_record([row, dict(row, id=365)])

    def test_planned_journey_rejects_origin_failure_leaks_or_changed_departure(self):
        worker = {'classification': 'SYNTHETIC_POST_DEPARTURE_WORKER',
            'database': 'H2_MEMORY_ONLY', 'providersMocked': True, 'physicalTransitHttpCalls': 0,
            'productionDatabaseModified': False, 'processed': 1, 'historyCount': 2,
            'inProgressPlanIdentity': 'a' * 64, 'beforeRecommendedDepartureAt': '2026-11-04T03:00:00Z',
            'provisionalPrediction': {'predictedArrivalAt': '2026-11-04T03:29:00Z'},
            'travelMinutes': 63, 'source': 'TIMETABLE_PROVIDER', 'stale': True,
            'failureReason': 'TRANSIT_TRAIN_NOT_YET_OBSERVED: fixture'}
        public = {'plannedJourneyArrivalPrediction': {'basis': 'MATCHED_TRAIN_REALTIME',
            'routeIdentity': 'a' * 64, 'predictedArrivalAt': '2026-11-04T03:29:00Z'},
            'recommendedDepartureAt': worker['beforeRecommendedDepartureAt'], 'stale': True,
            'originReplanDiagnostic': {key: worker[key] for key in
                ('travelMinutes', 'source', 'stale', 'failureReason')}}
        self.assertTrue(verifier.verify_planned_postdeparture(worker, public)['originReplanSeparated'])
        for key in ('travelMinutes', 'source', 'failureReason', 'firstBoardingObservation'):
            leaked = copy.deepcopy(public)
            leaked[key] = worker.get(key, {'trainNumber': 'other-train'})
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verifier.verify_planned_postdeparture(worker, leaked)
        public['recommendedDepartureAt'] = '2026-11-04T03:10:00Z'
        with self.assertRaises(AssertionError):
            verifier.verify_planned_postdeparture(worker, public)

    def fixture(self):
        epoch = dt.datetime(2026, 10, 12, 14, 0, tzinfo=dt.timezone.utc)
        at = lambda s: (epoch + dt.timedelta(seconds=s)).isoformat()
        def ride(train, raw_board, raw_arrival, board, arrival):
            return {'kind': 'SUBWAY', 'rideTiming': {
                'timetable': {'trainNumber': train, 'boardingAt': at(raw_board), 'arrivalAt': at(raw_arrival)},
                'predictedBoardingAt': at(board), 'predictedArrivalAt': at(arrival)}}
        # The route's second-precision departure is 26s after the minute-rounded alert decision.
        route = {'totalMinutes': 28, 'departureAt': at(26), 'arrivalAt': at(1702), 'segments': [
            {'kind': 'WALK', 'durationSeconds': 111}, ride('4012', 330, 800, 197, 700),
            {'kind': 'WALK', 'durationSeconds': 243}, ride('2012', 1050, 1531, 1050, 1531),
            {'kind': 'WALK', 'durationSeconds': 171}]}
        first = route['segments'][1]['rideTiming']
        first['timetable']['boardingStationArrivalAt'] = at(310)
        first.update(basis='FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME', observationSourceUpdatedAt=at(-60))
        route['segments'][3]['transferTiming'] = {'previousArrivalAt': at(700)}
        worker = {'classification': 'SYNTHETIC_PROVIDER_WORKER', 'providersMocked': True,
            'database': 'H2_MEMORY_ONLY', 'physicalTransitHttpCalls': 0, 'productionDatabaseModified': False,
            'phase': 'early-transfer', 'processed': 1, 'historyCount': 1, 'alertMode': 'STANDARD', 'alarmStates': [],
            'retryCount': 0, 'workerFailure': None, 'savedScheduleInput': {}, 'savedScheduleAfterEvaluation': {},
            'effectiveSnapshot': {'accepted': True, 'effectiveTransitRoute': copy.deepcopy(route),
                'transitTimingBasis': 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED'},
            'source': 'LIVE_PROVIDER', 'stale': False, 'failureCode': None, 'epoch': at(0), 'evaluatedAt': at(-60),
            'evaluationHistory': {'memberId': 296, 'scheduleId': 363},
            'clockMode': 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK',
            'recommendedDepartureAt': at(0), 'predictedArrivalAt': at(1702),
            'timetableQueries': [{'line': 'LINE_2', 'notBefore': at(1103)}, {'line': 'LINE_2', 'notBefore': at(1003)}]}
        public = {'scheduleId': 363, 'source': 'LIVE_PROVIDER', 'stale': False, 'confidence': 'MEDIUM',
            'transitTimingBasis': 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED',
            'failureReason': None, 'recommendedDepartureAt': at(0), 'predictedArrivalAt': at(1702),
            'travelMinutes': 28, 'effectiveTransitRoute': route, 'routeChanged': False, 'onTimeArrivalPossible': True,
            'firstBoardingObservation': {'trainNumber': '4012', 'expectedBoardingAt': at(197),
                'readyAt': at(171), 'sourceUpdatedAt': at(-60)}}
        return worker, public

    def test_earlier_connection_preserves_margin_and_cannot_claim_real_accuracy(self):
        result = verifier.verify_prediction(*self.fixture())
        self.assertEqual(result['result'], 'PASSED')
        self.assertEqual(result['syntheticImprovementSeconds'], 1050)
        self.assertTrue(result['walkingAndMarginPreserved'])
        self.assertFalse(result['actualTripAccuracyVerified'])

    def test_first_live_train_does_not_make_future_timetable_high_confidence(self):
        worker, public = self.fixture()
        public['confidence'] = 'MEDIUM'
        basis = 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED'
        public['transitTimingBasis'] = worker['effectiveSnapshot']['transitTimingBasis'] = basis
        self.assertEqual(verifier.verify_prediction(worker, public)['result'], 'PASSED')
        public['confidence'] = 'HIGH'
        with self.assertRaises(AssertionError):
            verifier.verify_prediction(worker, public)
        public['confidence'] = 'MEDIUM'
        public['transitTimingBasis'] = 'TIMETABLE_ONLY'
        with self.assertRaises(AssertionError):
            verifier.verify_prediction(worker, public)
        public['transitTimingBasis'] = basis
        worker['effectiveSnapshot']['transitTimingBasis'] = 'TIMETABLE_ONLY'
        with self.assertRaises(AssertionError):
            verifier.verify_prediction(worker, public)

    def test_observed_transfer_recalculates_notification_and_final_arrival_together(self):
        worker, public = self.fixture()
        epoch = dt.datetime.fromisoformat(worker['epoch'])
        at = lambda seconds: (epoch + dt.timedelta(seconds=seconds)).isoformat()
        worker['phase'] = 'transfer-observed'
        public['confidence'] = 'MEDIUM'
        worker['effectiveSnapshot']['transitTimingBasis'] = public['transitTimingBasis'] = (
            'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED')
        route = public['effectiveTransitRoute']
        route['totalMinutes'] = public['travelMinutes'] = 27
        route['arrivalAt'] = worker['predictedArrivalAt'] = public['predictedArrivalAt'] = at(1612)
        first = route['segments'][1]['rideTiming']
        first.update(basis='FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE',
                     predictedBoardingAt=at(210), predictedArrivalAt=at(513))
        first['timetable'].update(boardingAt=at(197), arrivalAt=at(500))
        onward = route['segments'][3]['rideTiming']
        onward.update(basis='TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE',
                      predictedBoardingAt=at(960), predictedArrivalAt=at(1441),
                      observationSourceUpdatedAt=worker['evaluatedAt'])
        onward['timetable'].update(boardingAt=at(840), arrivalAt=at(1321))
        route['segments'][3]['transferTiming'] = {'requiredMarginSeconds': 60}
        worker['effectiveSnapshot']['effectiveTransitRoute'] = copy.deepcopy(route)
        worker['fencedNotificationPayloads'] = [{
            'recommendedDepartureAt': at(0), 'predictedArrivalAt': at(1612),
            'etaTimingBasis': 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED',
        }]

        self.assertTrue(verifier.verify_prediction(worker, public, 'transfer-observed')
                        ['notificationPayloadMatchesUpdatedEta'])
        worker['fencedNotificationPayloads'][0]['predictedArrivalAt'] = at(1492)
        with self.assertRaises(AssertionError):
            verifier.verify_prediction(worker, public, 'transfer-observed')

    def test_real_feed_wrong_scope_alarm_or_unaccepted_result_is_rejected(self):
        for key, value in [('providersMocked', False), ('database', 'production'),
                           ('physicalTransitHttpCalls', 1), ('phase', 'success'), ('alertMode', 'ALARM'),
                           ('stale', True), ('processed', 0), ('clockMode', 'SYSTEM_WALL_CLOCK')]:
            worker, public = self.fixture()
            worker[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verifier.verify_prediction(worker, public)

    def test_middle_ride_delay_requires_new_onward_train_and_preserved_walks(self):
        worker, public = self.fixture()
        epoch = dt.datetime.fromisoformat(worker['epoch'])
        at = lambda s: (epoch + dt.timedelta(seconds=s)).isoformat()
        worker['phase'] = 'onward-delay'
        route = public['effectiveTransitRoute']
        first, second = route['segments'][1], route['segments'][3]
        first['rideTiming'].update(predictedArrivalAt=at(413))
        second['rideTiming'].update(basis='TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE',
                                   predictedBoardingAt=at(740), predictedArrivalAt=at(860))
        route['segments'][2]['durationSeconds'] = 60
        second['transferTiming'] = {'requiredMarginSeconds': 60}
        third = {'kind': 'SUBWAY', 'rideTiming': {'basis': 'TIMETABLE',
            'timetable': {'trainNumber': '1014'}, 'predictedBoardingAt': at(1080), 'predictedArrivalAt': at(1200)},
            'transferTiming': {'requiredMarginSeconds': 60}}
        route['segments'][4:4] = [{'kind': 'WALK', 'durationSeconds': 60}, third]
        route['totalMinutes'] = public['travelMinutes'] = 23
        route['arrivalAt'] = worker['predictedArrivalAt'] = public['predictedArrivalAt'] = at(1371)
        worker['effectiveSnapshot']['effectiveTransitRoute'] = copy.deepcopy(route)
        worker['timetableQueries'] = [{'line': 'LINE_1', 'notBefore': at(980)}]
        self.assertTrue(verifier.verify_prediction(worker, public, 'onward-delay')
                        ['observedMiddleRideReconnectedOnwardTrain'])
        for key, value in (('predictedArrivalAt', at(1380)), ('basis', 'TRANSFER_ALIGHTING_REALTIME')):
            invalid = copy.deepcopy(public)
            invalid['effectiveTransitRoute']['segments'][5]['rideTiming'][key] = value
            changed = copy.deepcopy(worker)
            changed['effectiveSnapshot']['effectiveTransitRoute'] = copy.deepcopy(invalid['effectiveTransitRoute'])
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verifier.verify_prediction(changed, invalid, 'onward-delay')

    def test_matching_outputs_cannot_hide_shorter_walks_or_old_connection(self):
        for field, value in [('walk', 120), ('train', '2014'), ('arrival', '2026-10-12T14:45:52+00:00')]:
            worker, public = self.fixture()
            route = public['effectiveTransitRoute']
            if field == 'walk':
                route['segments'][2]['durationSeconds'] = value
            elif field == 'train':
                route['segments'][3]['rideTiming']['timetable']['trainNumber'] = value
            else:
                route['arrivalAt'] = public['predictedArrivalAt'] = worker['predictedArrivalAt'] = value
            worker['effectiveSnapshot']['effectiveTransitRoute'] = copy.deepcopy(route)
            with self.subTest(field=field), self.assertRaises(AssertionError):
                verifier.verify_prediction(worker, public)

    def test_missing_margin_probe_and_old_source_are_rejected(self):
        worker, public = self.fixture()
        worker['timetableQueries'] = worker['timetableQueries'][:1]
        with self.assertRaises(AssertionError):
            verifier.verify_prediction(worker, public)
        worker, public = self.fixture()
        public['firstBoardingObservation']['sourceUpdatedAt'] = '2026-10-12T13:56:59+00:00'
        with self.assertRaises(AssertionError):
            verifier.verify_prediction(worker, public)


if __name__ == '__main__':
    unittest.main()
