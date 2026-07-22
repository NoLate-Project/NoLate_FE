import { apiGet } from "../src/api/api";
import {
    CALENDAR_METADATA_REQUEST_TIMEOUT_MS,
    getCalendarDays,
} from "../src/api/calendar";

jest.mock("../src/api/api", () => ({
    apiGet: jest.fn(),
}));

const mockedApiGet = jest.mocked(apiGet);

describe("calendar API", () => {
    beforeEach(() => {
        mockedApiGet.mockReset();
    });

    test("날짜 범위로 음력과 공휴일 메타데이터를 조회하고 정규화한다", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: [{
                date: "2026-09-25",
                lunarYear: 2026,
                lunarMonth: 8,
                lunarDay: 15,
                leapMonth: false,
                holidays: [
                    { name: " 추석 ", type: "PUBLIC_HOLIDAY" },
                    { name: " ", type: "PUBLIC_HOLIDAY" },
                ],
            }],
        });

        await expect(getCalendarDays("2026-09-01", "2026-09-30")).resolves.toEqual([{
            date: "2026-09-25",
            lunarYear: 2026,
            lunarMonth: 8,
            lunarDay: 15,
            leapMonth: false,
            holidays: [{ name: "추석", type: "PUBLIC_HOLIDAY" }],
        }]);
        expect(mockedApiGet).toHaveBeenCalledWith("/api/calendar/days", {
            params: {
                startDate: "2026-09-01",
                endDate: "2026-09-30",
            },
            timeout: CALENDAR_METADATA_REQUEST_TIMEOUT_MS,
        });
    });

    test("날짜가 없는 비정상 항목은 캘린더에 전달하지 않는다", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: [{ lunarMonth: 8, lunarDay: 15 }],
        });

        await expect(getCalendarDays("2026-09-01", "2026-09-30"))
            .resolves.toEqual([]);
    });
});
