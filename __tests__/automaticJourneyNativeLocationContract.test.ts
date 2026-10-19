export {};

const fs = jest.requireActual('fs') as {
    readFileSync(filePath: string, encoding: string): string;
};

const source = fs.readFileSync(
    'modules/nolate-live-activity/ios/NoLateJourneyAutomaticRuntime.swift', 'utf8');
const begin = source.slice(source.indexOf('private func beginInputs()'),
    source.indexOf('private func startAuthorizedLocation('));
const authorize = source.slice(source.indexOf('private func startAuthorizedLocation('),
    source.indexOf('private func ingest('));

describe('automatic native location startup contract', () => {
    it('does not synchronously query global location services on the main actor', () => {
        expect(source).not.toContain('CLLocationManager.locationServicesEnabled()');
        expect(begin).not.toContain('manager.authorizationStatus');
        expect(begin).not.toContain('manager.startUpdatingLocation()');
        expect(begin).toContain('locationState = "CHECKING_PERMISSION"');
    });
    it('uses the token-fenced initial and changed authorization delegate callbacks', () => {
        expect(source).toContain('func locationManagerDidChangeAuthorization(');
        expect(begin).toContain('guard let self, self.token == token else { return }');
        expect(begin).toContain('case .authorization(let status):');
        expect(begin).toContain('self.locationAuthorization = status');
        expect(begin).toContain('self.startAuthorizedLocation(status)');
        expect(begin).toContain('manager.delegate = delegate');
        expect(authorize).toContain('guard running, let manager else { return }');
        expect(authorize).not.toContain('manager.authorizationStatus');
        const diagnostic = source.slice(source.indexOf('private var authorization: String'),
            source.indexOf('/// Test-build delivery only.'));
        expect(diagnostic).not.toContain('manager.authorizationStatus');
        expect(diagnostic).toContain('switch locationAuthorization');
        expect(diagnostic).toContain('return "CHECKING_PERMISSION"');
    });
    it('requests once for undetermined authorization and preserves fail-closed denial', () => {
        expect(authorize).toContain('case .notDetermined:');
        expect(authorize).toContain('if locationState != "REQUESTING_PERMISSION"');
        expect(authorize).toContain('manager.requestWhenInUseAuthorization()');
        expect(authorize).toContain('case .denied, .restricted: failClosed("LOCATION_PERMISSION_DENIED")');
        expect(authorize).toContain('@unknown default: failClosed("LOCATION_AUTHORIZATION_UNKNOWN")');
    });
});
