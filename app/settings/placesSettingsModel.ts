import { LayoutAnimation } from "react-native";

import type { FavoritePlace } from "../../src/api/favoritePlaces";
import { findMatchingFavoritePlace } from "../../src/modules/schedule/favoritePlaceSelection";
import type { Place } from "../../src/modules/schedule/types";

export const CATEGORY_COLORS = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#0891B2"];

export type SearchMode = "favorite" | "default";

export type PlaceEditorSheet = {
    kind: "placeEditor";
    place: Place;
    favoriteId?: string;
    label: string;
    categoryId?: string;
};

export type SheetState =
    | { kind: "search"; mode: SearchMode }
    | PlaceEditorSheet
    | {
        kind: "categoryEditor";
        categoryId?: string;
        name: string;
        color: string;
    }
    | null;

/** API 또는 네이티브 오류를 사용자에게 보여 줄 일관된 문구로 정규화합니다. */
export function getPlacesSettingsErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

/** 서버 정렬 순서를 우선하고 같은 순서에서는 숫자 ID로 안정적으로 정렬합니다. */
export function sortPlacesByOrder<T extends { sortOrder?: number; id?: string }>(items: T[]): T[] {
    return [...items].sort((left, right) => {
        const orderDiff = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) return orderDiff;
        return (Number(left.id) || 0) - (Number(right.id) || 0);
    });
}

/** ID가 없거나 다른 공급자에서 온 장소도 좌표·주소 기반 공용 matcher로 동일 장소인지 확인합니다. */
export function isSameFavoritePlace(left: FavoritePlace | null, right: FavoritePlace): boolean {
    if (!left) return false;
    if (left.id && right.id && left.id === right.id) return true;
    return findMatchingFavoritePlace(left, [right]) !== undefined;
}

/** 카테고리 추가·정렬 시 행의 생성과 이동을 자연스럽게 연결하는 공통 레이아웃 애니메이션입니다. */
export function configureCategoryContentLayout(): void {
    LayoutAnimation.configureNext({
        duration: 220,
        create: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
        update: {
            type: LayoutAnimation.Types.easeInEaseOut,
        },
        delete: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
    });
}
