import { RoutePlannerMainView } from '../../src/modules/schedule/routePlanner/RoutePlannerMainView';
import { useRoutePlannerController } from '../../src/modules/schedule/routePlanner/useRoutePlannerController';
import { useScreenFirstPaintPerformance } from '../../src/modules/performance/useScreenFirstPaintPerformance';

/** 경로 플래너 컨트롤러와 화면을 연결합니다. */
export default function RoutePlannerScreen() {
  useScreenFirstPaintPerformance('/schedule/route-planner');
  const controller = useRoutePlannerController();
  return <RoutePlannerMainView controller={controller} />;
}
