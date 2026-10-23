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
    def fixture(self):
        epoch = dt.datetime(2026, 10, 12, 14, 0, tzinfo=dt.timezone.utc)
        at = lambda s: (epoch + dt.timedelta(seconds=s)).isoformat()
        def ride(train, raw_board, raw_arrival, board, arrival):
            return {'kind': 'SUBWAY', 'rideTiming': {
                'timetable': {'trainNumber': train, 'boardingAt': at(raw_board), 'arrivalAt': at(raw_arrival)},
                'predictedBoardingAt': at(board), 'predictedArrivalAt': at(arrival)}}
        # The route's second-precision departure is 26s after the minute-rounded alert decision.
        route = {'totalMinutes': 41, 'departureAt': at(26), 'arrivalAt': at(2452), 'segments': [
            {'kind': 'WALK', 'durationSeconds': 111}, ride('4012', 330, 1530, 197, 1397),
            {'kind': 'WALK', 'durationSeconds': 243}, ride('2012', 1800, 2281, 1800, 2281),
            {'kind': 'WALK', 'durationSeconds': 171}]}
        worker = {'classification': 'SYNTHETIC_PROVIDER_WORKER', 'providersMocked': True,
            'database': 'H2_MEMORY_ONLY', 'physicalTransitHttpCalls': 0, 'productionDatabaseModified': False,
            'phase': 'early-transfer', 'processed': 1, 'historyCount': 1, 'alertMode': 'STANDARD', 'alarmStates': [],
            'retryCount': 0, 'workerFailure': None, 'savedScheduleInput': {}, 'savedScheduleAfterEvaluation': {},
            'effectiveSnapshot': {'accepted': True, 'effectiveTransitRoute': copy.deepcopy(route)},
            'source': 'LIVE_PROVIDER', 'stale': False, 'failureCode': None, 'epoch': at(0), 'evaluatedAt': at(-60),
            'evaluationHistory': {'memberId': 296, 'scheduleId': 363},
            'clockMode': 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK',
            'recommendedDepartureAt': at(0), 'predictedArrivalAt': at(2452),
            'timetableQueries': [{'line': 'LINE_2', 'notBefore': at(1833)}, {'line': 'LINE_2', 'notBefore': at(1700)}]}
        public = {'scheduleId': 363, 'source': 'LIVE_PROVIDER', 'stale': False, 'confidence': 'HIGH',
            'failureReason': None, 'recommendedDepartureAt': at(0), 'predictedArrivalAt': at(2452),
            'travelMinutes': 41, 'effectiveTransitRoute': route, 'routeChanged': False, 'onTimeArrivalPossible': True,
            'firstBoardingObservation': {'trainNumber': '4012', 'expectedBoardingAt': at(197),
                'readyAt': at(171), 'sourceUpdatedAt': at(-60)}}
        return worker, public

    def test_earlier_connection_preserves_margin_and_cannot_claim_real_accuracy(self):
        result = verifier.verify_prediction(*self.fixture())
        self.assertEqual(result['result'], 'PASSED')
        self.assertEqual(result['syntheticImprovementSeconds'], 300)
        self.assertTrue(result['walkingAndMarginPreserved'])
        self.assertFalse(result['actualTripAccuracyVerified'])

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
