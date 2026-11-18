import React, { createContext, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import type { ScheduleItem } from "../../modules/schedule/types";

const editorEntry = FadeIn.duration(200).reduceMotion(ReduceMotion.System);
export const SCHEDULE_EDITOR_EXIT_MS = 140;
const editorExit = FadeOut.duration(SCHEDULE_EDITOR_EXIT_MS).reduceMotion(ReduceMotion.System);
export const ScheduleDetailEditingContext = createContext(false);
export type ScheduleDetailEditResult = { previous: ScheduleItem; updated: ScheduleItem };
export const ScheduleDetailEditResultContext = createContext<ScheduleDetailEditResult | null>(null);

type Props = {
  editing: boolean;
  editResult?: ScheduleDetailEditResult | null;
  detail: ReactNode;
  editor: ReactNode;
};

export function ScheduleDetailEditorTransition({ editing, editResult = null, detail, editor }: Props) {
  const [detailVisited, setDetailVisited] = useState(!editing);

  useEffect(() => {
    if (!editing) setDetailVisited(true);
  }, [editing]);

  return (
    <View style={styles.fill}>
      {(!editing || detailVisited) && (
        <View
          style={styles.fill}
          pointerEvents={editing ? "none" : "auto"}
          accessibilityElementsHidden={editing}
          importantForAccessibility={editing ? "no-hide-descendants" : "auto"}
        >
          <ScheduleDetailEditingContext.Provider value={editing}>
            <ScheduleDetailEditResultContext.Provider value={editResult}>
              {detail}
            </ScheduleDetailEditResultContext.Provider>
          </ScheduleDetailEditingContext.Provider>
        </View>
      )}
      {editing && (
        <Animated.View
          accessibilityViewIsModal
          style={StyleSheet.absoluteFill}
          entering={detailVisited ? editorEntry : undefined}
          exiting={editorExit}
        >
          {editor}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
