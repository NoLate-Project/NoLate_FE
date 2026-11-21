"""Controlled verifier contracts, not actual ride-accuracy evidence."""
import copy
import unittest
from test_eta_observed_service import fixture, at
from eta_observed_service import fresh_observed_service_connection
from eta_planned_route_evidence import qualifying_planned_observation


def historical_fixture():
    worker, route, original = fixture()
    leg = route['segments'][0]
    timing = leg['rideTiming']
    timing.update(basis='REPORTED_BOARDING_AND_ALIGHTING_REALTIME', predictedBoardingAt=at(240),
                  boardingObservationSourceUpdatedAt=at(240), observationSourceUpdatedAt=at(490))
    record = dict(routeIdentity=route['identity'], routeDepartureAt=route['departureAt'], segmentSequence=leg['sequence'],
                  service=copy.deepcopy(timing['observedService']), sourceUpdatedAt=at(240), checkedAt=at(260), recordedAt=at(260.25))
    timing['reportedBoarding'] = record
    old = copy.deepcopy(worker['plannedRefreshReplay']['frames'][0])
    old.update(evaluatedAt=at(260), result=dict(routeIdentity=route['identity'], sourceUpdatedAt=at(240), reportedBoardings=[record]))
    boarding = old['stations'][0]['rows'][0]
    boarding.update(arrivalStatus='ARRIVED', waitSeconds=0, expectedAt=at(240), sourceUpdatedAt=at(240), observedAt=at(260.25))
    old['stations'] = [old['stations'][0]]
    current = copy.deepcopy(worker['plannedRefreshReplay']['frames'][0])
    current.update(evaluatedAt=at(500), previousUpdate=copy.deepcopy(old['result']))
    alighting = current['stations'][1]['rows'][0]
    alighting.update(sourceUpdatedAt=at(490), observedAt=at(500.1))
    current['stations'] = [current['stations'][1]]
    update = worker['effectiveSnapshot']['plannedRouteUpdate']
    update.update(sourceUpdatedAt=at(490), reportedBoardings=[record])
    current['result'] = update
    worker.update(evaluatedAt=at(501), historyCount=3)
    worker['plannedRefreshReplay']['frames'] = [old, current]
    return worker, route, record


class ReportedBoardingWitnessTest(unittest.TestCase):
    def test_earlier_captured_state_and_later_forecast_are_proved_separately(self):
        worker, _, _ = historical_fixture()
        original = copy.deepcopy(worker)
        observation = qualifying_planned_observation(worker)
        self.assertIsNotNone(observation)
        witness = fresh_observed_service_connection(worker, observation)
        self.assertEqual('REPORTED_BOARDING_AND_FRESH_ALIGHTING_NOT_PASSENGER_CONFIRMATION', witness['classification'])
        self.assertEqual('3202', witness['services'][0]['trainNumber'])
        self.assertEqual(at(260.25), witness['services'][0]['reportedBoarding']['recordedAt'])
        self.assertFalse(witness['physicalArrivalVerified'])
        self.assertEqual(original, worker)

    def test_old_forecast_or_unpersisted_or_different_raw_vehicle_never_becomes_a_boarding_event(self):
        for change in ('forecast', 'departed', 'wait', 'source', 'receipt', 'number', 'direction',
                       'missing-old', 'missing-stored', 'missing-previous', 'late-alighting-receipt'):
            worker, _, _ = historical_fixture()
            observation = qualifying_planned_observation(worker)
            old, current = worker['plannedRefreshReplay']['frames']
            row = old['stations'][0]['rows'][0]
            if change == 'forecast': row['arrivalStatus'] = 'IN_TRANSIT'
            if change == 'departed': row['arrivalStatus'] = 'DEPARTED'
            if change == 'wait': row['waitSeconds'] = 10
            if change == 'source': row['sourceUpdatedAt'] = at(239)
            if change == 'receipt': row['observedAt'] = at(260.1)
            if change == 'number': row['trainNumber'] = '2202'
            if change == 'direction': row['direction'] = '외선'
            if change == 'missing-old': worker['plannedRefreshReplay']['frames'] = [current]
            if change == 'missing-stored': old['result']['reportedBoardings'] = []
            if change == 'missing-previous': current['previousUpdate']['reportedBoardings'] = []
            if change == 'late-alighting-receipt': current['stations'][0]['rows'][0]['observedAt'] = at(502)
            with self.subTest(change=change):
                self.assertIsNone(fresh_observed_service_connection(worker, observation))

    def test_invalid_historical_clock_context_is_rejected_before_display_qualification(self):
        for change in ('route', 'departure', 'checked', 'receipt', 'source', 'service', 'sequence'):
            worker, _, record = historical_fixture()
            if change == 'route': record['routeIdentity'] = 'b' * 64
            if change == 'departure': record['routeDepartureAt'] = at(1)
            if change == 'checked': record['checkedAt'] = at(361)
            if change == 'receipt': record['recordedAt'] = at(266)
            if change == 'source': record['sourceUpdatedAt'] = at(239)
            if change == 'service': record['service']['trainNumber'] = '3204'
            if change == 'sequence': record['segmentSequence'] = 1
            with self.subTest(change=change):
                self.assertIsNone(qualifying_planned_observation(worker))

    def test_calculation_start_and_current_http_receipt_are_not_forced_equal(self):
        worker, route, record = historical_fixture()
        _, current = worker['plannedRefreshReplay']['frames']
        record.update(sourceUpdatedAt=at(490), checkedAt=at(500), recordedAt=at(500.25))
        timing = route['segments'][0]['rideTiming']
        timing.update(predictedBoardingAt=at(490), boardingObservationSourceUpdatedAt=at(490))
        old_row = copy.deepcopy(worker['plannedRefreshReplay']['frames'][0]['stations'][0])
        old_row['rows'][0].update(expectedAt=at(490), sourceUpdatedAt=at(490), observedAt=at(500.25))
        current['stations'].append(old_row)
        current.pop('previousUpdate')
        worker['plannedRefreshReplay']['frames'] = [current]
        worker.update(historyCount=2, evaluatedAt=at(500.5))
        timing['observationSourceUpdatedAt'] = at(489.9)
        current['result']['sourceUpdatedAt'] = at(489.9)
        current['stations'][0]['rows'][0]['sourceUpdatedAt'] = at(489.9)
        self.assertIsNotNone(fresh_observed_service_connection(worker, qualifying_planned_observation(worker)))
        worker['evaluatedAt'] = at(500.2)
        self.assertIsNone(qualifying_planned_observation(worker))

    def test_display_line_prefix_does_not_change_canonical_observation_line(self):
        worker, route, _ = fixture()
        route['segments'][0]['lineName'] = '수도권 2호선'
        self.assertIsNotNone(fresh_observed_service_connection(worker, qualifying_planned_observation(worker)))

    def test_later_alighting_refresh_keeps_the_same_historical_identity_and_clock(self):
        worker, route, _ = historical_fixture()
        timing = route['segments'][0]['rideTiming']
        timing.update(basis='PLANNED_RIDE_ALIGHTING_REALTIME', plannedBoardingIsStationArrival=True,
                      boardingObservationSourceUpdatedAt=None)
        self.assertIsNotNone(fresh_observed_service_connection(worker, qualifying_planned_observation(worker)))


if __name__ == '__main__':
    unittest.main()
