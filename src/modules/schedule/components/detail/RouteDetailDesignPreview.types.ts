import type { RouteInfo } from "../../routeInfo";
import type { TransitRouteProgressSegment } from "../../transitRouteProgress";

export type RouteDetailDesignVariant = "current" | "improved";
export type RouteDetailPreviewSheetMode = "compact" | "expanded";

/** 경로 상세 디자인 미리보기 화면에 필요한 고정 입력입니다. */
export type RouteDetailDesignPreviewProps = {
    variant: RouteDetailDesignVariant;
    initialSheetMode?: RouteDetailPreviewSheetMode;
    routeDetailInfo: RouteInfo;
    routeProgressSegments: TransitRouteProgressSegment[];
};
