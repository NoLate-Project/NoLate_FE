#!/usr/bin/env python3
"""Update a dedicated simulator's query allowlist; optionally install a synthetic handler."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--bus', action='store_true')
parser.add_argument('--app-fixture', choices=['absent', 'install'], required=True)
args = parser.parse_args()
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', '-j']))
device = next(item for group in devices['devices'].values() for item in group if item['udid'] == args.device)
if 'E2E' not in device['name'] or device['state'] != 'Booted':
    raise SystemExit('Use a booted dedicated E2E simulator.')
if not str(args.output.resolve()).startswith('/private/tmp/nolate-train-app-'):
    raise SystemExit('Use a new private /private/tmp/nolate-train-app-* output directory.')
args.output.mkdir(mode=0o700, parents=True, exist_ok=False)

def run(*command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)

source = Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', args.device, 'com.anonymous.nolatefe', 'app'], text=True).strip())
app = args.output / 'NoLateTrainBookingTest.app'
run('ditto', str(source), str(app))
source_plist = plistlib.loads((Path(__file__).resolve().parents[2] / 'ios/NoLateFE/Info.plist').read_bytes())
plist_path = app / 'Info.plist'
plist = plistlib.loads(plist_path.read_bytes())
# Reuse the existing native dev build; only the query allowlist changes for this JS feature.
# A release still needs a normal native rebuild to include the production Info.plist edit.
plist['LSApplicationQueriesSchemes'] = source_plist['LSApplicationQueriesSchemes']
assert plist['LSApplicationQueriesSchemes'].count('korailtalk') == 1
plist_path.write_bytes(plistlib.dumps(plist))
run('codesign', '--force', '--sign', '-', '--generate-entitlement-der', str(app))
subprocess.run(['xcrun', 'simctl', 'terminate', args.device, 'com.anonymous.nolatefe'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
run('xcrun', 'simctl', 'install', args.device, str(app))

fixture_id = 'dev.nolate.busbookingfixture' if args.bus else 'dev.nolate.trainbookingfixture'
if args.app_fixture == 'absent':
    # Only this test-owned package is removed; never an actual carrier application.
    subprocess.run(['xcrun', 'simctl', 'uninstall', args.device, fixture_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
else:
    host = args.output / 'SyntheticTrainBooking.app'; host.mkdir()
    (host / 'Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': fixture_id, 'CFBundleName': 'SyntheticTrainBooking',
        'CFBundleExecutable': 'SyntheticTrainBooking', 'CFBundlePackageType': 'APPL',
        'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0', 'UILaunchScreen': {},
        'LSRequiresIPhoneOS': True, 'MinimumOSVersion': '16.6', 'UIDeviceFamily': [1],
        'CFBundleURLTypes': [{'CFBundleURLSchemes': ['tmoneytia' if args.bus else 'korailtalk']}],
        'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False},
    }))
    sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
    run('xcrun', 'swiftc', '-sdk', sdk, '-target', 'arm64-apple-ios16.6-simulator', '-parse-as-library',
        str(Path(__file__).with_name('BusBookingFixture.swift' if args.bus else 'TrainBookingFixture.swift')), '-o', str(host / 'SyntheticTrainBooking'), env={**os.environ, 'SDKROOT': sdk})
    run('codesign', '--force', '--sign', '-', str(host))
    run('xcrun', 'simctl', 'install', args.device, str(host))
print('Dedicated simulator query allowlist updated; synthetic handler:', args.app_fixture)
