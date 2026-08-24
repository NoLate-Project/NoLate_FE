import {
    getScheduleCategoryMovePreviewFromApi,
    moveScheduleCategoryToApi,
    normalizeScheduleCategoryMovePreview,
    normalizeScheduleCategoryMoveResult,
} from "../src/api/scheduleCategories";
import { apiGet, apiPost } from "../src/api/api";
import { clearCalendarScheduleCache } from "../src/modules/schedule/calendarScheduleCache";
import {
    CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE,
    CATEGORY_MOVE_VISIBILITY_NOTICE,
    getCategoryMoveSummary,
    isOwnedPersonalScheduleCategory,
} from "../src/modules/schedule/categoryMove";
import {
    getPersonalCategoryActionAtIndex,
    PERSONAL_CATEGORY_ACTION_SHEET_OPTIONS,
} from "../src/modules/schedule/categoryManagementActions";

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
}));
jest.mock("../src/modules/schedule/calendarScheduleCache", () => ({
    clearCalendarScheduleCache: jest.fn(),
}));

const mockApiGet = apiGet as jest.MockedFunction<typeof apiGet>;
const mockApiPost = apiPost as jest.MockedFunction<typeof apiPost>;
const mockClearCalendarScheduleCache = clearCalendarScheduleCache as jest.MockedFunction<
    typeof clearCalendarScheduleCache
>;

describe("category move presentation", () => {
    test("personal category action sheet exposes four explicit actions and cancel", () => {
        expect(PERSONAL_CATEGORY_ACTION_SHEET_OPTIONS).toEqual([
            "카테고리 공유",
            "공유 캘린더로 이동",
            "카테고리 수정",
            "카테고리 삭제",
            "취소",
        ]);
        expect([0, 1, 2, 3, 4].map(getPersonalCategoryActionAtIndex)).toEqual([
            "SHARE",
            "MOVE",
            "EDIT",
            "DELETE",
            null,
        ]);
    });

    test("only an owned personal category exposes the move action", () => {
        expect(isOwnedPersonalScheduleCategory({
            id: "personal",
            title: "업무",
            color: "#ff3b30",
            ownerMemberId: 10,
        })).toBe(true);
        expect(isOwnedPersonalScheduleCategory({
            id: "received",
            title: "받은 카테고리",
            color: "#007aff",
            shared: true,
            sharePermission: "EDITOR",
        })).toBe(false);
        expect(isOwnedPersonalScheduleCategory({
            id: "calendar-category",
            title: "가족",
            color: "#34c759",
            calendarId: 21,
            shared: true,
            sharePermission: "OWNER",
        })).toBe(false);
    });

    test("confirmation names the source, destination, schedule count and merge target", () => {
        expect(getCategoryMoveSummary({
            categoryTitle: "업무",
            calendarTitle: "가족",
            scheduleCount: 12,
        })).toBe("“업무” 카테고리와 일정 12개를 “가족” 공유 캘린더로 이동합니다.");
        expect(getCategoryMoveSummary({
            categoryTitle: "업무",
            calendarTitle: "가족",
            scheduleCount: 12,
            mergeTargetTitle: "업무",
        })).toBe("“업무” 카테고리의 일정 12개를 “가족”의 “업무” 카테고리에 합칩니다.");
        expect(CATEGORY_MOVE_VISIBILITY_NOTICE).toContain("모든 일정");
        expect(CATEGORY_MOVE_VISIBILITY_NOTICE).toContain("멤버");
        expect(CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE).toContain("이동 경로 정보");
    });
});

describe("category move response normalization", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("normalizes the finalized backend preview contract", () => {
        expect(normalizeScheduleCategoryMovePreview({
            sourceCategory: {
                id: "14",
                title: "업무",
                color: "#ff3b30",
            },
            destinationCalendarId: 21,
            destinationCalendarTitle: "가족",
            activeScheduleCount: 7,
            sameNameCategory: {
                id: 33,
                title: "업무",
                color: "#007aff",
                calendarId: 21,
            },
        })).toEqual({
            sourceCategory: {
                id: "14",
                title: "업무",
                color: "#ff3b30",
                iconKey: undefined,
                sortOrder: undefined,
                updatedAt: undefined,
            },
            destinationCalendarId: 21,
            destinationCalendarTitle: "가족",
            scheduleCount: 7,
            mergeTargetCategory: {
                id: "33",
                title: "업무",
                color: "#007aff",
                iconKey: undefined,
                sortOrder: undefined,
                updatedAt: undefined,
                calendarId: 21,
            },
        });
    });

    test("normalizes move result including source removal and merge state", () => {
        expect(normalizeScheduleCategoryMoveResult({
            sourceCategoryId: "14",
            category: {
                id: 33,
                title: "업무",
                color: "#007aff",
                calendarId: 21,
            },
            movedScheduleCount: 7,
            merged: true,
        })).toEqual({
            sourceCategoryId: "14",
            category: {
                id: "33",
                title: "업무",
                color: "#007aff",
                iconKey: undefined,
                sortOrder: undefined,
                updatedAt: undefined,
                calendarId: 21,
            },
            movedScheduleCount: 7,
            merged: true,
        });
    });

    test("uses the finalized preview and move endpoints and clears schedule caches", async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: {
                activeScheduleCount: 2,
                sameNameCategory: null,
            },
        });
        await expect(getScheduleCategoryMovePreviewFromApi("14", 21)).resolves.toEqual({
            scheduleCount: 2,
        });
        expect(mockApiGet).toHaveBeenCalledWith(
            "/api/schedule-categories/14/move-preview?calendarId=21",
        );

        mockApiPost.mockResolvedValueOnce({
            success: true,
            data: {
                sourceCategoryId: "14",
                category: {
                    id: 33,
                    title: "업무",
                    color: "#007aff",
                    calendarId: 21,
                },
                movedScheduleCount: 2,
                merged: true,
            },
        });
        await moveScheduleCategoryToApi("14", {
            calendarId: 21,
            mergeIntoCategoryId: "33",
        });
        expect(mockApiPost).toHaveBeenCalledWith(
            "/api/schedule-categories/14/move",
            { calendarId: 21, mergeIntoCategoryId: 33 },
        );
        expect(mockClearCalendarScheduleCache).toHaveBeenCalledTimes(1);
    });
});
