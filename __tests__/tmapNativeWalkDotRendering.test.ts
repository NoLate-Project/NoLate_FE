const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

describe("native TMAP walking dot rendering", () => {
    it("keeps iOS native dots on a single polyline so casing cannot drift out of phase", () => {
        const source = readFileSync(
            "modules/nolate-tmap/ios/NoLateTMapView.swift",
            "utf8"
        );

        expect(source).toContain("if outlineWidth > 0 && style != .dot");
        expect(source).toContain('case "dot":\n      return .dot');
    });

    it("uses the shared dot rhythm on Android and disables its outline for platform parity", () => {
        const source = readFileSync(
            "modules/nolate-tmap/android/src/main/java/expo/modules/nolatetmap/NoLateTMapView.kt",
            "utf8"
        );

        expect(source.match(/if \(strokeStyle == "dot"\) \{\s*0f/g)).toHaveLength(2);
        expect(source).toContain('"dot" -> dotPattern(dashPattern, width)');
        expect(source).toContain("normalizedDash(values)");
    });
});
