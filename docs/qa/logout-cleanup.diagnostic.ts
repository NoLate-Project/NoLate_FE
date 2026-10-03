/** Historical reproduction entry point; now runs the fixed regression suite.
 * npm test -- --runInBand --no-watchman --testRegex 'logout-cleanup\\.diagnostic\\.ts$'
 * The original pending trace is preserved in the QA report.
 */
import '../../__tests__/logoutCleanupIntegration.test';
