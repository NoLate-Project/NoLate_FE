const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const routeSelectSource = [
    "app/schedule/route-select.tsx",
    "src/routeSupport/schedule/RouteSelectSearchScreen.tsx",
    "src/routeSupport/schedule/RouteSelectResultsScreen.tsx",
    "src/routeSupport/schedule/RouteSelectFavoriteSaveSheet.tsx",
    "src/routeSupport/schedule/RouteSelectMapPickerSheet.tsx",
].map((path) => readFileSync(path, "utf8")).join("\n");
const routeSelectStyleSource = [
    "src/routeSupport/schedule/route-select.styles.ts",
    "src/routeSupport/schedule/routeSelectStyles/base.ts",
    "src/routeSupport/schedule/routeSelectStyles/favorites.ts",
    "src/routeSupport/schedule/routeSelectStyles/filters.ts",
    "src/routeSupport/schedule/routeSelectStyles/mapPicker.ts",
    "src/routeSupport/schedule/routeSelectStyles/routeOptions.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");

function getStyleBlock(styleName: string) {
    const match = routeSelectStyleSource.match(new RegExp(`${styleName}:\\s*\\{([^}]*)\\}`));
    expect(match).not.toBeNull();
    return match?.[1] ?? "";
}

describe("route select presentation", () => {
    test("장소 바로가기와 목록 카드는 일정 폼의 20pt 여백과 14pt 반경을 사용한다", () => {
        expect(getStyleBlock("searchModeActionRow")).toContain("paddingHorizontal: 20");
        expect(getStyleBlock("searchModeActionRow")).toContain("paddingBottom: 10");
        expect(getStyleBlock("searchModeActionButton")).toContain("minHeight: 58");
        expect(getStyleBlock("searchModeActionButton")).toContain("borderRadius: 14");
        expect(getStyleBlock("searchModeRecentRow")).toContain("borderRadius: 14");
        expect(getStyleBlock("searchModeRecentRow")).toContain("marginHorizontal: 20");
        expect(getStyleBlock("searchModeResultRow")).toContain("borderRadius: 14");
        expect(getStyleBlock("searchModeResultRow")).toContain("marginHorizontal: 20");
    });

    test("즐겨찾기 오류의 재시도는 작은 보조 버튼으로 표현한다", () => {
        expect(routeSelectSource).toContain("styles.favoriteLoadErrorRow");
        expect(routeSelectSource).toContain("styles.favoriteRetryButton");
        expect(routeSelectSource).toContain(
            "{ backgroundColor: routeUi.surface, borderColor: routeUi.borderStrong }",
        );
        expect(getStyleBlock("favoriteRetryButton")).toContain("minHeight: 32");
        expect(getStyleBlock("favoriteRetryButton")).toContain("borderWidth: StyleSheet.hairlineWidth");
    });

    test("기본 주소와 최근 검색 문구를 자연스럽게 띄어 쓴다", () => {
        expect(routeSelectSource).toContain(
            'const tabLabel = tab.kind === "default-address" ? "기본 주소" : tab.name;',
        );
        expect(routeSelectSource).toContain(">최근 검색</Text>");
        expect(routeSelectSource).toContain("hitSlop={6}");
        expect(routeSelectSource).not.toContain(">최근검색</Text>");
        expect(routeSelectSource).not.toContain("을(를)");
    });
});
