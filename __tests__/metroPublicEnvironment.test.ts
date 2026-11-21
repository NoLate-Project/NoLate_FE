jest.mock('expo/metro-config', () => ({
    getDefaultConfig: () => ({ cacheVersion: 'base' }),
}));

function cacheVersion(environment: Record<string, string>): string {
    const original = process.env;
    let version = '';
    try {
        process.env = { NODE_ENV: 'test', ...environment };
        jest.isolateModules(() => {
            version = jest.requireActual<{ cacheVersion: string }>('../metro.config.js').cacheVersion;
        });
    } finally {
        process.env = original;
    }
    return version;
}

test('changing an inlined API endpoint changes the Metro transform cache without an E2E override', () => {
    const first = { EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:5579', EXPO_PUBLIC_LOCAL_API_BASE_URL: 'http://127.0.0.1:5528' };
    expect(cacheVersion(first)).not.toBe(cacheVersion({ ...first, EXPO_PUBLIC_LOCAL_API_BASE_URL: 'http://127.0.0.1:5579' }));
    expect(cacheVersion(first)).not.toBe(cacheVersion({ ...first, EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:5528' }));
});

test('the same public settings reuse their cache regardless of key order and private settings', () => {
    const first = { EXPO_PUBLIC_MAP_PROVIDER: 'tmap', EXPO_PUBLIC_API_BASE_URL: 'https://example.test' };
    const reverse = { EXPO_PUBLIC_API_BASE_URL: first.EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_MAP_PROVIDER: first.EXPO_PUBLIC_MAP_PROVIDER };
    expect(cacheVersion(first)).toBe(cacheVersion({ ...reverse, PRIVATE_TEST_SETTING: 'another value' }));
    expect(cacheVersion(first)).not.toBe(cacheVersion({ ...first, EXPO_PUBLIC_MAP_PROVIDER: 'naver' }));
    expect(cacheVersion(first)).not.toContain(first.EXPO_PUBLIC_API_BASE_URL);
    expect(cacheVersion({ ...first, NOLATE_E2E_METRO_CACHE_NAMESPACE: 'nolate-eta-real-e2e.test' }))
        .not.toBe(cacheVersion(first));
});
