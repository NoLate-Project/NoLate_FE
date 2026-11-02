# Tracked ETA replay fixtures

The dated JSON files tracked here are inputs to the offline regression tests in
`e2e/ios/test_eta_comparison.py`, `test_eta_real_isolation.py`,
`test_eta_map_display.py`, and `test_eta_walking_boundaries.py`.
They replay historical provider/worker output; they do not prove current live
provider availability or physical-trip accuracy. No external APIs are called.

Other generated run reports, screenshots and diagnostic XML stay local and are
ignored by Git. Keep a new fixture explicitly tracked only when a regression
test actually reads it, after checking it for credentials and private data.

Run the offline suite from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s e2e/ios -p 'test_*.py'
```
