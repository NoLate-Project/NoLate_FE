import React, { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

const editorEntry = FadeIn.duration(200).reduceMotion(ReduceMotion.System);
const editorExit = FadeOut.duration(140).reduceMotion(ReduceMotion.System);

type Props = {
  editing: boolean;
  detail: ReactNode;
  editor: ReactNode;
};

export function ScheduleDetailEditorTransition({ editing, detail, editor }: Props) {
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
          {detail}
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
