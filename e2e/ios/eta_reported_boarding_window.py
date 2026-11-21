"""Two bounded real observation windows for the historical-state protocol.

This plans real waits only. It never changes a vehicle, a computed ETA, or a
provider clock, and does not claim that a natural ARRIVED row will be present.
"""
import datetime as dt


def stamp(value):
    at = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if at.tzinfo is None:
        raise ValueError('Observation clocks require an explicit offset')
    return at


def require_public_comparison_departure(value):
    at = stamp(value)
    if at.second or at.microsecond or at.minute % 10:
        raise ValueError('Naver public future UI requires a ten-minute departure step')
    return at


def next_reported_boarding_window(route, worker, *, evaluation_index, now):
    if evaluation_index not in (1, 2):
        raise ValueError('Only two remaining evaluations; no fourth round')
    rides = [leg for leg in route['segments'] if leg['kind'] != 'WALK']
    if not rides or any(leg['kind'] != 'SUBWAY' or not leg.get('rideTiming') for leg in rides):
        raise ValueError('A timed subway plan is required')
    last = rides[-1]
    timing = last['rideTiming']
    board, alight = (stamp(timing[key]) for key in ('predictedBoardingAt', 'predictedArrivalAt'))
    due, target = stamp(worker['nextCheckAt']), stamp(worker['targetArrivalAt'])
    base = max(now, due, stamp(route['departureAt']) + dt.timedelta(seconds=10))
    if evaluation_index == 1:
        at = max(base, board + dt.timedelta(seconds=30))
        # Do not turn a missed original window into unbounded exploratory polling.
        if at > board + dt.timedelta(seconds=120):
            return None
        stage = 'REPORTED_BOARDING_STATE_WINDOW'
    else:
        records = ((worker.get('effectiveSnapshot') or {}).get('plannedRouteUpdate') or {}).get('reportedBoardings') or []
        records = [r for r in records if r.get('routeIdentity') == route['identity'] and
                   r.get('routeDepartureAt') == route['departureAt'] and r.get('segmentSequence') == last['sequence']]
        checked = max((stamp(r['checkedAt']) for r in records), default=stamp(worker['evaluatedAt']))
        # The provider's short destination list may expose the same train only later.
        # Preserve the old state, wait on the real clock, then make the final allowed read.
        at = max(base, checked + dt.timedelta(minutes=4), alight - dt.timedelta(minutes=2))
        stage = 'REPORTED_BOARDING_FRESH_ALIGHTING_WINDOW'
    if at >= min(target - dt.timedelta(minutes=1), alight + dt.timedelta(minutes=20)):
        return None
    return {'stage': stage, 'at': at.isoformat(), 'sequence': last['sequence'],
            'station': last['fromName'] if evaluation_index == 1 else last['toName'],
            'plannedBoardingAt': timing['predictedBoardingAt'],
            'plannedAlightingAt': timing['predictedArrivalAt'], 'qualifyingNaturalObservationGuaranteed': False}
