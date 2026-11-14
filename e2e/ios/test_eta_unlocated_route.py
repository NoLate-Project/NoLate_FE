import copy
import unittest
from eta_unlocated_route import verify_saved_route


def evidence():
    before = dict(scheduleId=363, memberId=296, title='E2E 도착지만 저장', scheduleType='ROUTE', targetArrivalAt='2026-11-04T05:00:00Z',
                  destinationName='금광2동3804번지', destinationLat=None, destinationLng=None, routeJson=None,
                  personalPlanCount=0, historyCount=0, jobCount=0)
    after = dict(before, classification='SYNTHETIC_UNLOCATED_DESTINATION_SAVE', database='H2_MEMORY_ONLY',
                 providersMocked=True, productionDatabaseModified=False, physicalTransitHttpCalls=0,
                 successfulTravelPlanSaveCount=1, destinationName='신림역', destinationLat=37.4842, destinationLng=126.9297,
                 routeRequests=[], clientMockRouteRequests=[dict(SY=37.6551, SX=127.0610, EY=37.4842, EX=126.9297)],
                 personalPlans=[dict(member_id=296, travel_mode='TRANSIT', travel_minutes=65, notification_enabled=False,
                     origin_name='노원역', origin_lat=37.6551, origin_lng=127.0610,
                     route_json=dict(provider='odsay', pathCoords=[dict(lat=37.6551, lng=127.0610),
                         dict(lat=37.4842, lng=126.9297)], transitLegs=[
                         dict(kind='SUBWAY', lineName='4호선'), dict(kind='SUBWAY', lineName='2호선')]))])
    return before, after


class UnlocatedSaveTest(unittest.TestCase):
    def test_selected_destination_and_actual_personal_route_are_both_required(self):
        self.assertEqual(verify_saved_route(*evidence())['travelMinutes'], 65)

    def test_unchanged_destination_duplicate_write_and_different_route_are_rejected(self):
        for key, value in (('destinationName', '금광2동3804번지'), ('destinationLat', None),
                           ('successfulTravelPlanSaveCount', 2), ('personalPlans', []),
                           ('historyCount', 1), ('productionDatabaseModified', True), ('physicalTransitHttpCalls', 1)):
            before, after = evidence()
            after[key] = value
            with self.subTest(key=key), self.assertRaises((AssertionError, ValueError)):
                verify_saved_route(before, after)

    def test_route_roundtrip_checks_identity_geometry_and_preserved_target(self):
        before, after = evidence()
        for mutate in (lambda a: a.update(targetArrivalAt='2026-11-05T05:00:00Z'),
                       lambda a: a['clientMockRouteRequests'][0].update(EX=127.0),
                       lambda a: a['personalPlans'][0]['route_json'].update(provider='tmap'),
                       lambda a: a['personalPlans'][0]['route_json'].update(pathCoords=[], transitLegs=[])):
            invalid = copy.deepcopy(after)
            mutate(invalid)
            with self.assertRaises(AssertionError):
                verify_saved_route(before, invalid)

    def test_this_route_save_must_not_silently_enable_notifications(self):
        before, after = evidence()
        after['personalPlans'][0]['notification_enabled'] = True
        with self.assertRaises(AssertionError):
            verify_saved_route(before, after)

    def test_existing_coordinates_are_replaced_only_by_the_verified_first_route_selection(self):
        before, after = evidence()
        before.update(initialDestinationKind='COORDINATES', destinationName='강남역',
                      destinationLat=37.4979, destinationLng=127.0276)
        self.assertTrue(verify_saved_route(before, after)['commonDestinationMatchesSelection'])
        after.update(destinationName='강남역', destinationLat=37.4979, destinationLng=127.0276)
        with self.assertRaises(AssertionError):
            verify_saved_route(before, after)


if __name__ == '__main__':
    unittest.main()
