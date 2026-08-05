const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");

describe("plain schedule detail route layout", () => {
    test("일반 일정만 더 가까운 콘텐츠 시작점과 중앙 제목 슬롯을 사용한다", () => {
        expect(detailSource).toContain("contentTopInset={insets.top + 80}");
        expect(detailSource).toContain("isPlainSchedule && styles.plainTopHeaderContent");
        expect(detailSource).toContain("isPlainSchedule && styles.plainTopHeaderTitleRow");
        expect(detailSource).toContain("isPlainSchedule && styles.plainTopHeaderActions");
        expect(detailSource).toContain('left: 88');
        expect(detailSource).toContain('right: 88');
    });
});
