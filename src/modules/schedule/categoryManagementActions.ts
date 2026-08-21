export type PersonalCategoryManagementAction = "SHARE" | "MOVE" | "EDIT" | "DELETE";

export const PERSONAL_CATEGORY_ACTION_SHEET_OPTIONS = [
    "카테고리 공유",
    "공유 캘린더로 이동",
    "카테고리 수정",
    "카테고리 삭제",
    "취소",
] as const;

export const PERSONAL_CATEGORY_ACTION_CANCEL_INDEX = 4;
export const PERSONAL_CATEGORY_ACTION_DELETE_INDEX = 3;

export function getPersonalCategoryActionAtIndex(
    index: number,
): PersonalCategoryManagementAction | null {
    switch (index) {
        case 0:
            return "SHARE";
        case 1:
            return "MOVE";
        case 2:
            return "EDIT";
        case 3:
            return "DELETE";
        default:
            return null;
    }
}
