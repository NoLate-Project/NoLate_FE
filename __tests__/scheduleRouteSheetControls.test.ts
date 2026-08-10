const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");

describe("schedule route sheet controls", () => {
    test("expanded sheet exposes a dedicated collapse button", () => {
        const collapseStart = detailSource.indexOf('testID="schedule-route-sheet-collapse"');
        const collapseEnd = detailSource.indexOf("</Pressable>", collapseStart);
        const collapseButtonSource = detailSource.slice(collapseStart, collapseEnd);

        expect(collapseStart).toBeGreaterThanOrEqual(0);
        expect(collapseEnd).toBeGreaterThan(collapseStart);
        expect(detailSource).toContain('testID="schedule-route-sheet-collapse"');
        expect(detailSource).toContain('accessibilityLabel="일정 상세 시트 접기"');
        expect(collapseButtonSource).toContain('onPress={() => snapSheet("compact")}');
        expect(collapseButtonSource).toContain('name="chevron-down" size={16}');
    });

    test("shared people are always controlled by one animated disclosure", () => {
        expect(detailSource).not.toContain("hasParticipantTravelPlans");
        expect(detailSource).toContain("onPress={toggleParticipantsExpanded}");
        expect(detailSource).toContain("accessibilityState={{ expanded: participantsExpanded }}");
        expect(detailSource).toContain("참여자 목록 ${participantsExpanded ? \"접기\" : \"보기\"}");
        expect(detailSource).toContain("{participantsExpanded ? (");
        expect(detailSource).toContain("configureParticipantDisclosureAnimation(nextExpanded)");
        expect(detailSource).toContain("{renderDepartureParticipantChips()}");
        expect(detailSource).toContain("{renderTravelPlanRows()}");
    });

    test("compact sheet keeps the safe area while removing forced body slack", () => {
        expect(detailSource).toContain("const IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT = 196;");
        expect(detailSource).toContain("minHeight: 120,");
        expect(detailSource).toContain("IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT + insets.bottom");
    });
});
