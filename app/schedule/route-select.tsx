import React from "react";

import { RouteSelectScreenContent } from "../../src/routeSupport/schedule/RouteSelectScreenContent";
import { useRouteSelectController } from "../../src/routeSupport/schedule/useRouteSelectController";

/** 경로 선택 라우트에서 컨트롤러와 화면 표현을 연결한다. */
export default function RouteSelectScreen() {
    const controller = useRouteSelectController();
    return <RouteSelectScreenContent controller={controller} />;
}
