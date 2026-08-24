import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type { ScheduleCategory, ScheduleSharePermission } from "../modules/schedule/types";
import { clearCalendarScheduleCache } from "../modules/schedule/calendarScheduleCache";

export type ScheduleCategoryItem = ScheduleCategory & {
    iconKey?: string;
    sortOrder?: number;
    updatedAt?: string;
};

type ScheduleCategoryDto = {
    id?: number | string | null;
    title?: string | null;
    color?: string | null;
    iconKey?: string | null;
    sortOrder?: number | null;
    ownerMemberId?: number | null;
    calendarId?: number | null;
    shared?: boolean | null;
    sharePermission?: ScheduleSharePermission | null;
    updatedAt?: string | null;
};

type CreateScheduleCategoryPayload = {
    title: string;
    color?: string;
    iconKey?: string;
    calendarId?: number;
};

type UpdateScheduleCategoryPayload = {
    title?: string;
    color?: string;
    iconKey?: string;
    sortOrder?: number;
};

export type ScheduleCategoryMovePreview = {
    scheduleCount: number;
    mergeTargetCategory?: ScheduleCategoryItem;
    sourceCategory?: ScheduleCategoryItem;
    destinationCalendarId?: number;
    destinationCalendarTitle?: string;
};

export type MoveScheduleCategoryPayload = {
    calendarId: number;
    mergeIntoCategoryId?: string;
};

export type ScheduleCategoryMoveResult = {
    sourceCategoryId: string;
    category: ScheduleCategoryItem;
    movedScheduleCount: number;
    merged: boolean;
};

type ScheduleCategoryMovePreviewDto = {
    sourceCategory?: ScheduleCategoryDto | null;
    destinationCalendarId?: number | null;
    destinationCalendarTitle?: string | null;
    activeScheduleCount?: number | null;
    scheduleCount?: number | null;
    movedScheduleCount?: number | null;
    existingCategory?: ScheduleCategoryDto | null;
    mergeTargetCategory?: ScheduleCategoryDto | null;
    sameNameCategory?: ScheduleCategoryDto | null;
    existingCategoryId?: number | string | null;
    existingCategoryTitle?: string | null;
    existingCategoryColor?: string | null;
};

type ScheduleCategoryMoveResultDto = {
    sourceCategoryId?: number | string | null;
    category?: ScheduleCategoryDto | null;
    movedCategory?: ScheduleCategoryDto | null;
    movedScheduleCount?: number | null;
    scheduleCount?: number | null;
    merged?: boolean | null;
};

function normalizeScheduleCategory(dto: ScheduleCategoryDto): ScheduleCategoryItem {
    const category: ScheduleCategoryItem = {
        id: dto.id === undefined || dto.id === null ? "" : String(dto.id),
        title: dto.title?.trim() || "카테고리",
        color: dto.color?.trim() || "#5A96FF",
        iconKey: dto.iconKey?.trim() || undefined,
        sortOrder: typeof dto.sortOrder === "number" ? dto.sortOrder : undefined,
        updatedAt: dto.updatedAt ?? undefined,
    };

    if (typeof dto.ownerMemberId === "number") {
        category.ownerMemberId = dto.ownerMemberId;
    }

    if (typeof dto.calendarId === "number") {
        category.calendarId = dto.calendarId;
    }

    if (typeof dto.shared === "boolean") {
        category.shared = dto.shared;
    }

    if (dto.sharePermission) {
        category.sharePermission = dto.sharePermission;
    }

    return category;
}

function normalizeCount(...values: Array<number | null | undefined>): number {
    const value = values.find((candidate) => (
        typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0
    ));
    return value ?? 0;
}

/**
 * Keeps the UI tolerant of temporary preview DTO aliases used while the
 * category-move endpoint is being rolled out. The finalized contract uses
 * `activeScheduleCount` and `sameNameCategory`.
 */
