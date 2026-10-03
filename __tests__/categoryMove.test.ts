import {
    getScheduleCategoryMovePreviewFromApi,
    moveScheduleCategoryToApi,
    normalizeScheduleCategoryMovePreview,
    normalizeScheduleCategoryMoveResult,
} from "../src/api/scheduleCategories";
import { apiGet, apiPost } from "../src/api/api";
import { clearCalendarScheduleCache } from "../src/modules/schedule/calendarScheduleCache";
import {
    CATEGORY_MOVE_CALENDAR_AUDIENCE_NOTICE,
    CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE,
    CATEGORY_MOVE_VISIBILITY_NOTICE,
    canManageScheduleCategoryAudience,
    getCategoryMoveAccessImpactLines,
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
            "다른 캘린더로 이동",
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

    test("personal owners and shared calendar owners can manage sharing and movement", () => {
        expect(canManageScheduleCategoryAudience({
            id: "personal",
            title: "업무",
            color: "#ff3b30",
        })).toBe(true);
        expect(canManageScheduleCategoryAudience({
            id: "calendar-owner",
            title: "가족",
            color: "#34c759",
            calendarId: 21,
            shared: true,
            sharePermission: "OWNER",
        }, "OWNER")).toBe(true);
        expect(canManageScheduleCategoryAudience({
            id: "calendar-editor",
            title: "가족",
            color: "#34c759",
            calendarId: 21,
            shared: true,
            sharePermission: "EDITOR",
        }, "EDITOR")).toBe(false);
        expect(canManageScheduleCategoryAudience({
            id: "received-direct",
            title: "친구",
            color: "#007aff",
            shared: true,
            sharePermission: "EDITOR",
        })).toBe(false);
        expect(canManageScheduleCategoryAudience({
            id: "server-denied",
            title: "서버 권한",
            color: "#007aff",
            calendarId: 21,
            canManageAudience: false,
        }, "OWNER")).toBe(false);
        expect(canManageScheduleCategoryAudience({
            id: "server-owner",
            title: "서버 소유자",
            color: "#007aff",
            calendarId: 21,
            canManageAudience: true,
        }, "VIEWER")).toBe(false);
    });

    test("confirmation names the source, destination and schedule count without a merge path", () => {
        expect(getCategoryMoveSummary({
            categoryTitle: "업무",
            calendarTitle: "가족",
            scheduleCount: 12,
        })).toBe("“업무” 카테고리와 일정 12개를 “가족”으로 이동합니다.");
        expect(CATEGORY_MOVE_VISIBILITY_NOTICE).toContain("모든 일정");
        expect(CATEGORY_MOVE_VISIBILITY_NOTICE).toContain("직접 공유");
        expect(CATEGORY_MOVE_VISIBILITY_NOTICE).toContain("그대로 유지");
        expect(CATEGORY_MOVE_CALENDAR_AUDIENCE_NOTICE).toContain("전체 멤버 수");
        expect(CATEGORY_MOVE_CALENDAR_AUDIENCE_NOTICE).toContain("실제 접근 증감");
        expect(CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE).toContain("이동 경로 정보");
    });

    test("legacy preview counts stay labeled as totals rather than access deltas", () => {
        expect(getCategoryMoveAccessImpactLines({
            retainedDirectShareCount: 2,
            sourceCalendarMemberCount: 3,
            destinationCalendarMemberCount: 4,
        })).toEqual([
            "기존 직접 공유 2명의 보기·편집 권한은 유지됩니다.",
            "출발 캘린더 전체 멤버: 3명",
            "도착 캘린더 전체 멤버: 4명",
        ]);
    });

    test("final preview counts show exact gained and lost access", () => {
        expect(getCategoryMoveAccessImpactLines({
            retainedDirectShareCount: 2,
            retainedDirectScheduleShareCount: 3,
            sourceCalendarMemberCount: 3,
            destinationCalendarMemberCount: 4,
            gainedAccessMemberCount: 2,
            lostAccessMemberCount: 1,
        })).toEqual([
            "기존 직접 공유 2명의 보기·편집 권한은 유지됩니다.",
            "포함된 일정의 직접 공유 권한 3건도 그대로 유지됩니다.",
            "이동 후 접근이 끝나는 사람은 1명입니다.",
            "이동으로 새로 접근할 수 있는 사람은 2명입니다.",
        ]);
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
            retainedDirectShareCount: 2,
            retainedDirectScheduleShareCount: 3,
            sourceCalendarMemberCount: 3,
            destinationCalendarMemberCount: 4,
            gainedAccessMemberCount: 2,
            lostAccessMemberCount: 1,
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
            retainedDirectShareCount: 2,
            retainedDirectScheduleShareCount: 3,
            sourceCalendarMemberCount: 3,
            destinationCalendarMemberCount: 4,
            gainedAccessMemberCount: 2,
            lostAccessMemberCount: 1,
            sameNameCategory: {
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

    test("normalizes an identity-preserving move result", () => {
        expect(normalizeScheduleCategoryMoveResult({
            sourceCategoryId: "14",
            category: {
                id: 14,
                title: "업무",
                color: "#007aff",
                calendarId: 21,
            },
            movedScheduleCount: 7,
            merged: false,
        })).toEqual({
            sourceCategoryId: "14",
            category: {
                id: "14",
                title: "업무",
                color: "#007aff",
                iconKey: undefined,
                sortOrder: undefined,
                updatedAt: undefined,
                calendarId: 21,
            },
            movedScheduleCount: 7,
            merged: false,
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
                    id: 14,
                    title: "업무",
                    color: "#007aff",
                    calendarId: 21,
                },
                movedScheduleCount: 2,
                merged: false,
            },
        });
        await moveScheduleCategoryToApi("14", { calendarId: 21 });
        expect(mockApiPost).toHaveBeenCalledWith(
            "/api/schedule-categories/14/move",
            { calendarId: 21 },
        );
        expect(mockClearCalendarScheduleCache).toHaveBeenCalledTimes(1);
    });
});
