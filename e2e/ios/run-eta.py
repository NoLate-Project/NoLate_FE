#!/usr/bin/env python3
"""Drive the installed app on the explicitly approved ETA E2E simulator."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import urllib.request
from eta_timetable_preview import preview_exclusion
from eta_diagnostic_warning import diagnostic_warning

APPROVED_DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
APPROVED_DEVICE_NAME = 'NoLate XCUITest 20261003'
METHODS = ('testInspectEtaJourney', 'testInspectStartDatePicker', 'testInspectExistingEtaEdit', 'testPrepareExistingEtaRouteSearch', 'testInspectTransferRouteCandidates', 'testPrepareTransferEtaEdit', 'testCommitTransferEtaEdit', 'testPrepareEtaJourney', 'testCommitPreparedEtaJourney', 'testVerifySavedEtaJourney', 'testInspectOdsayRefreshFromSavedTransfer', 'testRestartDedicatedEtaApp', 'testLoginDedicatedEtaAccount')
SAVE_METHODS = ('testCommitPreparedEtaJourney', 'testCommitTransferEtaEdit')
METHODS += ('testRetryOdsaySearch', 'testVerifyOdsayQuotaFailure')
METHODS += ('testPrepareTmapTransferSearch', 'testVerifyTmapFallbackPresentation')
METHODS += ('testInspectFutureRouteTimeline', 'testVerifyFutureRouteTimelineConsistency')
METHODS += ('testReturnFromTransferTimeline',)
METHODS += ('testReopenTransferEditor',)
METHODS += ('testVerifyUnverifiedTransferPresentation',)
METHODS += ('testPrepareTimetableEtaReschedule', 'testVerifyTimetableEtaPresentation')
METHODS += ('testVerifyCurrentTimetableEtaPresentation',)
METHODS += ('testVerifyIsolatedEtaFixture',)
METHODS += ('testSaveIsolatedEtaTarget',)
METHODS += ('testDismissPrivateSharingDisabledNotice',)
METHODS += ('testCreateIsolatedEtaJourney',)
METHODS += ('testPrepareNaverComparisonJourney', 'testCommitNaverComparisonJourney')
METHODS += ('testRescheduleNaverComparisonJourney',)
METHODS += ('testReopenNaverComparisonJourney',)
METHODS += ('testVerifyAcceptedRealEtaComparison',)
METHODS += ('testVerifyRealEtaDiagnostic',)
METHODS += ('testVerifyRealLateEtaComparison',)
METHODS += ('testVerifyProtectedRealEtaDiagnostic',)
METHODS += ('testVerifyIsolatedRealProviderEta',)
METHODS += ('testVerifyIsolatedRealProviderDiagnostic',)
METHODS += ('testVerifyIsolatedRealProviderObservationExpiry',)
METHODS += ('testVerifyIsolatedQuotaEta',)
SAVE_METHODS += ('testCommitNaverComparisonJourney',)
SAVE_METHODS += ('testRescheduleNaverComparisonJourney',)
METHODS += ('testVerifyNaturalEtaFixture',)
METHODS += ('testInspectIsolatedNativeAlarm', 'testObserveIsolatedNativeAlarmDelivery', 'testVerifyIsolatedNativeAlarmState')
SAVE_METHODS += ('testSaveIsolatedEtaTarget',)
SAVE_METHODS += ('testCreateIsolatedEtaJourney',)

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--only', choices=METHODS, required=True)
parser.add_argument('--title', required=True)
parser.add_argument('--target-arrival', required=True, help='Timezone-qualified ISO 8601')
parser.add_argument('--allow-save', action='store_true')
parser.add_argument('--existing-title')
parser.add_argument('--schedule-id', type=int)
parser.add_argument('--credentials', type=Path, help='Approved member 296 credentials, only for explicit login')
parser.add_argument('--inspect-odsay-after-login', action='store_true')
parser.add_argument('--assert-quota-failure', action='store_true')
parser.add_argument('--inspect-tmap-after-login', action='store_true')
parser.add_argument('--expected-diagnostic', choices=('TRANSIT_ARRIVAL_UNAVAILABLE', 'TRANSIT_ARRIVAL_OUT_OF_HORIZON'))
parser.add_argument('--api-base', choices=('http://127.0.0.1:5522', 'http://127.0.0.1:5523'), default='http://127.0.0.1:5522')
parser.add_argument('--fixture-phase', choices=('success', 'reconnect', 'early-transfer', 'unknown', 'missed', 'recovered', 'late'))
parser.add_argument('--fixture-evidence', type=Path, help='Private H2 phase result; verifies exact displayed time/duration')
parser.add_argument('--natural-evidence', type=Path, help='Private natural due-time Worker result')
parser.add_argument('--native-evidence', type=Path, help='Private Worker result, followed by actual native OS delivery')
parser.add_argument('--native-mode', choices=('inspect', 'foreground', 'background', 'terminated', 'locked', 'state'))
parser.add_argument('--real-evidence', type=Path, help='Scoped read-only real member-296 DB snapshot; accepted results only')
parser.add_argument('--real-isolated', action='store_true', help='Explicit separate H2 DB with real ETA providers, not mock fixture')
parser.add_argument('--real-automatic', action='store_true', help='Real feeds + automatic scheduler + UI creation/native delivery in H2 only')
parser.add_argument('--real-isolated-evidence', type=Path)
parser.add_argument('--quota-evidence', type=Path, help='Synthetic quota Worker evidence; never actual provider acceptance')
args = parser.parse_args()
quota_ui = args.only == 'testVerifyIsolatedQuotaEta'
quota_expected = {}
if quota_ui:
    if (args.api_base != 'http://127.0.0.1:5523' or args.schedule_id != 363 or
            args.title != 'ETA E2E isolated fixture' or args.quota_evidence is None):
        parser.error('Quota UI verification is restricted to the private H2 fixture')
    quota_path = args.quota_evidence.resolve(strict=True)
    if not str(quota_path).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        parser.error('Quota evidence must be private synthetic data')
    quota = json.loads(quota_path.read_text())
    if (quota.get('classification') != 'SYNTHETIC_PROVIDER_WORKER' or quota.get('providersMocked') is not True or
            quota.get('database') != 'H2_MEMORY_ONLY' or quota.get('physicalTransitHttpCalls') != 0 or
            quota.get('processed') != 1 or quota.get('scenario') not in
            ('quota-route', 'quota-timetable', 'quota-arrival', 'quota-recovered', 'optimization-timeout',
             'quality-unobserved', 'quality-stale', 'quality-unverified', 'quality-error', 'quality-timeout') or
            dt.datetime.fromisoformat(quota['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival)):
        parser.error('Wrong quota evidence scope or classification')
    accepted_quota = quota['scenario'] in ('quota-recovered', 'optimization-timeout')
    if quota['scenario'] == 'optimization-timeout' and (
            quota['injectedFaults'] != ['route:OPTIMIZATION_TIMEOUT'] or len(quota['routeRequests']) != 2):
        parser.error('Second-search timeout evidence is required; a cache hit is not a fault injection')
    if (accepted_quota and (quota['stale'] is not False or quota['failureCode'] is not None) or
            not accepted_quota and (quota['stale'] is not True or not quota['injectedFaults'])):
        parser.error('Quota outcome does not match the expected fault or recovery')
    quota_expected = {'TEST_RUNNER_E2E_QUOTA_ACCEPTED': '1' if accepted_quota else '0',
        'TEST_RUNNER_E2E_ARRIVAL_QUALITY_SCENARIO': quota['scenario'],
        'TEST_RUNNER_E2E_QUOTA_DEPARTURE_CLOCK': dt.datetime.fromisoformat(quota['recommendedDepartureAt']).astimezone(
            dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M')}
    if accepted_quota:
        epoch = dt.datetime.fromisoformat(quota['epoch'])
        for name, seconds in (('FIRST_BOARDING', 210), ('FIRST_ALIGHTING', 1410),
                              ('TRANSFER_BOARDING', 1800), ('TRANSFER_ALIGHTING', 2281)):
            quota_expected['TEST_RUNNER_E2E_RIDE_' + name] = (epoch + dt.timedelta(seconds=seconds)).astimezone(
                dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M:%S')
elif args.quota_evidence is not None:
    parser.error('Quota evidence is valid only for the explicit synthetic UI method')
real_expected = {}
if args.real_automatic and not args.real_isolated:
    parser.error('Automatic real delivery requires explicit real isolation')
if args.real_isolated:
    automatic_methods = ('testCreateIsolatedEtaJourney', 'testObserveIsolatedNativeAlarmDelivery', 'testVerifyIsolatedNativeAlarmState') if args.real_automatic else ()
    if (args.api_base != 'http://127.0.0.1:5523' or args.title != 'ETA E2E real isolated fixture' or
            args.only not in ('testLoginDedicatedEtaAccount', 'testVerifyIsolatedRealProviderEta', 'testVerifyIsolatedRealProviderDiagnostic', 'testVerifyIsolatedRealProviderObservationExpiry', 'testInspectEtaJourney') + automatic_methods):
        parser.error('Real isolation is restricted to its explicit account-296 methods on the separate memory DB')
    if args.only == 'testVerifyIsolatedRealProviderObservationExpiry':
        if args.real_isolated_evidence is None:
            parser.error('Original accepted Worker evidence is required for an expired API read')
        expiry_path = args.real_isolated_evidence.resolve(strict=True)
        if not str(expiry_path).startswith('/private/tmp/nolate-eta-real-e2e.'):
            parser.error('Expiry verification is restricted to private real-provider evidence')
        original = json.loads(expiry_path.read_text())
        observation = (original.get('effectiveSnapshot') or {}).get('firstBoardingObservation') or {}
        if (original.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER' or
                original.get('database') != 'H2_MEMORY_ONLY' or original.get('providersMocked') is not False or
                original.get('clockMode') != 'SYSTEM_WALL_CLOCK' or original.get('memberId') != 296 or
                original.get('scheduleId') != 363 or original.get('stale') is not False or
                original.get('source') != 'LIVE_PROVIDER' or original.get('failureReason') is not None or
                (original.get('effectiveSnapshot') or {}).get('accepted') is not True or
                not observation.get('sourceUpdatedAt') or not observation.get('evaluatedAt') or
                dt.datetime.fromisoformat(original['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival)):
            parser.error('Expiry verification must retain an actual accepted isolated evaluation')
        expired_at = max(dt.datetime.fromisoformat(observation[k]) for k in ('sourceUpdatedAt', 'evaluatedAt')) + dt.timedelta(seconds=121)
        if dt.datetime.now(dt.timezone.utc) < expired_at:
            parser.error('The actual wall clock has not passed the original observation expiry')
        real_expected = {'TEST_RUNNER_E2E_REAL_ISOLATED': '1',
                         'TEST_RUNNER_E2E_REAL_OBSERVATION_EXPIRY': '1',
                         'TEST_RUNNER_E2E_REAL_DIAGNOSTIC_WARNING': diagnostic_warning('TRANSIT_ARRIVAL_SOURCE_STALE:'),
                         'TEST_RUNNER_E2E_REAL_FORBID_FUTURE_PREVIEW': '1',
                         'TEST_RUNNER_E2E_REAL_DEPARTURE_CLOCK': dt.datetime.fromisoformat(original['recommendedDepartureAt']).astimezone(
                             dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M')}
    if args.only == 'testVerifyIsolatedRealProviderDiagnostic':
        if args.real_isolated_evidence is None:
            parser.error('Fresh rejected real Worker evidence is required')
        diagnostic_path = args.real_isolated_evidence.resolve(strict=True)
        if not str(diagnostic_path).startswith('/private/tmp/nolate-eta-real-e2e.'):
            parser.error('Diagnostic evidence must use real-provider isolation')
        diagnostic = json.loads(diagnostic_path.read_text())
        if (diagnostic.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER' or
                diagnostic.get('database') != 'H2_MEMORY_ONLY' or diagnostic.get('providersMocked') is not False or
                diagnostic.get('clockMode') != 'SYSTEM_WALL_CLOCK' or diagnostic.get('memberId') != 296 or
                diagnostic.get('scheduleId') != 363 or diagnostic.get('processed') != 1 or
                diagnostic.get('journeyProvider') != 'odsay' or diagnostic.get('stale') is not True or
                not diagnostic.get('failureReason') or (diagnostic.get('effectiveSnapshot') or {}).get('accepted') is True):
            parser.error('Diagnostic UI requires an actually rejected ODsay evaluation')
        if (abs((dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(diagnostic['evaluatedAt'])).total_seconds()) > 180 or
                dt.datetime.fromisoformat(diagnostic['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival)):
            parser.error('Fresh diagnostic must retain the isolated target')
        real_expected = {'TEST_RUNNER_E2E_REAL_ISOLATED': '1',
                         'TEST_RUNNER_E2E_REAL_DIAGNOSTIC_WARNING':
                             diagnostic_warning(diagnostic['failureReason']),
                         'TEST_RUNNER_E2E_REAL_DEPARTURE_CLOCK': dt.datetime.fromisoformat(diagnostic['recommendedDepartureAt']).astimezone(
                             dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M')}
        future = (diagnostic.get('effectiveSnapshot') or {}).get('effectiveTransitRoute')
        if not diagnostic['failureReason'].startswith('TRANSIT_TRAIN_NOT_YET_OBSERVED:'):
            real_expected['TEST_RUNNER_E2E_REAL_FORBID_FUTURE_PREVIEW'] = '1'
        withheld_future = (preview_exclusion(diagnostic, future) if future is not None and
                           diagnostic['failureReason'].startswith('TRANSIT_TRAIN_NOT_YET_OBSERVED:') else None)
        if withheld_future:
            # The API intentionally hides departed or late timetable candidates.
            # Test that absence; never weaken production freshness/visibility to display it.
            real_expected['TEST_RUNNER_E2E_REAL_FUTURE_WITHHELD'] = withheld_future
        elif diagnostic['failureReason'].startswith('TRANSIT_TRAIN_NOT_YET_OBSERVED:'):
            future = diagnostic['effectiveSnapshot']['effectiveTransitRoute']
            def seoul_clock(value, seconds=False):
                return dt.datetime.fromisoformat(value).astimezone(dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M:%S' if seconds else '%H:%M')
            real_expected['TEST_RUNNER_E2E_REAL_FUTURE_SUMMARY'] = (
                seoul_clock(future['departureAt']) + ' 출발 예측 · ' + seoul_clock(future['arrivalAt']) +
                ' 도착 예측 · 총 ' + str(future['totalMinutes']) + '분')
            real_expected['TEST_RUNNER_E2E_REAL_FUTURE_DEPARTURE_AT'] = future['departureAt']
            real_expected['TEST_RUNNER_E2E_REAL_FUTURE_RIDE_TEXT'] = json.dumps([
                s['rideTiming']['timetable']['trainNumber'] + '열차 · 시간표 · ' +
                seoul_clock(s['rideTiming']['predictedBoardingAt'], True) + ' 승차 → ' +
                seoul_clock(s['rideTiming']['predictedArrivalAt'], True) + ' 하차 예측'
                for s in future['segments'] if s['kind'] == 'SUBWAY'], ensure_ascii=False)
    if args.only == 'testVerifyIsolatedRealProviderEta':
        if args.real_isolated_evidence is None:
            parser.error('Fresh real Worker evidence is required')
        real_isolated_path = args.real_isolated_evidence.resolve(strict=True)
        if not str(real_isolated_path).startswith('/private/tmp/nolate-eta-real-e2e.'):
            parser.error('Real-isolated evidence must use its distinct private scope')
        isolated = json.loads(real_isolated_path.read_text())
        if (isolated.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER' or
                isolated.get('database') != 'H2_MEMORY_ONLY' or isolated.get('providersMocked') is not False or
                isolated.get('clockMode') != 'SYSTEM_WALL_CLOCK' or isolated.get('memberId') != 296 or
                isolated.get('scheduleId') != 363 or isolated.get('processed') != 1 or
                isolated.get('source') != 'LIVE_PROVIDER' or isolated.get('stale') is not False or
                isolated.get('failureReason') is not None or
                isolated.get('effectiveSnapshot', {}).get('accepted') is not True):
            parser.error('Rejected or synthetic ETA cannot satisfy actual-provider acceptance')
        if abs((dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(isolated['evaluatedAt'])).total_seconds()) > 180:
            parser.error('Collect a fresh real-isolated Worker evaluation')
        if (dt.datetime.fromisoformat(isolated['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival) or
                dt.datetime.fromisoformat(isolated['predictedArrivalAt']) > dt.datetime.fromisoformat(args.target_arrival)):
            parser.error('Actual ETA must meet the saved target')
        real_expected = {'TEST_RUNNER_E2E_REAL_ISOLATED': '1',
                         'TEST_RUNNER_E2E_REAL_DEPARTURE_AT': isolated['recommendedDepartureAt'],
                         'TEST_RUNNER_E2E_REAL_DEPARTURE_CLOCK': dt.datetime.fromisoformat(isolated['recommendedDepartureAt']).astimezone(
                             dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M'),
                         'TEST_RUNNER_E2E_REAL_ARRIVAL_CLOCK': dt.datetime.fromisoformat(isolated['predictedArrivalAt']).astimezone(
                             dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M'),
                         'TEST_RUNNER_E2E_REAL_MINUTES': str(isolated['travelMinutes'])}
        rides = [s['rideTiming'] for s in isolated['effectiveSnapshot']['effectiveTransitRoute']['segments'] if s['kind'] == 'SUBWAY']
        if len(rides) < 2:
            parser.error('Actual first and transfer timetable evidence is required')
        real_expected['TEST_RUNNER_E2E_REAL_RIDE_TEXT'] = json.dumps([
            timing['timetable']['trainNumber'] + '열차 · ' +
            ('첫 승차 실시간 반영' if index == 0 else '시간표') + ' · ' +
            dt.datetime.fromisoformat(timing['predictedBoardingAt']).astimezone(dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M:%S') +
            ' 승차 → ' + dt.datetime.fromisoformat(timing['predictedArrivalAt']).astimezone(dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M:%S') +
            ' 하차 예측' for index, timing in enumerate(rides)], ensure_ascii=False)
        # Compare original WALK distance with the rendered itinerary, not just the ETA clocks.
        walking = []
        for segment in isolated['effectiveSnapshot']['effectiveTransitRoute']['segments']:
            if segment['kind'] != 'WALK':
                continue
            geometry = segment.get('walkingGeometry') or {}
            meters = geometry.get('distanceMeters')
            if isinstance(meters, int) and not isinstance(meters, bool) and meters >= 0:
                scope = {'ACCESS': '접근 도보', 'TRANSFER': '환승 도보', 'EGRESS': '도착 도보'}.get(
                    segment.get('walkingScope'), '도보')
                tokens = [scope, str(meters) + 'm']
                seconds = segment.get('durationSeconds')
                if (isinstance(seconds, int) and not isinstance(seconds, bool) and seconds >= 0 and
                        (seconds + 59) // 60 == segment['durationMinutes']):
                    # 실제 설치 앱의 초 단위 표시까지 확인한다. 거리만 일치하면 통과시키지 않는다.
                    duration = ([str(seconds // 60) + '분'] if seconds >= 60 else [])
                    if seconds % 60 or seconds == 0:
                        duration.append(str(seconds % 60) + '초')
                    tokens.append('약 ' + ' '.join(duration))
                walking.append(tokens)
        if isolated.get('journeyProvider') == 'odsay' and [tokens[0] for tokens in walking] != [
                '접근 도보', '환승 도보', '도착 도보']:
            parser.error('Recorded public-station ODsay fixture must preserve all three walking distances')
        real_expected['TEST_RUNNER_E2E_REAL_WALK_TEXT'] = json.dumps(walking, ensure_ascii=False)
elif args.real_isolated_evidence is not None or args.only in ('testVerifyIsolatedRealProviderEta', 'testVerifyIsolatedRealProviderDiagnostic', 'testVerifyIsolatedRealProviderObservationExpiry'):
    parser.error('Real-isolated verification requires its explicit mode')
if args.only in ('testVerifyAcceptedRealEtaComparison', 'testVerifyRealEtaDiagnostic', 'testVerifyRealLateEtaComparison', 'testVerifyProtectedRealEtaDiagnostic'):
    real_scopes = {'ETA E2E NAVER 1007 02': ('365', '02'), 'ETA E2E NAVER 1007 03': ('366', '03'),
                   'ETA E2E NAVER 1007 04': ('367', '04')}
    if args.api_base != 'http://127.0.0.1:5522' or args.title not in real_scopes or args.real_evidence is None:
        parser.error('Accepted real ETA UI verification requires the scoped new comparison on 5522')
    expected_schedule_id, comparison_suffix = real_scopes[args.title]
    real_path = args.real_evidence.resolve(strict=True)
    if not str(real_path).startswith('/private/tmp/nolate-real-naver-requery-' + comparison_suffix + '-'):
        parser.error('Only the scoped real-provider evidence is accepted')
    real = json.loads(real_path.read_text())
    if len(real['schedules']) != 1 or len(real['jobs']) != 1 or not real['history']:
        parser.error('A single saved schedule and actual Worker evaluation are required')
    schedule, job, history = real['schedules'][0], real['jobs'][0], real['history'][0]
    utc = dt.timezone.utc
    parse_db = lambda value: dt.datetime.fromisoformat(value).replace(tzinfo=utc)
    if (schedule['id'] != expected_schedule_id or schedule['member_id'] != '296' or schedule['title'] != args.title or
            job['member_id'] != '296' or job['schedule_id'] != schedule['id'] or
            history['member_id'] != '296' or history['schedule_id'] != schedule['id'] or
            parse_db(schedule['start_at']) != dt.datetime.fromisoformat(args.target_arrival)):
        parser.error('Real evidence scope/target mismatch')
    if abs((dt.datetime.now(utc) - parse_db(history['evaluated_at'])).total_seconds()) > 180:
        parser.error('Real Worker evidence is too old; collect a fresh evaluation first')
    effective = json.loads(job['last_effective_transit_route_json'])
    departure = parse_db(job['last_recommended_departure_at'])
    accepted = args.only == 'testVerifyAcceptedRealEtaComparison'
    late = args.only == 'testVerifyRealLateEtaComparison'
    protected = args.only == 'testVerifyProtectedRealEtaDiagnostic'
    if accepted:
        if (job['last_eta_source'] != 'LIVE_PROVIDER' or job['last_eta_stale'] != '0' or job['last_eta_failure_reason'] is not None or
                history['eta_source'] != 'LIVE_PROVIDER' or history['eta_stale'] != '0' or history['failure_reason'] is not None):
            parser.error('Fallback/degraded requery is not accepted realtime ETA; no successful UI test may be claimed')
        if effective.get('accepted') is not True or effective.get('effectiveTransitRoute', {}).get('provider') != 'tmap':
            parser.error('Expected a real refreshed Tmap journey')
        if parse_db(job['last_predicted_arrival_at']) > dt.datetime.fromisoformat(args.target_arrival):
            parser.error('Accepted ETA must satisfy the saved arrival deadline')
    elif late:
        if (job['last_eta_source'] != 'LIVE_PROVIDER' or job['last_eta_stale'] != '1' or
                history['eta_source'] != 'LIVE_PROVIDER' or history['eta_stale'] != '1' or
                not (job['last_eta_failure_reason'] or '').startswith('TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE:') or
                not (history['failure_reason'] or '').startswith('TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE:') or
                effective.get('accepted') is not False or effective.get('effectiveTransitRoute', {}).get('provider') != 'tmap' or
                (effective.get('firstBoardingObservation') or {}).get('provider') != 'seoul-openapi' or
                parse_db(history['predicted_arrival_at']) <= dt.datetime.fromisoformat(args.target_arrival)):
            parser.error('Late UI verification requires a genuinely observed realtime train and missed arrival deadline')
    elif protected:
        if (schedule['id'] != '367' or job['last_eta_source'] != 'SELECTED_ROUTE' or job['last_eta_stale'] != '1' or
                not (job['last_eta_failure_reason'] or '').startswith('TRANSIT_ITINERARY_REFRESH_UNSUPPORTED:') or
                not (history['failure_reason'] or '').startswith('TRANSIT_ITINERARY_REFRESH_UNSUPPORTED:') or
                len(real['personalPlans']) != 1 or departure >= parse_db(real['personalPlans'][0]['depart_at'])):
            parser.error('Protected UI verification requires the observed earlier protected time after an actual failure')
    elif (job['last_eta_source'] != 'TIMETABLE_PROVIDER' or job['last_eta_stale'] != '1' or
            not (job['last_eta_failure_reason'] or '').startswith('TRANSIT_ARRIVAL_UNAVAILABLE:') or
            effective.get('accepted') is not False or effective.get('effectiveTransitRoute', {}).get('provider') != 'tmap'):
        parser.error('This diagnostic UI test requires an actual unaccepted Tmap timetable evaluation')
    real_expected = {'TEST_RUNNER_E2E_REAL_ACCEPTED': '1' if accepted else '0',
                     'TEST_RUNNER_E2E_REAL_PROTECTED': '1' if protected else '0',
                     'TEST_RUNNER_E2E_REAL_LATE': '1' if late else '0',
                     'TEST_RUNNER_E2E_REAL_SCHEDULE_ID': schedule['id'],
                     'TEST_RUNNER_E2E_REAL_DEPARTURE_CLOCK': departure.astimezone(dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M')}
elif args.real_evidence is not None:
    parser.error('Real evidence is restricted to its explicit accepted UI verification')
if args.only in ('testPrepareNaverComparisonJourney', 'testCommitNaverComparisonJourney'):
    if args.api_base != 'http://127.0.0.1:5522' or not args.title.startswith('ETA E2E NAVER ') or args.schedule_id is not None:
        parser.error('Real map comparison creates a new synthetic member-296 schedule on 5522 only')
native_methods = ('testInspectIsolatedNativeAlarm', 'testObserveIsolatedNativeAlarmDelivery', 'testVerifyIsolatedNativeAlarmState')
native_expected = {}
if args.only in native_methods:
    native_title = 'ETA E2E real isolated fixture' if args.real_automatic else 'ETA E2E isolated fixture'
    if args.api_base != 'http://127.0.0.1:5523' or args.schedule_id != 363 or args.title != native_title:
        parser.error('Native delivery tests require the isolated H2 fixture only')
    if args.native_evidence is None or args.native_mode is None:
        parser.error('Explicit native evidence and mode are required')
    if ((args.only == native_methods[0]) != (args.native_mode == 'inspect') or
            (args.only == native_methods[2]) != (args.native_mode == 'state')):
        parser.error('Inspection and delivery are separate methods')
    native_path = args.native_evidence.resolve(strict=True)
    if not str(native_path).startswith('/private/tmp/nolate-eta-real-e2e.' if args.real_automatic else '/private/tmp/nolate-eta-mock-e2e.'):
        parser.error('Only private evidence is accepted')
    native = json.loads(native_path.read_text())
    if args.real_automatic and (native.get('providersMocked') is not False or native.get('automaticScheduling') is not True
            or not native.get('executionThread', '').startswith('nolate-scheduler-')
            or native.get('successfulUiCreateCount') != 1 or native.get('database') != 'H2_MEMORY_ONLY'):
        parser.error('Only an actual scheduler evaluation of the UI-created private schedule may drive real native delivery')
    if (native['processed'] != 1 or (native['stale'] and args.native_mode != 'state') or
            native['savedScheduleInput']['memberId'] != 296 or
            native['savedScheduleInput']['scheduleId'] != 363):
        parser.error('An accepted synthetic Worker evaluation is required')
    if dt.datetime.fromisoformat(native['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival):
        parser.error('Native test target differs from the saved fixture')
    if args.native_mode == 'state':
        states = [s for s in native['alarmStates'] if s['member_id'] == 296 and s['schedule_id'] == 363]
        if len(states) != 1 or states[0]['operation'] not in ('UPSERT', 'CANCEL'):
            parser.error('A single scoped Worker alarm command is required')
        state = states[0]
        native_expected = {'TEST_RUNNER_E2E_NATIVE_MODE': 'state',
                           'TEST_RUNNER_E2E_NATIVE_OPERATION': state['operation'],
                           'TEST_RUNNER_E2E_NATIVE_GENERATION': str(state['generation'])}
        if state['operation'] == 'UPSERT':
            departure = dt.datetime.fromisoformat(state['trigger_at'])
            if departure <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=5):
                parser.error('An expired UPSERT cannot prove a future OS reservation; use a fresh private evaluation')
            native_expected['TEST_RUNNER_E2E_NATIVE_TRIGGER'] = departure.isoformat(timespec='seconds')
            occurrences = json.loads(state['alarm_occurrences_json'])
            plan = [{'occurrenceId': item['occurrenceId'], 'triggerAt': item['triggerAt']} for item in occurrences]
            if (not plan or len({item['occurrenceId'] for item in plan}) != len(plan) or
                    not any(item['occurrenceId'] == 'M0' and dt.datetime.fromisoformat(item['triggerAt']) == departure for item in plan)):
                parser.error('A unique occurrence plan matching the departure is required')
            native_expected['TEST_RUNNER_E2E_NATIVE_PLAN'] = json.dumps(plan)
        elif state['trigger_at'] is not None:
            parser.error('Cancelled commands must not retain a trigger')
    else:
        departure = dt.datetime.fromisoformat(native['recommendedDepartureAt'])
        matching_states = [state for state in native['alarmStates']
                           if state['member_id'] == 296 and state['schedule_id'] == 363
                           and state['operation'] == 'UPSERT'
                           and dt.datetime.fromisoformat(state['trigger_at']) == departure]
        if len(matching_states) != 1:
            parser.error('The active alarm must match this Worker evaluation; an earlier protected alarm is not a new delivery test')
        native_expected = {'TEST_RUNNER_E2E_NATIVE_MODE': args.native_mode,
                           'TEST_RUNNER_E2E_NATIVE_TRIGGER': departure.isoformat(timespec='seconds')}
elif args.native_evidence is not None or args.native_mode is not None:
    parser.error('Native arguments are scoped to their explicit test methods')
private_target_save = args.only == 'testSaveIsolatedEtaTarget'
private_notice = args.only == 'testDismissPrivateSharingDisabledNotice'
private_create = args.only == 'testCreateIsolatedEtaJourney'
if private_create and (args.api_base != 'http://127.0.0.1:5523' or args.title != ('ETA E2E real isolated fixture' if args.real_automatic else 'ETA E2E isolated fixture') or args.schedule_id is not None):
    parser.error('New UI creation is allowed only in marked private H2, with no existing schedule')
if private_notice and (args.api_base != 'http://127.0.0.1:5523' or args.title != 'ETA E2E isolated fixture'):
    parser.error('Only the observed sharing-disabled notice in private H2 may be acknowledged')
if private_target_save and (args.api_base != 'http://127.0.0.1:5523' or args.title != 'ETA E2E isolated fixture' or args.schedule_id != 363):
    parser.error('Target-save contract E2E is restricted to the marked private H2 server and fixture')
if args.fixture_phase is not None and (args.only != 'testVerifyIsolatedEtaFixture' or args.api_base != 'http://127.0.0.1:5523'):
    parser.error('Mock fixture assertions require the private H2 server and their explicit UI method')
if args.only == 'testVerifyIsolatedEtaFixture' and args.fixture_phase is None:
    parser.error('Explicit fixture phase is required')
fixture_expected = {}
natural_ui = args.only == 'testVerifyNaturalEtaFixture'
if natural_ui:
    if args.api_base != 'http://127.0.0.1:5523' or args.title != 'ETA E2E isolated fixture' or args.natural_evidence is None:
        parser.error('Natural-cadence UI verification requires explicit private H2 evidence')
    path = args.natural_evidence.resolve(strict=True)
    if not str(path).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        parser.error('Natural result must come from private H2')
    natural = json.loads(path.read_text())
    after = natural['after']
    if natural['processed'] != 1 or natural['clockMode'] != 'TEST_CLOCK_NO_WALL_TIME_WAIT':
        parser.error('A processed natural due-time evaluation is required')
    if dt.datetime.fromisoformat(natural['savedScheduleInput']['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival):
        parser.error('Natural result target does not match the actual UI schedule')
    if after['last_eta_stale'] or after['last_eta_source'] != 'LIVE_PROVIDER':
        parser.error('This UI assertion is restricted to a recovered accepted result')
    departure = dt.datetime.fromisoformat(after['last_recommended_departure_at'])
    predicted = dt.datetime.fromisoformat(after['last_predicted_arrival_at'])
    # Duration from the actual accepted journey starts at the provider search epoch;
    # Worker may keep an earlier conservative notification departure independently.
    epoch = dt.datetime.strptime(natural['routeRequests'][0]['searchDttm'], '%Y%m%d%H%M').replace(tzinfo=dt.timezone(dt.timedelta(hours=9)))
    if predicted != epoch + dt.timedelta(seconds=2452):
        parser.error('Recovered duration differs from the independent mock timetable expectation')
    fixture_expected = {
        'TEST_RUNNER_E2E_FIXTURE_DEPARTURE_CLOCK': departure.astimezone(dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M'),
        'TEST_RUNNER_E2E_FIXTURE_MINUTES': '41',
    }
elif args.natural_evidence is not None:
    parser.error('Natural evidence is valid only for its explicit private UI assertion')
if args.fixture_phase:
    if args.fixture_evidence is None:
        parser.error('Exact fixture evidence is required, not just a successful-looking label')
    evidence_path = args.fixture_evidence.resolve(strict=True)
    if not str(evidence_path).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        parser.error('Fixture evidence must come from the private isolated run')
    evidence = json.loads(evidence_path.read_text())
    if evidence.get('phase') != args.fixture_phase or evidence.get('processed') != 1:
        parser.error('Fixture phase was not processed exactly once')
    if dt.datetime.fromisoformat(evidence['targetArrivalAt']) != dt.datetime.fromisoformat(args.target_arrival):
        parser.error('UI target must match the actual private schedule')
    if args.fixture_phase in ('success', 'reconnect', 'early-transfer', 'recovered'):
        # These expectations are independent of the returned ETA values.
        epoch = dt.datetime.fromisoformat(evidence['epoch'])
        fixture_expected = {
            'TEST_RUNNER_E2E_FIXTURE_DEPARTURE_CLOCK': epoch.astimezone(dt.timezone(dt.timedelta(hours=9))).strftime('%H:%M'),
            'TEST_RUNNER_E2E_FIXTURE_MINUTES': '41' if args.fixture_phase in ('success', 'early-transfer') else '46',
        }
elif args.fixture_evidence is not None:
    parser.error('Fixture evidence is only valid for an isolated fixture phase')
if args.expected_diagnostic is not None and args.only not in ('testVerifyTimetableEtaPresentation', 'testVerifyCurrentTimetableEtaPresentation'):
    parser.error('Expected diagnostic is only valid for its scoped UI assertion')
if args.device != APPROVED_DEVICE:
    parser.error('This recovery run is restricted to the approved dedicated simulator')
if not args.title.startswith('ETA E2E '):
    parser.error('Only synthetic ETA E2E titles are supported')
target = dt.datetime.fromisoformat(args.target_arrival)
if target.tzinfo is None or target.utcoffset() != dt.timedelta(hours=9):
    parser.error('Target arrival must explicitly use Asia/Seoul offset +09:00')
if args.only != 'testInspectEtaJourney' and target <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=3):
    parser.error('Target arrival is too close or already past; do not create a stale comparison')
if args.only in SAVE_METHODS and not args.allow_save:
    parser.error('Final UI save requires --allow-save')
if args.allow_save and args.only not in SAVE_METHODS:
    parser.error('--allow-save is valid only for the final UI save method')
if args.inspect_odsay_after_login and (args.only != 'testLoginDedicatedEtaAccount' or args.schedule_id != 363):
    parser.error('Combined read-only search requires explicit login and schedule 363')
if args.assert_quota_failure and not args.inspect_odsay_after_login:
    parser.error('Quota assertion requires the scoped provider-search journey')
if args.inspect_tmap_after_login and (args.only != 'testLoginDedicatedEtaAccount' or args.schedule_id != 363):
    parser.error('TMAP search follow-up requires explicit login and schedule 363')
if args.inspect_tmap_after_login and args.inspect_odsay_after_login:
    parser.error('A single run must select exactly one provider-search follow-up')
if args.existing_title is not None or args.schedule_id is not None:
    titles = ('ETA E2E 1004 0030', 'ETA E2E 1004 transfer') + (('ETA E2E isolated fixture',) if args.api_base.endswith(':5523') else ())
    if args.real_isolated:
        titles = ('ETA E2E real isolated fixture',)
    real_comparison_edit = (args.only == 'testRescheduleNaverComparisonJourney' and
        args.api_base == 'http://127.0.0.1:5522' and
        (args.schedule_id, args.existing_title, args.title) in (
            (364, 'ETA E2E NAVER 1007 01', 'ETA E2E NAVER 1007 01'),
            (367, 'ETA E2E NAVER 1007 04', 'ETA E2E NAVER 1007 04')))
    if not real_comparison_edit and (args.schedule_id != 363 or args.existing_title not in titles):
        parser.error('Existing-schedule operations are restricted to the observed synthetic schedule 363')

# CoreSimulator may stop responding under host pressure. Fail before any app writes
# instead of leaving an unbounded device discovery process behind.
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'booted', '-j'], timeout=30))
selected = [d for group in devices['devices'].values() for d in group if d['udid'] == args.device]
if len(selected) != 1 or selected[0]['state'] != 'Booted' or selected[0]['name'] != APPROVED_DEVICE_NAME:
    raise SystemExit('The approved simulator is not booted with the expected identity')
subprocess.run(['xcrun', 'simctl', 'get_app_container', args.device, 'com.anonymous.nolatefe', 'app'],
               check=True, stdout=subprocess.DEVNULL, timeout=30)
with urllib.request.urlopen(args.api_base + '/health/readiness', timeout=5) as response:
    if response.status != 200 or json.loads(response.read()).get('status') != 'UP':
        raise SystemExit('Local backend is not ready; no UI writes attempted')
    if args.real_isolated and response.headers.get('X-NoLate-Eta-Real-Isolation') != 'h2-real-providers':
        raise SystemExit('Real-isolated marker missing; refuse an unknown or mock server')
    if args.api_base.endswith(':5523') and not args.real_isolated and response.headers.get('X-NoLate-Eta-Fixture') != 'h2-memory-only':
        raise SystemExit('Private fixture marker missing; refuse to use an unknown server')

args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
env = os.environ.copy()
env.update({
    'TEST_RUNNER_E2E_DEVICE_ID': args.device,
    'TEST_RUNNER_E2E_MEMBER_ID': '296',
    'TEST_RUNNER_E2E_ETA_TITLE': args.title,
    'TEST_RUNNER_E2E_ETA_TARGET_ISO8601': args.target_arrival,
    'TEST_RUNNER_E2E_ALLOW_SAVE': '1' if args.allow_save else '0',
    'TEST_RUNNER_E2E_EXISTING_TITLE': args.existing_title or '',
    'TEST_RUNNER_E2E_SCHEDULE_ID': str(args.schedule_id or ''),
    'TEST_RUNNER_E2E_RESTART_ONLY': '1' if args.only == 'testRestartDedicatedEtaApp' else '0',
    'TEST_RUNNER_E2E_LOGIN_FOLLOWUP_ODSAY': '1' if args.inspect_odsay_after_login else '0',
    'TEST_RUNNER_E2E_ASSERT_QUOTA_FAILURE': '1' if args.assert_quota_failure else '0',
    'TEST_RUNNER_E2E_LOGIN_FOLLOWUP_TMAP': '1' if args.inspect_tmap_after_login else '0',
    'TEST_RUNNER_E2E_EXPECTED_DIAGNOSTIC': args.expected_diagnostic or '',
    'TEST_RUNNER_E2E_FIXTURE_PHASE': args.fixture_phase or ('contract-save' if private_target_save or natural_ui or quota_ui else ''),
    'TEST_RUNNER_E2E_PRIVATE_TARGET_SAVE': '1' if private_target_save else '0',
    'TEST_RUNNER_E2E_PRIVATE_NOTICE': '1' if private_notice else '0',
    'TEST_RUNNER_E2E_PRIVATE_CREATE': '1' if private_create else '0',
    'TEST_RUNNER_E2E_PRIVATE_LOGIN': '1' if args.api_base.endswith(':5523') and args.only == 'testLoginDedicatedEtaAccount' else '0',
    'TEST_RUNNER_E2E_NATURAL_UI': '1' if natural_ui else '0',
    'TEST_RUNNER_E2E_REAL_AUTOMATIC': '1' if args.real_automatic else '0',
})
env.update(fixture_expected)
env.update(native_expected)
env.update(real_expected)
env.update(quota_expected)
if args.only == 'testLoginDedicatedEtaAccount':
    if args.credentials is None:
        parser.error('Explicit synthetic credentials are required for UI login')
    fixture = json.loads(args.credentials.read_text())
    if fixture.get('memberId') != 296 or not fixture.get('email', '').endswith('@example.test'):
        raise SystemExit('Credentials do not match the approved synthetic member')
    env.update({'TEST_RUNNER_E2E_LOGIN_ONLY': '1',
                'TEST_RUNNER_E2E_EMAIL': fixture['email'],
                'TEST_RUNNER_E2E_PASSWORD': fixture['password']})
elif args.credentials is not None:
    parser.error('Credentials may only be passed to the explicit UI login method')
command = [
    'xcodebuild', '-project', str(Path(__file__).resolve().parent / 'NoLateE2E.xcodeproj'),
    '-scheme', 'NoLateE2E', '-destination', 'platform=iOS Simulator,id=' + args.device,
    '-parallel-testing-enabled', 'NO', '-derivedDataPath', '/private/tmp/nolate-eta-xcuitest-20261003',
    # Scoped UI attachments already preserve failures. A full simulator sysdiagnose can
    # block the next dedicated run for ten minutes without adding ETA-specific evidence.
    '-collect-test-diagnostics', 'never',
    '-resultBundlePath', str(args.output / 'result.xcresult'),
    '-only-testing:NoLateE2ETests/NoLateEtaJourneyE2ETests/' + args.only,
    'test',
]
metadata = {'device': args.device, 'memberScope': 296, 'method': args.only,
            'title': args.title, 'targetArrival': args.target_arrival,
            'startedAt': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(),
            'allowSave': args.allow_save, 'apiBase': args.api_base, 'fixturePhase': args.fixture_phase,
            'privateTargetSave': private_target_save}
metadata['nativeMode'] = args.native_mode
metadata['realIsolated'] = args.real_isolated
metadata['nativeTriggerAt'] = native_expected.get('TEST_RUNNER_E2E_NATIVE_TRIGGER')
(args.output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
if args.fixture_phase or private_target_save or natural_ui or quota_ui:
    navigation = command.copy()
    navigation[navigation.index('-resultBundlePath') + 1] = str(args.output / 'navigation-reset.xcresult')
    navigation[-2] = '-only-testing:NoLateE2ETests/NoLateEtaJourneyE2ETests/testResetIsolatedEtaNavigation'
    with (args.output / 'navigation-reset.log').open('w') as log:
        reset = subprocess.run(navigation, env=env, stdout=log, stderr=subprocess.STDOUT)
    if reset.returncode:
        raise SystemExit('Private navigation reset failed; inspect its result bundle')
    subprocess.run(['xcrun', 'simctl', 'openurl', args.device, 'nolate://schedule/363'], check=True)
with (args.output / 'run.log').open('w') as log:
    result = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT)
if result.returncode == 0 and natural_ui:
    # Freeze the real GET response before the following UI edit invalidates this generation.
    public_path = path.parent / 'success-status.json'
    response_bytes = public_path.read_bytes()
    public = json.loads(response_bytes)
    if (public.get('scheduleId') != 363 or public.get('source') != 'LIVE_PROVIDER' or public.get('stale') is not False
            or dt.datetime.fromisoformat(public['recommendedDepartureAt']) != departure
            or dt.datetime.fromisoformat(public['predictedArrivalAt']) != predicted):
        raise SystemExit('The captured public API response does not match the visible natural result')
    (path.parent / 'natural-recovered-status.json').write_bytes(response_bytes)
if result.returncode == 0 and args.fixture_phase == 'success' and evidence.get('successfulUiCreateCount') == 1 and evidence.get('successfulUiSaveCount') == 0:
    # Each stage may later change the same synthetic schedule; retain its public evidence immutably.
    source = evidence_path.parent / 'success-status.json'
    (evidence_path.parent / 'created-success-status.json').write_bytes(source.read_bytes())
print(json.dumps({'exitCode': result.returncode, 'results': str(args.output), 'method': args.only}))
raise SystemExit(result.returncode)