export function normalizeScheduleCategoryMovePreview(
    dto: ScheduleCategoryMovePreviewDto,
): ScheduleCategoryMovePreview {
    const explicitTarget = dto.mergeTargetCategory
        ?? dto.existingCategory
        ?? dto.sameNameCategory;
    const fallbackTarget = dto.existingCategoryId === undefined || dto.existingCategoryId === null
        ? undefined
        : {
            id: dto.existingCategoryId,
            title: dto.existingCategoryTitle,
            color: dto.existingCategoryColor,
        };
    const target = explicitTarget ?? fallbackTarget;
    const mergeTargetCategory = target ? normalizeScheduleCategory(target) : undefined;

    return {
        scheduleCount: normalizeCount(
            dto.activeScheduleCount,
            dto.scheduleCount,
            dto.movedScheduleCount,
        ),
        ...(mergeTargetCategory?.id ? { mergeTargetCategory } : {}),
        ...(dto.sourceCategory ? { sourceCategory: normalizeScheduleCategory(dto.sourceCategory) } : {}),
        ...(typeof dto.destinationCalendarId === "number"
            ? { destinationCalendarId: dto.destinationCalendarId }
            : {}),
        ...(dto.destinationCalendarTitle?.trim()
            ? { destinationCalendarTitle: dto.destinationCalendarTitle.trim() }
            : {}),
    };
}

export function normalizeScheduleCategoryMoveResult(
    dto: ScheduleCategoryMoveResultDto,
): ScheduleCategoryMoveResult {
    const category = dto.category ?? dto.movedCategory;
    if (!category) {
        throw new Error("이동된 카테고리 정보를 확인하지 못했습니다.");
    }
    return {
        sourceCategoryId: dto.sourceCategoryId === undefined || dto.sourceCategoryId === null
            ? normalizeScheduleCategory(category).id
            : String(dto.sourceCategoryId),
        category: normalizeScheduleCategory(category),
        movedScheduleCount: normalizeCount(dto.movedScheduleCount, dto.scheduleCount),
        merged: dto.merged === true,
    };
}

export async function getScheduleCategoriesFromApi(): Promise<ScheduleCategoryItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleCategoryDto[]>>("/api/schedule-categories");
    return unwrapApiResponse(response).map(normalizeScheduleCategory).filter((category) => category.id);
}

export async function createScheduleCategoryToApi(
    title: string,
    color?: string,
    iconKey?: string,
    calendarId?: number | null,
): Promise<ScheduleCategoryItem> {
    const payload: CreateScheduleCategoryPayload = {
        title: title.trim(),
        color,
        iconKey: iconKey?.trim() || undefined,
        calendarId: calendarId ?? undefined,
    };
    const response = await apiPost<ApiEnvelope<ScheduleCategoryDto>, CreateScheduleCategoryPayload>(
        "/api/schedule-categories",
        payload
    );
    return normalizeScheduleCategory(unwrapApiResponse(response));
}

export async function updateScheduleCategoryToApi(
    categoryId: string,
    payload: UpdateScheduleCategoryPayload
): Promise<ScheduleCategoryItem> {
    const response = await apiPatch<ApiEnvelope<ScheduleCategoryDto>, UpdateScheduleCategoryPayload>(
        `/api/schedule-categories/${categoryId}`,
        payload
    );
    return normalizeScheduleCategory(unwrapApiResponse(response));
}

export async function deleteScheduleCategoryFromApi(categoryId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/schedule-categories/${categoryId}`);
    assertApiSuccess(response);
}

export async function getScheduleCategoryMovePreviewFromApi(
    categoryId: string,
    calendarId: number,
): Promise<ScheduleCategoryMovePreview> {
    const response = await apiGet<ApiEnvelope<ScheduleCategoryMovePreviewDto>>(
        `/api/schedule-categories/${encodeURIComponent(categoryId)}/move-preview?calendarId=${calendarId}`,
    );
    return normalizeScheduleCategoryMovePreview(unwrapApiResponse(response));
}

export async function moveScheduleCategoryToApi(
    categoryId: string,
    payload: MoveScheduleCategoryPayload,
): Promise<ScheduleCategoryMoveResult> {
    const response = await apiPost<
        ApiEnvelope<ScheduleCategoryMoveResultDto>,
        { calendarId: number; mergeIntoCategoryId?: number | string }
    >(
        `/api/schedule-categories/${encodeURIComponent(categoryId)}/move`,
        {
            calendarId: payload.calendarId,
            mergeIntoCategoryId: payload.mergeIntoCategoryId
                ? Number.isSafeInteger(Number(payload.mergeIntoCategoryId))
                    ? Number(payload.mergeIntoCategoryId)
                    : payload.mergeIntoCategoryId
                : undefined,
        },
    );
    const result = normalizeScheduleCategoryMoveResult(unwrapApiResponse(response));
    clearCalendarScheduleCache();
    return result;
}
