"""Compile the owned Metro entry before measuring any installed-app UI behavior."""
import hashlib
import http.client
import json
import time
from urllib.parse import urlsplit


def prepare_private_metro_bundle():
    started = time.monotonic()
    connection = http.client.HTTPConnection('127.0.0.1', 8086, timeout=120)
    try:
        connection.request('GET', '/', headers={'Accept': 'application/expo+json', 'Expo-Platform': 'ios'})
        manifest = connection.getresponse()
        if manifest.status != 200:
            raise RuntimeError('private_metro_manifest_not_ready')
        payload = manifest.read(1048577)
        if len(payload) > 1048576:
            raise RuntimeError('private_metro_manifest_too_large')
        try:
            document = json.loads(payload)
            url = urlsplit(document['launchAsset']['url'])
        except (ValueError, TypeError, KeyError):
            raise RuntimeError('private_metro_launch_asset_missing') from None
        if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.port != 8086 or
                url.username is not None or url.password is not None or url.fragment or not url.path.endswith('.bundle')):
            raise RuntimeError('private_metro_launch_asset_outside_owned_server')
        connection.request('GET', url.path + ('?' + url.query if url.query else ''))
        bundle = connection.getresponse()
        if bundle.status != 200:
            raise RuntimeError('private_metro_bundle_not_ready')
        digest = hashlib.sha256()
        count = 0
        while chunk := bundle.read(65536):
            count += len(chunk)
            digest.update(chunk)
            if time.monotonic() - started > 180:
                raise RuntimeError('private_metro_preparation_deadline')
        if count == 0:
            raise RuntimeError('private_metro_bundle_empty')
        return {'result': 'PASSED', 'classification': 'OWNED_METRO_PREPARATION_NOT_APP_E2E',
                'port': 8086, 'bundleBytes': count, 'bundleSha256': digest.hexdigest(),
                'elapsedSeconds': round(time.monotonic() - started, 3),
                'appLaunched': False, 'providerRequestSent': False, 'uiOrDeliveryDeadlineChanged': False}
    finally:
        connection.close()
