const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");
const previewSource = readFileSync("app/internal/schedule-ui-preview.tsx", "utf8");

describe("plain schedule detail route layout", () => {
    test("일반 일정만 더 가까운 콘텐츠 시작점과 중앙 제목 슬롯을 사용한다", () => {
        expect(detailSource).toContain("contentTopInset={plainHeaderHeight + PLAIN_SCHEDULE_DETAIL_CONTENT_GAP}");
        expect(detailSource).toContain("const plainHeaderHeight = insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT");
        expect(detailSource).toContain("...(isPlainSchedule ? { height: plainHeaderHeight } : null)");
        expect(detailSource).toContain("isPlainSchedule && styles.plainTopHeaderContent");
        expect(detailSource).toContain("isPlainSchedule && styles.plainTopHeaderTitleRow");
        expect(detailSource).toContain("isPlainSchedule && styles.plainTopHeaderActions");
        expect(detailSource).toContain('left: 88');
        expect(detailSource).toContain('right: 88');
        expect(detailSource).toContain('name={isPlainSchedule ? "pencil-outline" : "create-outline"}');
        expect(detailSource).toContain('color={isPlainSchedule ? topCardAccentText : primaryText}');
    });

    test("내부 미리보기도 운영 상세와 같은 상단 간격과 편집 액션을 사용한다", () => {
        expect(previewSource).toContain("contentTopInset={headerHeight + PLAIN_SCHEDULE_DETAIL_CONTENT_GAP}");
        expect(previewSource).toContain("const headerHeight = insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT");
        expect(previewSource).toContain("contentBottomInset={Math.max(insets.bottom + 32, 48)}");
        expect(previewSource).toContain('accessibilityLabel="일정 공유"');
        expect(previewSource).toContain('<Ionicons name="pencil-outline" size={19} color={accent} />');
        expect(previewSource).toContain('width: 44');
        expect(previewSource).toContain('height: 44');
        expect(previewSource).toContain('left: 88');
        expect(previewSource).toContain('right: 88');
    });

    test("내부 미리보기에서 수정 화면과 빠른 일정의 개별 필드를 직접 검증할 수 있다", () => {
        expect(previewSource).toContain("function EditPreview({ initialScrollToEnd = false }");
        expect(previewSource).toContain('dispatch({ type: "UPDATE_ITEM", item: previewItem })');
        expect(previewSource).toContain("initialPreviewField={quickPreviewField}");
        expect(previewSource).toContain('<EditPreview initialScrollToEnd={params.section === "bottom"} />');
        expect(previewSource).toContain('type QuickPreviewField = "title" | "date" | "time" | "location" | "notification" | "memo"');
    });
});
