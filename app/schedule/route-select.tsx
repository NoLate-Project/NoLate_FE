import React from "react";

import { RouteSelectScreenContent } from "../../src/routeSupport/schedule/RouteSelectScreenContent";
import { useRouteSelectController } from "../../src/routeSupport/schedule/useRouteSelectController";
import { useScreenFirstPaintPerformance } from "../../src/modules/performance/useScreenFirstPaintPerformance";

/** 경로 선택 라우트에서 컨트롤러와 화면 표현을 연결한다. */
export default function RouteSelectScreen({
    sessionIdOverride,
}: {
    sessionIdOverride?: string;
} = {}) {
    useScreenFirstPaintPerformance('/schedule/route-select');
    const controller = useRouteSelectController({ sessionIdOverride });
    return <RouteSelectScreenContent controller={controller} />;
}
