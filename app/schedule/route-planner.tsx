import { RoutePlannerDetachedTransitDetailScreen } from '../../src/modules/schedule/routePlanner/RoutePlannerDetachedTransitDetailScreen';
import { RoutePlannerMainView } from '../../src/modules/schedule/routePlanner/RoutePlannerMainView';
import { RoutePlannerTransitReferenceScreen } from '../../src/modules/schedule/routePlanner/RoutePlannerTransitReferenceScreen';
import { useRoutePlannerController } from '../../src/modules/schedule/routePlanner/useRoutePlannerController';

/** 경로 플래너 컨트롤러를 실행하고 현재 화면 모드에 맞는 표현 컴포넌트를 선택합니다. */
export default function RoutePlannerScreen() {
  const controller = useRoutePlannerController();
  const shouldUseTransitReferenceScreen = false;
  const shouldUseDetachedTransitDetailScreen = false;

  if (controller.isTransitDetailMode && shouldUseTransitReferenceScreen) {
    return <RoutePlannerTransitReferenceScreen controller={controller} />;
  }

  if (controller.isTransitDetailMode && shouldUseDetachedTransitDetailScreen) {
    return <RoutePlannerDetachedTransitDetailScreen controller={controller} />;
  }

  return <RoutePlannerMainView controller={controller} />;
}
