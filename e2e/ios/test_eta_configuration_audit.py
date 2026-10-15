"""No-network acceptance and privacy gates for configuration auditing, not actual ETA evidence."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('eta_configuration_audit', Path(__file__).with_name('run-eta-configuration-audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ConfigurationAuditTest(unittest.TestCase):
    def sample(self):
        return dict({field: True for field in audit.MATCH_FIELDS},
                    classification='APPLIED_BEAN_AND_DIRECT_DIAGNOSTIC_CONFIGURATION_AUDIT',
                    externalTransitHttpCalls=0, transport='IN_MEMORY_MOCK_REQUEST_FACTORY',
                    rawCredentialsUrlsOrHashesRetained=False,
                    fileVsEnvironmentDifferences={field: False for field in audit.ENV_FIELDS})

    def test_matching_configuration_passes_only_the_no_network_configuration_gate(self):
        self.assertTrue(audit.validate_audit(self.sample()))

    def test_each_actual_request_mismatch_fails_the_gate(self):
        for field in audit.MATCH_FIELDS:
            with self.subTest(field=field):
                value = self.sample()
                value[field] = False
                self.assertFalse(audit.validate_audit(value))

    def test_extra_secret_fields_or_missing_fields_are_rejected(self):
        for field in ('rawKey', 'uri', 'keyHash'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                audit.validate_audit(self.sample() | {field: 'fixture-secret'})
        value = self.sample()
        value.pop('effectiveCredentialMatches')
        with self.assertRaises(ValueError):
            audit.validate_audit(value)

    def test_actual_http_changed_scope_or_truthy_strings_are_not_accepted(self):
        for mutation in ({'externalTransitHttpCalls': 1}, {'externalTransitHttpCalls': False},
                         {'transport': 'REAL_HTTP'}, {'rawCredentialsUrlsOrHashesRetained': True},
                         {'classification': 'REAL_PROVIDER_E2E'}, {'effectiveCredentialMatches': 'true'},
                         {'effectiveCredentialMatches': 1}):
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                audit.validate_audit(self.sample() | mutation)

    def test_environment_values_are_booleans_not_raw_credentials(self):
        value = self.sample()
        value['fileVsEnvironmentDifferences']['SEOUL_SUBWAY_API_KEY'] = 'fixture-secret'
        with self.assertRaises(ValueError):
            audit.validate_audit(value)


if __name__ == '__main__':
    unittest.main()
