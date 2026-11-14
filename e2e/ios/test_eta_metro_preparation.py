import json
import unittest
from unittest.mock import MagicMock, patch
from eta_metro_preparation import prepare_private_metro_bundle


def response(status=200, payload=b''):
    result = MagicMock(status=status)
    result.read.side_effect = [payload, b'']
    return result


class MetroPreparationTest(unittest.TestCase):
    def test_reads_the_actual_manifest_asset_only_on_owned_8086_without_launching_app(self):
        manifest = response(payload=json.dumps({'launchAsset': {
            'url': 'http://localhost:8086/index.bundle?platform=ios&transform.engine=hermes'}}).encode())
        bundle = response(payload=b'synthetic-compiled-entry')
        with patch('eta_metro_preparation.http.client.HTTPConnection') as factory:
            factory.return_value.getresponse.side_effect = [manifest, bundle]
            result = prepare_private_metro_bundle()
            self.assertEqual(result['bundleBytes'], 24)
            self.assertFalse(result['appLaunched'])
            self.assertFalse(result['uiOrDeliveryDeadlineChanged'])
            self.assertEqual(factory.return_value.request.call_args_list[1].args,
                             ('GET', '/index.bundle?platform=ios&transform.engine=hermes'))
            factory.assert_called_once_with('127.0.0.1', 8086, timeout=120)
            factory.return_value.close.assert_called_once()

    def test_refuses_foreign_or_redirected_launch_assets_before_the_bundle_request(self):
        for url in ('https://example.test/index.bundle', 'http://localhost:8085/index.bundle',
                    'http://127.0.0.1:8086/not-a-bundle', 'http://user@localhost:8086/index.bundle',
                    'http://localhost:8086/index.bundle#fragment'):
            with self.subTest(url=url), patch('eta_metro_preparation.http.client.HTTPConnection') as factory:
                factory.return_value.getresponse.return_value = response(payload=json.dumps({'launchAsset': {'url': url}}).encode())
                with self.assertRaises(RuntimeError):
                    prepare_private_metro_bundle()
                self.assertEqual(factory.return_value.request.call_count, 1)
                factory.return_value.close.assert_called_once()

    def test_non_ready_and_malformed_manifests_do_not_turn_into_launch_or_retry(self):
        for manifest in (response(status=302), response(payload=b'not-json'), response(payload=b'{}')):
            with self.subTest(manifest=manifest), patch('eta_metro_preparation.http.client.HTTPConnection') as factory:
                factory.return_value.getresponse.return_value = manifest
                with self.assertRaises(RuntimeError):
                    prepare_private_metro_bundle()
                self.assertEqual(factory.return_value.request.call_count, 1)

    def test_empty_or_failed_bundle_is_not_an_e2e_success(self):
        for bundle in (response(status=500), response(payload=b'')):
            with self.subTest(bundle=bundle), patch('eta_metro_preparation.http.client.HTTPConnection') as factory:
                factory.return_value.getresponse.side_effect = [response(payload=json.dumps({'launchAsset': {
                    'url': 'http://127.0.0.1:8086/index.bundle'}}).encode()), bundle]
                with self.assertRaises(RuntimeError):
                    prepare_private_metro_bundle()
                self.assertEqual(factory.return_value.request.call_count, 2)


if __name__ == '__main__':
    unittest.main()
