import {
    buildScheduleFormLocationName,
    buildScheduleFormPlace,
} from "../src/modules/schedule/scheduleFormPlace";

describe("schedule form place payload", () => {
    test("이름이 없어도 주소와 좌표를 보존한다", () => {
        expect(buildScheduleFormPlace({
            name: "  ",
            address: " 서울 강남구 테헤란로 1 ",
            lat: 37.5,
            lng: 127.03,
        })).toEqual({
            name: "서울 강남구 테헤란로 1",
            address: "서울 강남구 테헤란로 1",
            lat: 37.5,
            lng: 127.03,
        });
    });

    test("좌표만 받은 검색 결과도 버리지 않는다", () => {
        expect(buildScheduleFormPlace({ lat: 37.5, lng: 127.03 })).toEqual({
            name: undefined,
            address: undefined,
            lat: 37.5,
            lng: 127.03,
        });
    });

    test("빈 장소는 payload에서 제외한다", () => {
        expect(buildScheduleFormPlace({ name: " ", address: " " })).toBeUndefined();
        expect(buildScheduleFormPlace({ lat: Number.NaN, lng: Number.POSITIVE_INFINITY })).toBeUndefined();
    });

    test("출발지와 도착지 표시 문구를 주소까지 폴백해 만든다", () => {
        expect(buildScheduleFormLocationName(
            { address: "집 주소" },
            { name: "회사" },
        )).toBe("집 주소 → 회사");
        expect(buildScheduleFormLocationName(undefined, { address: "강남역" })).toBe("강남역");
    });
});
