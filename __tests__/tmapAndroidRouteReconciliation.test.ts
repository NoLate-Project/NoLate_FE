const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const ANDROID_TMAP_VIEW_PATH =
    "modules/nolate-tmap/android/src/main/java/expo/modules/nolatetmap/NoLateTMapView.kt";
const source = readFileSync(ANDROID_TMAP_VIEW_PATH, "utf8");

function sourceBetween(start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
}

describe("Android TMAP route reconciliation", () => {
    it("동일한 마커 스냅샷은 SDK marker를 제거하기 전에 중단한다", () => {
        const reconciliation = sourceBetween(
            "private fun renderMarkers",
            "private fun createMarkerSignature"
        );

        expect(reconciliation).toContain("val nextSignature = createMarkerSignature(markers)");
        expect(reconciliation).toContain("if (markerSignature == nextSignature) return");
        expect(reconciliation.indexOf("if (markerSignature == nextSignature) return"))
            .toBeLessThan(reconciliation.indexOf("nativeMap.removeAllTMapMarkerItem()"));
        expect(reconciliation).toContain("markerSignature = nextSignature");
    });

    it("마커 시그니처는 map 순서와 무관하게 만들고 지도 SDK 교체 시 초기화한다", () => {
        const signatureBuilder = sourceBetween(
            "private fun createMarkerSignature",
            "private fun renderPathsIfChanged"
        );
        const destroyMap = sourceBetween("private fun destroyMap()", "fun onDestroy()");

        expect(signatureBuilder).toContain("canonicalMarkerValue(markers)");
        expect(signatureBuilder).toContain(".sortedBy { it.first }");
        expect(signatureBuilder).not.toContain('data.map("camera")');
        expect(signatureBuilder).not.toContain('data.list("pathOverlays")');
        expect(destroyMap).toContain("markerSignature = null");
    });

    it("동일한 경로 시그니처는 SDK overlay를 제거하기 전에 중단한다", () => {
        const reconciliation = sourceBetween(
            "private fun renderPathsIfChanged",
            "private fun createRouteSignature"
        );

        expect(reconciliation).toContain("if (routeSignature == nextSignature) return");
        expect(reconciliation.indexOf("if (routeSignature == nextSignature) return"))
            .toBeLessThan(reconciliation.indexOf("nativeMap.removeAllTMapPolyLine()"));
        expect(reconciliation).toContain("nativeMap.removeAllTMapTrafficLine()");
    });

    it("카메라·마커·줌 전용 값과 SDK 미지원 화살표 색은 경로 시그니처에서 제외한다", () => {
        const signatureBuilder = sourceBetween(
            "private fun createRouteSignature",
            "private fun renderPaths(nativeMap"
        );

        expect(signatureBuilder).not.toContain('data.map("camera")');
        expect(signatureBuilder).not.toContain('data.list("markers")');
        expect(signatureBuilder).not.toContain('"pathOverlayZoom"');
        expect(signatureBuilder).not.toContain('"nativeDirectionColor"');
        expect(signatureBuilder).not.toContain('"nativeDirectionOpacity"');
        expect(signatureBuilder).toContain("RouteCoordinateSignature");
        expect(signatureBuilder).toContain("lineWidth = width");
        expect(signatureBuilder).toContain("lineEffect = lineEffect");
    });

    it("지도 SDK 인스턴스가 바뀌면 같은 경로도 다시 그릴 수 있게 시그니처를 초기화한다", () => {
        const destroyMap = sourceBetween("private fun destroyMap()", "fun onDestroy()");

        expect(destroyMap).toContain("routeSignature = null");
    });

    it("짧은 점·긴 간격의 보행선만 본선과 같은 외곽선 path effect를 사용한다", () => {
        const signatureBuilder = sourceBetween(
            "private fun createRouteOverlaySignature",
            "private fun renderPaths(nativeMap"
        );
        const polylineRenderer = sourceBetween(
            "private fun addPolyline",
            "private fun normalizedDash"
        );
        const sparseDotPolicy = sourceBetween(
            "private fun isSparseDotDash",
            "/** Uses the TMAP SDK"
        );

        expect(signatureBuilder).toContain("isSparseDotDash(strokeStyle, dashPattern) -> lineEffect");
        expect(polylineRenderer).toContain("isSparseDotDash(strokeStyle, dashPattern) -> lineEffect");
        expect(polylineRenderer).toContain("outlineEffect?.let(polyline::setOutLinePathEffect)");
        expect(sparseDotPolicy).toContain('strokeStyle != "dash"');
        expect(sparseDotPolicy).toContain("paintLength <= 2 && gapLength >= 8");
    });
});
