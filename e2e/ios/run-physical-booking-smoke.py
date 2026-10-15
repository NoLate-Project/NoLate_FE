#!/usr/bin/env python3
"""Test real carrier URL dispatch on an explicit physical iPhone; no account actions."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True, help='Explicit connected physical iPhone UDID')
parser.add_argument('--output', required=True, type=Path, help='New private directory outside the repository')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
output = args.output.resolve()
if not str(output).startswith('/private/tmp/nolate-physical-'):
    parser.error('Use a new /private/tmp/nolate-physical-* output directory.')
output.mkdir(mode=0o700, parents=True, exist_ok=False)

def command(*values, **kwargs):
    return subprocess.run(values, check=True, **kwargs)

command('xcrun', 'devicectl', 'list', 'devices', '--quiet', '--json-output', str(output / 'devices.json'))
devices = json.loads((output / 'devices.json').read_text())['result']['devices']
device = next((d for d in devices if d.get('hardwareProperties', {}).get('udid') == args.device), None)
if not device or device.get('hardwareProperties', {}).get('reality') != 'physical':
    parser.error('The explicit device must be a physical device reported by devicectl.')
command('xcrun', 'devicectl', 'device', 'info', 'apps', '--device', args.device,
        '--include-default-apps', '--filter', "Name CONTAINS 'NoLate' OR Name CONTAINS '코레일' OR Name CONTAINS '티머니'",
        '--quiet', '--json-output', str(output / 'installed-apps.json'))
apps = json.loads((output / 'installed-apps.json').read_text())['result']['apps']
identifiers = {a['bundleIdentifier'] for a in apps}
required = {'com.anonymous.nolatefe', 'com.korail.KorailTalk', 'kr.co.tmoney.tia'}
if not required.issubset(identifiers):
    parser.error('Install NoLate, the actual Korail app, and TmoneyGO before this test.')
expected_build = json.loads((repo / 'app.json').read_text())['ios']['buildNumber']
installed = next(a for a in apps if a['bundleIdentifier'] == 'com.anonymous.nolatefe')
if installed['bundleVersion'] != expected_build:
    parser.error('Update NoLate to the current source build before this test.')

source = repo / 'e2e/ios'
shutil.copytree(source / 'NoLateE2E.xcodeproj', output / 'NoLateE2E.xcodeproj')
shutil.copy2(source / 'PhysicalBookingSmokeTests.swift', output / 'NoLateE2ETests.swift')
environment = os.environ.copy()
for file, constant, key in [
    ('TrainBookingAction.tsx', 'TRAIN_BOOKING_APP_URL', 'E2E_KORAIL_URL'),
    ('BusBookingAction.tsx', 'BUS_BOOKING_APP_URL', 'E2E_TMONEY_URL'),
]:
    text = (repo / 'src/modules/schedule/components/route' / file).read_text()
    match = re.search(r'export const ' + constant + r"\s*=\s*'([^']+)'", text)
    if not match:
        parser.error('Cannot read the current product booking URL: ' + constant)
    environment['TEST_RUNNER_' + key] = match.group(1)

values = ['xcodebuild', '-project', str(output / 'NoLateE2E.xcodeproj'), '-scheme', 'NoLateE2E',
          '-destination', 'id=' + args.device, '-derivedDataPath', str(output / 'derived'),
          '-resultBundlePath', str(output / 'result.xcresult'), '-parallel-testing-enabled', 'NO',
          'SUPPORTED_PLATFORMS=iphoneos', 'CODE_SIGN_STYLE=Automatic',
          'CODE_SIGN_IDENTITY=Apple Development', 'DEVELOPMENT_TEAM=457QQLB6H6',
          'PRODUCT_BUNDLE_IDENTIFIER=com.anonymous.nolatefe.physicaltests',
          '-allowProvisioningUpdates', 'test']
with (output / 'run.log').open('w') as log:
    result = subprocess.run(values, env=environment, stdout=log, stderr=subprocess.STDOUT)
print('Physical booking smoke exit:', result.returncode, '; private result:', output / 'result.xcresult')
raise SystemExit(result.returncode)
