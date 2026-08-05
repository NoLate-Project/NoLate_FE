import {
    getUserVisibleScheduleNotes,
    preserveLegacyCalendarImportMetadata,
    splitCalendarImportNotes,
} from "../src/modules/schedule/calendarImportNotes";

describe("calendar import notes", () => {
    const legacyNotes = [
        "준비물 확인",
        "Apple 캘린더에서 가져온 일정",
        "원본 캘린더: 개인",
    ].join("\n\n");

    test("예전 가져오기 출처 문구는 사용자에게 보여줄 메모에서 숨긴다", () => {
        expect(getUserVisibleScheduleNotes(legacyNotes)).toBe("준비물 확인");
        expect(splitCalendarImportNotes(legacyNotes)).toEqual({
            userNotes: "준비물 확인",
            legacyMetadata: "Apple 캘린더에서 가져온 일정\n\n원본 캘린더: 개인",
        });
    });

    test("메모를 수정해도 예전 일정의 중복 방지 정보는 내부적으로 보존한다", () => {
        expect(preserveLegacyCalendarImportMetadata(legacyNotes, "변경한 메모")).toBe([
            "변경한 메모",
            "Apple 캘린더에서 가져온 일정",
            "원본 캘린더: 개인",
        ].join("\n\n"));
    });

    test("새 일정의 일반 메모는 그대로 유지한다", () => {
        expect(getUserVisibleScheduleNotes("일반 메모")).toBe("일반 메모");
        expect(preserveLegacyCalendarImportMetadata("일반 메모", "수정한 메모"))
            .toBe("수정한 메모");
    });
});
