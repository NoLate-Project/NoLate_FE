import { View } from 'react-native';

import styles from './styles';
import { RoutePlannerBottomSheet } from './RoutePlannerBottomSheet';
import { RoutePlannerMapCanvas } from './RoutePlannerMapCanvas';
import { RoutePlannerMapHeader } from './RoutePlannerMapHeader';
import { RoutePlannerModals } from './RoutePlannerModals';
import { RoutePlannerSelectionStage } from './RoutePlannerSelectionStage';
import type { RoutePlannerController } from './useRoutePlannerController';

type Props = { controller: RoutePlannerController };

/** 지도와 기능별 오버레이 컴포넌트를 조합해 경로 플래너의 기본 화면 구조를 렌더링합니다. */
export function RoutePlannerMainView({ controller }: Props) {
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: controller.colors.background },
      ]}
    >
      <RoutePlannerMapCanvas controller={controller} />
      <RoutePlannerMapHeader controller={controller} />
      <RoutePlannerSelectionStage controller={controller} />
      <RoutePlannerBottomSheet controller={controller} />
      <RoutePlannerModals controller={controller} />
    </View>
  );
}
