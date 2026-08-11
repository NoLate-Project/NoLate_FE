import React from "react";

import { RouteSelectFavoriteSaveSheet } from "./RouteSelectFavoriteSaveSheet";
import { RouteSelectMapPickerSheet } from "./RouteSelectMapPickerSheet";
import { RouteSelectResultsScreen } from "./RouteSelectResultsScreen";
import { RouteSelectSearchScreen } from "./RouteSelectSearchScreen";
import type { RouteSelectController } from "./useRouteSelectController";

type RouteSelectScreenContentProps = {
    controller: RouteSelectController;
};

/**
 * 검색 화면과 경로 결과 화면을 전환하고 두 화면에서 공유하는 즐겨찾기·지도 모달을 한 번만 마운트한다.
 */
export function RouteSelectScreenContent({
    controller,
}: RouteSelectScreenContentProps) {
    return (
        <>
            {controller.isEditingRoutePoint ? (
                <RouteSelectSearchScreen controller={controller} />
            ) : (
                <RouteSelectResultsScreen controller={controller} />
            )}
            <RouteSelectFavoriteSaveSheet controller={controller} />
            <RouteSelectMapPickerSheet controller={controller} />
        </>
    );
}
