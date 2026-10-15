#!/usr/bin/env python3
"""Read-only proof of real new-form POST -> real Worker -> installed UI in marked H2."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('saved_input', Path(__file__).with_name('verify-eta-saved-input.py'))
saved_input = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saved_input)


def assert_ui(root, name, method):
    metadata = json.loads((root / name / 'metadata.json').read_text())
    assert metadata['method'] == method and metadata['apiBase'] == 'http://127.0.0.1:5523'
    assert metadata['device'] == saved_input.DEVICE and metadata['memberScope'] == 296
    summary = json.loads(subprocess.check_output([
        'xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(root / name / 'result.xcresult')]))
    assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
    assert summary['failedTests'] == summary['skippedTests'] == 0
    assert all(item['device']['deviceId'] == saved_input.DEVICE for item in summary['devicesAndConfigurations'])
    return metadata


def verify(root, create_ui='ui-create'):
    root = root.resolve(strict=True)
    if not str(root).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        raise ValueError('Private evidence root required')
    before = json.loads((root / 'before-create.json').read_text())
    assert before == {'scheduleCount': 0, 'jobCount': 0, 'historyCount': 0}
    # Preserve unsuccessful attempts instead of overwriting their result bundles.
    # A retry must still pass the same device, API, method and actual-create checks.
    if not create_ui.startswith('ui-create') or Path(create_ui).name != create_ui:
        raise ValueError('A scoped creation UI result directory is required')
    metadata = assert_ui(root, create_ui, 'testCreateIsolatedEtaJourney')
    assert metadata['allowSave'] is True
    saved = json.loads((root / 'ui-saved-input.json').read_text())
    worker = json.loads((root / 'saved-success.json').read_text())
    saved_input.verify_worker(saved, worker, metadata['targetArrival'], operation='create')
    route = json.loads(saved['savedScheduleInput']['selectedRouteJson'])
    rides = [leg for leg in route['transitLegs'] if leg['kind'] == 'SUBWAY']
    assert [leg['providerRouteId'] for leg in rides] == ['11004', '11002']
    assert [leg['durationSeconds'] for leg in rides] == [2882, 481]
    assert len(route['pathCoords']) >= 3
    assert_ui(root, 'ui-created-success', 'testVerifyIsolatedEtaFixture')
    public_path = root / 'created-success-status.json'
    public = json.loads((public_path if public_path.exists() else root / 'success-status.json').read_text())
    assert public['source'] == 'LIVE_PROVIDER' and public['confidence'] == 'HIGH'
    assert public['travelMinutes'] == 41 and public['stale'] is False
    assert saved_input.instant(public['predictedArrivalAt']) == saved_input.instant(worker['epoch']) + saved_input.dt.timedelta(seconds=2452)
    return {'stage': 1, 'result': 'PASSED', 'passedScope': 'NEW_SCHEDULE_CREATION_AND_REQUERY',
            'classification': 'ISOLATED_MOCK_FEED_SIMULATOR_E2E', 'database': 'H2_MEMORY_ONLY',
            'device': saved_input.DEVICE, 'productionDatabaseModified': False,
            'newScheduleCreationUiVerified': True, 'actualUiCreateCount': 1, 'actualUiEditCount': 0,
            'selectedRouteInputPreserved': True, 'appShowsUpdatedEta': True,
            'targetArrivalAt': metadata['targetArrival'], 'providerFeed': 'MOCK', 'pushDelivery': 'MOCK_ACK',
            'verifiedPublicApiSummary': {key: public.get(key) for key in (
                'scheduleId', 'source', 'confidence', 'stale', 'travelMinutes',
                'recommendedDepartureAt', 'predictedArrivalAt')},
            'createUiResultBundle': str(root / create_ui / 'result.xcresult'),
            'updatedEtaUiResultBundle': str(root / 'ui-created-success/result.xcresult'),
            'realProviderCorrectionVerified': False, 'nativeAlarmDeliveryVerified': False,
            'realWorldAccuracyVerified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--create-ui', default='ui-create')
    args = parser.parse_args()
    print(json.dumps(verify(args.root, args.create_ui), indent=2, ensure_ascii=False))
