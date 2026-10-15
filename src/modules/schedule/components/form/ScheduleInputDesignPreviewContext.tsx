import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

// Development review only. Normal routes retain the approved input appearance.
const PreviewContext = createContext(false);
export const ScheduleInputDesignPreviewProvider = PreviewContext.Provider;
export function useScheduleInputDesignPreview() {
  const enabled = useContext(PreviewContext);
  return __DEV__ && enabled;
}

export const INPUT_DESIGN_ACCENT = '#246BFE';
export const inputDesignPreviewStyles = StyleSheet.create({
  headerDescription: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  input: { fontSize: 16, lineHeight: 24 },
  action: { borderRadius: 14 },
  actionText: { fontSize: 16, fontWeight: '700' },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  iconTile: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeMeta: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
  searchSurface: { maxHeight: 292 },
  searchHeader: {
    minHeight: 32,
    paddingHorizontal: 18,
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchHeaderText: { fontSize: 12, fontWeight: '600' },
  searchTitle: { fontWeight: '700' },
  searchMeta: { fontWeight: '500' },
  searchTime: { fontWeight: '600' },
  searchArrow: { marginLeft: 6 },
});
