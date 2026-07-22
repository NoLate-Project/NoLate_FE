const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const IOS_TMAP_VIEW_PATH = "modules/nolate-tmap/ios/NoLateTMapView.swift";
const IOS_MARKER_RENDERER_PATH = "modules/nolate-tmap/ios/NoLateTMapMarkerRenderer.swift";
const viewSource = readFileSync(IOS_TMAP_VIEW_PATH, "utf8");
const rendererSource = readFileSync(IOS_MARKER_RENDERER_PATH, "utf8");

function sourceBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
}

describe("iOS TMAP marker reconciliation", () => {
    it("TMAP의 절대 image-point offset 계약으로 핀 끝점을 앵커한다", () => {
        const pinArtwork = sourceBetween(
            rendererSource,
            "private static func pinArtwork",
            "private static func dotArtwork"
        );

        expect(pinArtwork).toContain("let tipBottomInset = 2 * scale");
        expect(pinArtwork).toContain("size.height - tipBottomInset");
        expect(pinArtwork).toContain("width: size.width / 2, height: size.height - tipBottomInset");
        expect(pinArtwork).not.toContain("-size.height / 2 + tipBottomInset");
    });

    it("점·역·배지·노선 라벨의 시각 중심을 절대 offset으로 사용한다", () => {
        const dotArtwork = sourceBetween(
            rendererSource,
            "private static func dotArtwork",
            "private static func stationArtwork"
        );
        const stationArtwork = sourceBetween(
            rendererSource,
            "private static func stationArtwork",
            "private static func badgeArtwork"
        );
        const badgeArtwork = sourceBetween(
            rendererSource,
            "private static func badgeArtwork",
            "private static func routeLabelArtwork"
        );
        const routeLabelArtwork = sourceBetween(
            rendererSource,
            "private static func routeLabelArtwork",
            "private static func render"
        );

        expect(dotArtwork).toContain("width: size.width / 2, height: size.height / 2");
        expect(stationArtwork).toContain("width: size.width / 2, height: size.height / 2");
        expect(badgeArtwork).toContain("offset: CGSize(width: anchor.x, height: anchor.y)");
        expect(routeLabelArtwork).toContain("offset: CGSize(width: anchorX, height: size.height / 2)");
        expect(rendererSource).not.toContain("size.width / 2 - anchor.x");
        expect(rendererSource).not.toContain("size.width / 2 - anchorX");
    });

    it("좌표만 바뀌면 기존 SDK 마커를 유지하고 이미지·앵커 변경은 원자적으로 교체한다", () => {
        const reconciliation = sourceBetween(
            viewSource,
            "private func applyMarkers",
            "private func applyRoutes"
        );

        expect(viewSource).toContain("private var markersByID: [String: TMapMarker] = [:]");
        expect(viewSource).toContain("private var markerConfigurationSignaturesByID: [String: String] = [:]");
        expect(reconciliation).not.toContain("clearMarkers()");
        expect(reconciliation).toContain("let configurationChanged = existingMarker == nil");
        expect(reconciliation).toContain("markerConfigurationSignaturesByID[id] != configurationSignature");
        expect(reconciliation).toContain("if configurationChanged");
        expect(reconciliation).toContain("marker.map = mapView");
        expect(reconciliation).toContain("existingMarker?.map = nil");
        expect(reconciliation.indexOf("marker.map = mapView"))
            .toBeLessThan(reconciliation.indexOf("existingMarker?.map = nil"));
        expect(reconciliation).toContain("} else {");
        expect(reconciliation).toContain("marker.position = coordinate");
        expect(reconciliation).toContain("subtracting(activeMarkerIDs)");
        expect(reconciliation).toContain("removeValue(forKey: id)?.map = nil");
        expect(reconciliation).toContain("markerConfigurationSignaturesByID.removeValue(forKey: id)");
    });

    it("마커 교체 signature에서 좌표만 제외해 줌 LOD 변경은 놓치지 않는다", () => {
        const signature = sourceBetween(
            viewSource,
            "private func markerConfigurationSignature",
            "private func applyRoutes"
        );

        expect(signature).toContain('"lat", "lng", "latitude", "longitude", "coord", "coordinate"');
        expect(signature).toContain("item.filter { !coordinateKeys.contains($0.key) }");
        expect(signature).toContain('configuration["zIndex"] = fallbackZIndex');
        expect(signature).toContain("NoLateTMapValue.stableSignature(configuration)");
    });
});
