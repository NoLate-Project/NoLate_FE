"""Verify the actual first-route write, never just an alert-free UI screenshot."""


def verify_saved_route(before, after):
    assert after['classification'] == 'SYNTHETIC_UNLOCATED_DESTINATION_SAVE'
    assert after['database'] == 'H2_MEMORY_ONLY' and after['providersMocked'] is True
    assert after['productionDatabaseModified'] is False and after['physicalTransitHttpCalls'] == 0
    for key, expected in (('scheduleId', 363), ('memberId', 296), ('title', 'E2E 도착지만 저장')):
        assert before[key] == after[key] == expected
    assert before['targetArrivalAt'] == after['targetArrivalAt']
    assert before['scheduleType'] == 'ROUTE'
    if before.get('initialDestinationKind', 'NAME_ONLY') == 'NAME_ONLY':
        assert before['destinationName'] == '금광2동3804번지'
        assert before['destinationLat'] is before['destinationLng'] is None
    else:
        assert before['initialDestinationKind'] == 'COORDINATES'
        assert (before['destinationName'], before['destinationLat'], before['destinationLng']) == ('강남역', 37.4979, 127.0276)
    assert before['routeJson'] is None
    assert before['personalPlanCount'] == 0
    assert before['historyCount'] == before['jobCount'] == after['historyCount'] == 0
    assert after['successfulTravelPlanSaveCount'] == 1
    assert after['destinationName'] == '신림역'
    assert (after['destinationLat'], after['destinationLng']) == (37.4842, 126.9297)
    plan, = after['personalPlans']
    assert plan['member_id'] == 296 and plan['travel_mode'] == 'TRANSIT'
    assert plan['notification_enabled'] is False
    assert plan['origin_name'] == '노원역'
    assert (plan['origin_lat'], plan['origin_lng']) == (37.6551, 127.0610)
    assert isinstance(plan['travel_minutes'], int) and 0 < plan['travel_minutes'] <= 240
    route = plan['route_json']
    assert isinstance(route, dict) and route['provider'] == 'odsay'
    rides = [leg for leg in route['transitLegs'] if leg['kind'] == 'SUBWAY']
    assert len(rides) == 2 and '4호선' in rides[0]['lineName'] and '2호선' in rides[1]['lineName']
    assert len(route.get('pathCoords', [])) >= 2 or all(len(leg.get('pathCoords', [])) >= 2 for leg in rides)
    assert after['routeRequests'] == []  # no Tmap search or ETA Worker in this case
    assert after['clientMockRouteRequests']
    assert all((r['SY'], r['SX'], r['EY'], r['EX']) ==
               (37.6551, 127.0610, 37.4842, 126.9297) for r in after['clientMockRouteRequests'])
    return {'result': 'PASSED', 'travelMinutes': plan['travel_minutes'],
            'commonDestinationMatchesSelection': True, 'personalRoutePersisted': True,
            'syntheticClientRouteCalls': len(after['clientMockRouteRequests']),
            'clientTransitTransport': 'MARKED_LOOPBACK_MAASRP_NO_REAL_MOBILE_KEY',
            'realTripAccuracyVerified': False}
