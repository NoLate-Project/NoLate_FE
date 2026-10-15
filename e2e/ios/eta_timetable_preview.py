"""Shared test-side subset of public timetable-preview eligibility, not ETA acceptance."""
import datetime as dt


def preview_exclusion(worker, route):
    instant = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    # These two failures hold at every API read after evaluation. Other eligibility
    # conditions remain strictly checked by the actual public response/UI audit.
    if instant(route['departureAt']) < instant(worker['evaluatedAt']):
        return 'DEPARTED_AT_EVALUATION'
    if instant(route['arrivalAt']) > instant(worker['targetArrivalAt']):
        return 'ARRIVES_AFTER_TARGET'
    return None
