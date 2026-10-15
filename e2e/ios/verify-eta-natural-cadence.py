#!/usr/bin/env python3
"""Independent due-time/cadence/history checks for private installed-app E2E."""
import argparse
import datetime as dt
import importlib.util
import json
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('created_input', Path(__file__).with_name('verify-eta-created-input.py'))
created = importlib.util.module_from_spec(spec)
spec.loader.exec_module(created)
instant = created.saved_input.instant


def verify_round(row):
    before, after = row['before'], row['after']
    now = instant(row['now'])
    assert row['clockMode'] == 'TEST_CLOCK_NO_WALL_TIME_WAIT'
    assert row['savedScheduleInput'] == row['savedScheduleAfterEvaluation']
    assert row['successfulUiCreateCount'] == 1
    if row['command'] == 'natural-early':
        assert row['processed'] == 0 and row['historyAfter'] == row['historyBefore']
        assert before == after, 'Not-due execution mutated the job'
        return None
    if row['command'] == 'natural-claim-stale':
        assert row['processed'] == 0 and row['historyAfter'] == row['historyBefore']
        assert before['status'] == 'ACTIVE' and after['status'] == 'PROCESSING'
        return None
    if row['command'] == 'natural-persist-stale':
        assert row['processed'] == 0 and row['historyAfter'] == row['historyBefore']
        assert before == after and row['rejection'] == 'LEASE_LOST_AFTER_UI_EDIT'
        return None
    assert row['processed'] == 1 and row['historyAfter'] == row['historyBefore'] + 1
    assert after['check_count'] == before['check_count'] + 1
    assert after['status'] == 'ACTIVE' and after['retry_count'] == 0
    assert instant(row['latestTargetArrivalAt']) == instant(row['savedScheduleInput']['targetArrivalAt'])
    assert now >= instant(before['next_check_at']), 'Worker ran a not-due task'
    if row['command'] != 'natural-start':
        assert now == instant(before['next_check_at']), 'Do not skip or force the natural due time'
    departure = instant(after['last_recommended_departure_at'])
    assert now < departure, 'Cadence sample must precede conservative departure'
    remaining = (departure - now).total_seconds()
    if remaining > 1800:
        interval = min(300, remaining - 1800)
    elif remaining > 900:
        interval = min(120, remaining - 900)
    else:
        interval = min(60, remaining)
    assert instant(after['next_check_at']) == now + dt.timedelta(seconds=interval), 'Adaptive cadence mismatch'
    requests = row['routeRequests']
    assert 1 <= len(requests) <= 3
    assert len({request['searchDttm'] for request in requests}) == len(requests)
    saved = row['savedScheduleInput']
    for request in requests:
        assert request['startX'] == saved['originLng'] and request['startY'] == saved['originLat']
        assert request['endX'] == saved['destinationLng'] and request['endY'] == saved['destinationLat']
    if row['command'] == 'natural-retry':
        assert after['last_eta_stale'] is True and after['last_eta_failure_reason'] is not None
        assert before['last_recommended_departure_at'] == after['last_recommended_departure_at']
    else:
        assert after['last_eta_source'] == 'LIVE_PROVIDER' and after['last_eta_stale'] is False
        assert after['last_eta_failure_reason'] is None
        # The real overlay caches the first vehicle during bounded candidate probes.
        # Later probes move the fixture epoch but are not necessarily the selected journey.
        first_search = dt.datetime.strptime(requests[0]['searchDttm'], '%Y%m%d%H%M').replace(tzinfo=created.saved_input.SEOUL)
        assert instant(after['last_predicted_arrival_at']) == first_search + dt.timedelta(seconds=2452)
        assert instant(after['last_predicted_arrival_at']) <= instant(saved['targetArrivalAt'])
    return int(interval)


def verify(root):
    root = root.resolve(strict=True)
    if not str(root).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        raise ValueError('Private H2 evidence root required')
    files = sorted((path for path in root.glob('natural-*.json') if re.fullmatch(r'natural-[0-9]+', path.stem)),
                   key=lambda path: int(path.stem.split('-')[-1]))
    rows = [json.loads(path.read_text()) for path in files]
    intervals = [value for row in rows if (value := verify_round(row)) is not None]
    assert {300, 120, 60}.issubset(intervals), 'All 5/2/1-minute bands are required'
    evaluations = [row for row in rows if row['processed'] == 1]
    assert len(evaluations) >= 4
    assert len({row['latestEvaluationId'] for row in evaluations}) == len(evaluations)
    assert any(row['command'] == 'natural-early' for row in rows)
    retry = next(index for index, row in enumerate(rows) if row['command'] == 'natural-retry')
    assert rows[retry + 1]['command'] == 'natural-recovered'
    assert rows[retry + 1]['before'] == rows[retry]['after'], 'Recovery must use persisted retry state'
    stale_claim = next(row for row in rows if row['command'] == 'natural-claim-stale')
    stale_rejection = next(row for row in rows if row['command'] == 'natural-persist-stale')
    assert stale_rejection['before']['notification_generation'] > stale_claim['after']['notification_generation']
    assert instant(stale_rejection['savedScheduleInput']['targetArrivalAt']) != instant(stale_claim['savedScheduleInput']['targetArrivalAt'])
    created.assert_ui(root, 'ui-stage2-target', 'testSaveIsolatedEtaTarget')
    created.assert_ui(root, 'ui-stage2-new-generation', 'testSaveIsolatedEtaTarget')
    created.assert_ui(root, 'ui-natural-recovered', 'testVerifyNaturalEtaFixture')
    public = json.loads((root / 'natural-recovered-status.json').read_text())
    recovered = rows[retry + 1]
    assert public['source'] == 'LIVE_PROVIDER' and public['stale'] is False and public['confidence'] == 'HIGH'
    assert public['travelMinutes'] == 41
    assert instant(public['recommendedDepartureAt']) == instant(recovered['after']['last_recommended_departure_at'])
    assert instant(public['predictedArrivalAt']) == instant(recovered['after']['last_predicted_arrival_at'])
    return {'stage': 2, 'result': 'PASSED', 'classification': 'ISOLATED_MOCK_FEED_TEST_CLOCK_SIMULATOR_E2E',
            'device': created.saved_input.DEVICE, 'database': 'H2_MEMORY_ONLY', 'productionDatabaseModified': False,
            'clockMode': 'TEST_CLOCK_NO_WALL_TIME_WAIT', 'evaluationCount': len(evaluations),
            'observedCadenceSeconds': sorted(set(intervals), reverse=True), 'notDueExecutionNoOp': True,
            'temporaryFailureRecovered': True, 'oldGenerationPersistRejected': True,
            'appShowsRecoveredEta': True, 'providerFeed': 'MOCK', 'pushDelivery': 'MOCK_ACK',
            'realSchedulerWallTimeVerified': False, 'nativeAlarmDeliveryVerified': False,
            'realWorldAccuracyVerified': False,
            'uiResultBundle': str(root / 'ui-natural-recovered/result.xcresult')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.root), ensure_ascii=False, indent=2))
