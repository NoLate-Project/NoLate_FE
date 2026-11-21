import copy
import datetime as dt
import unittest
from eta_observed_service import observed_service, selected_train_number, fresh_observed_service_connection
from eta_planned_route_evidence import qualifying_planned_observation, fresh_final_alighting, first_ride_intervals, next_planned_observation_window


def at(seconds):
    return (dt.datetime(2026, 11, 20, 3, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=seconds)).isoformat()


def fixture():
    timing = dict(timetable=dict(provider='seoul-timetable', line='LINE_2', serviceDate='2026-11-20', trainNumber='2202',
        directionCode='UP', serviceClass='LOCAL', fromStationCode='0226', toStationCode='0230', terminalName='성수',
        boardingAt=at(180), arrivalAt=at(630), fetchedAt=at(0)), predictedBoardingAt=at(240), predictedArrivalAt=at(690),
        basis='OBSERVED_SUBWAY_SERVICE_REALTIME', observationSourceUpdatedAt=at(120), boardingObservationSourceUpdatedAt=at(120),
        observedService=dict(provider='seoul-openapi', line='LINE_2', serviceDate='2026-11-20', trainNumber='3202',
            directionCode='UP', serviceClass='LOCAL', terminalName='성수', boardingStationName='사당', alightingStationName='신림'))
    leg = dict(sequence=0, kind='SUBWAY', lineName='2호선', fromName='사당', toName='신림', durationMinutes=12,
               orderedStopNames=['사당', '낙성대', '서울대입구', '봉천', '신림'], rideTiming=timing)
    route = dict(identity='a' * 64, provider='odsay', departureAt=at(0), arrivalAt=at(690), totalMinutes=12, segments=[leg])
    original = copy.deepcopy(route)
    original['segments'][0]['rideTiming'].pop('observedService')
    original['segments'][0]['rideTiming'].update(basis='TIMETABLE', observationSourceUpdatedAt=None,
        boardingObservationSourceUpdatedAt=None, predictedBoardingAt=at(180), predictedArrivalAt=at(630))
    original['arrivalAt'] = at(630)
    update = dict(routeIdentity=route['identity'], sourceUpdatedAt=at(120), route=route, onlyLastRideObserved=False)
    reads = []
    for name, expected in [('사당', 240), ('신림', 690)]:
        reads.append(dict(station=name, line='2호선', directionCode='UP', rows=[dict(provider='seoul-openapi', kind='SUBWAY',
            stationName=name, lineName='2호선', subwayLineId='1002', trainNumber='3202', direction='내선', destinationName='성수',
            realtime=True, express=False, freshnessEvidence='PROVIDER_SOURCE_TIMESTAMP', arrivalStatus='IN_TRANSIT',
            expectedAt=at(expected), sourceUpdatedAt=at(120))]))
    worker = dict(evaluatedAt=at(130), historyCount=2, effectiveSnapshot=dict(inProgressPlannedRoute=original, plannedRouteUpdate=update),
        plannedRefreshReplay=dict(frames=[dict(evaluatedAt=at(130), plan=copy.deepcopy(original), departurePlan=copy.deepcopy(original), incomplete=False, stations=reads, result=update)]))
    return worker, route, original


class ObservedServiceEvidenceTest(unittest.TestCase):
    def test_pairing_uses_an_existing_round_before_boarding_and_never_extends_three_round_budget(self):
        worker, route, _ = fixture()
        worker.update(nextCheckAt=at(131), targetArrivalAt=at(3600))
        window = next_planned_observation_window(route, worker, evaluation_index=2, first_boarding_recheck=True,
            observed_service_connection=True, now=dt.datetime.fromisoformat(at(130)))
        self.assertEqual(window['stage'], 'OBSERVED_SERVICE_CONNECTION')
        self.assertEqual(window['at'], at(180))
        self.assertEqual(window['trainNumber'], '3202')
        self.assertLess(dt.datetime.fromisoformat(window['at']), dt.datetime.fromisoformat(at(240)))
        self.assertIsNone(next_planned_observation_window(route, worker, evaluation_index=2,
            observed_service_connection=True, now=dt.datetime.fromisoformat(at(240))))
        with self.assertRaises(ValueError):
            next_planned_observation_window(route, worker, evaluation_index=3,
                observed_service_connection=True, now=dt.datetime.fromisoformat(at(130)))

    def test_new_pair_has_its_own_evidence_and_never_counts_as_the_original_train(self):
        worker, route, original = fixture()
        observation = qualifying_planned_observation(worker)
        self.assertEqual(observation['basis'], 'OBSERVED_SERVICE_CONNECTION')
        self.assertEqual(selected_train_number(route['segments'][0]), '3202')
        witness = fresh_observed_service_connection(worker, observation)
        self.assertEqual(witness['services'][0]['trainNumber'], '3202')
        self.assertEqual(witness['services'][0]['comparisonTimetableTrainNumber'], '2202')
        self.assertFalse(witness['physicalArrivalVerified'])
        self.assertIsNone(fresh_final_alighting(observation, original, worker['evaluatedAt']))
        self.assertIn('열차 도착 기준', first_ride_intervals(route)['wait'])

    def test_requires_both_actual_raw_endpoint_rows_at_this_evaluation(self):
        for change in ('missing-frame', 'incomplete', 'different-train', 'different-direction', 'wrong-source', 'departed', 'missing-station', 'realtime'):
            worker, _, _ = fixture()
            observation = qualifying_planned_observation(worker)
            frame = worker['plannedRefreshReplay']['frames'][0]
            row = frame['stations'][1]['rows'][0]
            if change == 'missing-frame': worker['plannedRefreshReplay']['frames'] = []
            if change == 'incomplete': frame['incomplete'] = True
            if change == 'different-train': row['trainNumber'] = '2202'
            if change == 'different-direction': row['direction'] = '외선'
            if change == 'wrong-source': row['sourceUpdatedAt'] = at(119)
            if change == 'departed': row['arrivalStatus'] = 'DEPARTED'
            if change == 'missing-station': frame['stations'].pop()
            if change == 'realtime': row['realtime'] = False
            self.assertIsNone(fresh_observed_service_connection(worker, observation), change)

    def test_identity_and_source_validation_does_not_fall_back_to_comparison_train(self):
        for change in ('date', 'line', 'number', 'terminal', 'order', 'missing-source'):
            worker, route, _ = fixture()
            leg = route['segments'][0]
            timing = leg['rideTiming']
            if change == 'date': timing['observedService']['serviceDate'] = '2026-11-19'
            if change == 'line': timing['observedService']['line'] = 'LINE_4'
            if change == 'number': timing['observedService']['trainNumber'] = '0000'
            if change == 'terminal': timing['observedService']['terminalName'] = '신도림'
            if change == 'order': leg['orderedStopNames'] = []
            if change == 'missing-source': timing['boardingObservationSourceUpdatedAt'] = None
            self.assertIsNone(qualifying_planned_observation(worker), change)

    def test_saved_actual_identity_does_not_lose_its_number_when_sources_expire(self):
        _, route, _ = fixture()
        timing = route['segments'][0]['rideTiming']
        timing.update(basis='PLANNED_RIDE_BASELINE', plannedBoardingIsStationArrival=True,
                      observationSourceUpdatedAt=None, boardingObservationSourceUpdatedAt=None)
        self.assertEqual(observed_service(route['segments'][0])['trainNumber'], '3202')
        self.assertEqual(selected_train_number(route['segments'][0]), '3202')


if __name__ == '__main__':
    unittest.main()
