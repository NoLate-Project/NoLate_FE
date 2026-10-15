import { useLocalSearchParams } from 'expo-router';
import CalendarMainPreview from '../../src/routeSupport/internal/CalendarMainPreview';

export default function MainDesignPreviewScreen() {
  const params = useLocalSearchParams<{
    mode?: 'stack' | 'detail' | 'list';
    scenario?: 'normal' | 'stress' | 'empty' | 'error' | 'dense';
  }>();
  if (!__DEV__) return null;
  return (
    <CalendarMainPreview
      key={`${params.mode}-${params.scenario}`}
      initialMode={params.mode}
      scenario={params.scenario}
    />
  );
}
