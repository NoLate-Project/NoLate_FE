"""Controlled witness regressions, not actual public-provider accuracy evidence."""
import copy
import datetime as dt
import unittest
from eta_planned_route_evidence import verified_timetable_plan

BASE = dt.datetime(2026, 11, 20, 9, tzinfo=dt.timezone.utc)
def at(s): return (BASE + dt.timedelta(seconds=s)).isoformat()

def fixture():
    def walk(i): return {'sequence':i,'kind':'WALK','durationSeconds':60 if i != 2 else 120,'durationMinutes':1 if i != 2 else 2}
    def ride(i,line,b,a,station=None):
        table={'provider':'seoul-timetable','line':line,'serviceDate':'2026-11-20',
               'trainNumber':str(i),'boardingAt':at(b),'arrivalAt':at(a),'fetchedAt':at(-.5)}
        if station is not None: table['boardingStationArrivalAt']=at(station)
        return {'sequence':i,'kind':'SUBWAY','durationMinutes':9 if i==1 else 8,
                'rideTiming':{'basis':'TIMETABLE','timetable':table,'predictedBoardingAt':at(b),'predictedArrivalAt':at(a)}}
    route={'provider':'odsay','identity':'a'*64,'departureAt':at(600),'arrivalAt':at(1860),'totalMinutes':21,
           'segments':[walk(0),ride(1,'LINE_4',750,1200,720),walk(2),ride(3,'LINE_2',1380,1800),walk(4)]}
    diagnostic=copy.deepcopy(route);diagnostic.update(departureAt=at(300),arrivalAt=at(1560))
    failure='TRANSIT_ARRIVAL_OUT_OF_HORIZON: current diagnostic stays rejected'
    evidence={'route':copy.deepcopy(route),'fetchedAt':at(-.6),'failureReason':'TRANSIT_TRAIN_NOT_YET_OBSERVED: future plan',
              'provenance':'SELECTED_ROUTE_PRESERVED'}
    return {'source':'TIMETABLE_PROVIDER','stale':True,'failureReason':failure,'evaluatedAt':at(0),'targetArrivalAt':at(2700),
            'effectiveSnapshot':{'accepted':False,'transitTimingBasis':'TIMETABLE_ONLY','effectiveTransitRoute':diagnostic,
                                 'lastTimetablePlannedRoute':route},
            'plannedRefreshReplay':{'boardingBufferSeconds':60,'transferConfidenceMarginSeconds':60,'transferBufferSeconds':0},
            'futureTimetablePlanTrace':{'classification':'PASSIVE_REAL_FUTURE_TIMETABLE_PLAN_TRACE','additionalHttpCalls':0,
                'responseModified':False,'events':[{'source':'TIMETABLE_PROVIDER','stale':True,'failureReason':failure,
                'evaluatedAt':at(-1),'plannedDepartureAt':at(600),'targetArrivalAt':at(2700),'returnedAt':at(-.1),
                'futureTimetablePlanEvidence':evidence}]}}

class IndependentTimetableWitnessTest(unittest.TestCase):
    def test_same_evaluation_future_plan_survives_without_changing_current_diagnostic(self):
        w=fixture();before=copy.deepcopy(w)
        self.assertEqual(verified_timetable_plan(w),w['effectiveSnapshot']['lastTimetablePlannedRoute'])
        self.assertEqual(w,before)
    def test_out_of_horizon_is_not_a_new_unconditional_allowlist(self):
        w=fixture();del w['futureTimetablePlanTrace']
        self.assertIsNone(verified_timetable_plan(w))
        w=fixture();w['effectiveSnapshot']['effectiveTransitRoute']=copy.deepcopy(w['effectiveSnapshot']['lastTimetablePlannedRoute'])
        del w['futureTimetablePlanTrace']
        self.assertIsNone(verified_timetable_plan(w))
    def test_wrong_frame_unsafe_margin_date_or_candidate_is_not_borrowed(self):
        def both_tables(w, e, **values):
            for route in (w['effectiveSnapshot']['lastTimetablePlannedRoute'], e['futureTimetablePlanEvidence']['route']):
                route['segments'][1]['rideTiming']['timetable'].update(**values)
        mutations=[
            lambda w,e: both_tables(w,e,serviceDate='2026-11-19'),
            lambda w,e: both_tables(w,e,fetchedAt=at(1)),
            lambda w,e: e.update(returnedAt=at(1)),
            lambda w,e: e.update(targetArrivalAt=at(2800)),
            lambda w,e: e.update(plannedDepartureAt=at(500)),
            lambda w,e: e.update(source='LIVE_PROVIDER'),
            lambda w,e: e.update(failureReason='PROVIDER_TIMEOUT: mismatch'),
            lambda w,e: e['futureTimetablePlanEvidence'].update(fetchedAt=at(1)),
            lambda w,e: e['futureTimetablePlanEvidence'].update(provenance='ODSAY_ALTERNATIVE_ROUTE'),
            lambda w,e: w['plannedRefreshReplay'].update(boardingBufferSeconds=61),
            lambda w,e: w['plannedRefreshReplay'].update(transferConfidenceMarginSeconds=61),
            lambda w,e: w['effectiveSnapshot']['effectiveTransitRoute'].update(identity='b'*64),
            lambda w,e: w['futureTimetablePlanTrace'].update(responseModified=True),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                w=fixture();mutate(w,w['futureTimetablePlanTrace']['events'][0])
                self.assertIsNone(verified_timetable_plan(w))
