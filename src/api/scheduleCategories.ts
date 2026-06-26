import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type { ScheduleCategory } from "../modules/schedule/types";

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
    updatedAt?: string | null;
};

type CreateScheduleCategoryPayload = {
    title: string;
    color?: string;
    iconKey?: string;
};

type UpdateScheduleCategoryPayload = {
    title?: string;
    color?: string;
    iconKey?: string;
    sortOrder?: number;
};

function normalizeScheduleCategory(dto: ScheduleCategoryDto): ScheduleCategoryItem {
    return {
        id: dto.id === undefined || dto.id === null ? "" : String(dto.id),
        title: dto.title?.trim() || "카테고리",
        color: dto.color?.trim() || "#5A96FF",
        iconKey: dto.iconKey?.trim() || undefined,
        sortOrder: typeof dto.sortOrder === "number" ? dto.sortOrder : undefined,
        updatedAt: dto.updatedAt ?? undefined,
    };
}

export async function getScheduleCategoriesFromApi(): Promise<ScheduleCategoryItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleCategoryDto[]>>("/api/schedule-categories");
    return unwrapApiResponse(response).map(normalizeScheduleCategory).filter((category) => category.id);
}

export async function createScheduleCategoryToApi(
    title: string,
    color?: string,
    iconKey?: string
): Promise<ScheduleCategoryItem> {
    const payload: CreateScheduleCategoryPayload = {
        title: title.trim(),
        color,
        iconKey: iconKey?.trim() || undefined,
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
