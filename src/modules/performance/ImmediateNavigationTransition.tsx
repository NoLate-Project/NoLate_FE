import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import ScreenFirstPaintShell from './ScreenFirstPaintShell';
import {
  beginNavigationMeasurement,
  finishNavigationAfterFrames,
  markNavigationRouteReady,
  suppressAutomaticNavigationMeasurements,
} from './navigationPerformance';
import { subscribeToFocusedDestination } from './navigationTransitionFocus';
import {
  createSceneActivityStore,
  PreMountedSceneActivityContext,
  type SceneActivityStore,
} from './preMountedSceneActivity';

export type NavigationTransitionShell = {
  route: string;
  title: string;
  backAccessibilityLabel?: string;
  showBack?: boolean;
  sceneKey?: string;
};

export type PreMountedNavigationScene = {
  route: string;
  sceneKey?: string;
  content: React.ReactNode;
};

type ActiveOverlay = NavigationTransitionShell & {
  id: number;
  kind: 'scene' | 'shell';
};
type TransitionContextValue = {
  runWithTransitionShell(
    shell: NavigationTransitionShell,
    navigationAction: () => void,
  ): void;
  closeActiveScene(): boolean;
};

const PREMOUNTED_SHELLS: NavigationTransitionShell[] = [
  {
    route: '/profile',
    title: '프로필',
    backAccessibilityLabel: '일정 목록으로 돌아가기',
  },
  { route: '/notifications', title: '알림' },
  { route: '/share/inbox', title: '공유함' },
  {
    route: '/schedule/[id]',
    title: '일정 상세',
    backAccessibilityLabel: '이전 화면으로 돌아가기',
  },
  { route: '/schedule', title: '일정', showBack: false },
];

const TransitionContext = createContext<TransitionContextValue | null>(null);

/**
 * Reveals pre-mounted native destination chrome without a React render, then
 * dispatches the real navigation on the frame where that shell is painted.
 */
export function ImmediateNavigationTransitionProvider({
  children,
  preMountedScenes = [],
}: {
  children: React.ReactNode;
  preMountedScenes?: PreMountedNavigationScene[];
}) {
  const contentRef = useRef<View | null>(null);
  const shellRefs = useRef<Record<string, View | null>>({});
  const sceneRefs = useRef<Record<string, View | null>>({});
  const sceneActivityRefs = useRef<Record<string, SceneActivityStore>>({});
  for (const scene of preMountedScenes) {
    sceneActivityRefs.current[scene.route] ??= createSceneActivityStore();
  }
  const activeOverlayRef = useRef<ActiveOverlay | null>(null);
  const sceneHistoryRef = useRef<string[]>([]);
  const underlyingRouteRef = useRef('/');
  const nextIdRef = useRef(1);
  const navigationFrameRef = useRef<number | null>(null);
  const completionFrameRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNativeOverlayVisibility = useCallback((
    kind: ActiveOverlay['kind'],
    route: string,
    visible: boolean,
  ) => {
    const target = kind === 'scene'
      ? sceneRefs.current[route]
      : shellRefs.current[route];
    target?.setNativeProps({
      accessibilityElementsHidden: !visible,
      importantForAccessibility: visible ? 'auto' : 'no-hide-descendants',
      pointerEvents: visible ? 'auto' : 'none',
      style: { opacity: visible ? 1 : 0 },
    });
    if (kind === 'scene') {
      // ETA refresh must follow the scene actually shown, even when the
      // underlying navigator remains focused on the calendar.
      sceneActivityRefs.current[route]?.setActive(visible);
      contentRef.current?.setNativeProps({
        accessibilityElementsHidden: visible,
        importantForAccessibility: visible ? 'no-hide-descendants' : 'auto',
      });
    }
  }, []);

  const clearOverlay = useCallback((id: number) => {
    const current = activeOverlayRef.current;
    if (!current || current.id !== id) return;
    setNativeOverlayVisibility(current.kind, current.route, false);
    activeOverlayRef.current = null;
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, [setNativeOverlayVisibility]);

  const completeVisibleScene = useCallback((route: string) => {
    navigationFrameRef.current = requestAnimationFrame(paintedAt => {
      navigationFrameRef.current = null;
      const pendingId = markNavigationRouteReady(route, paintedAt);
      if (pendingId === undefined) return;
      completionFrameRef.current = requestAnimationFrame(completedAt => {
        completionFrameRef.current = null;
        finishNavigationAfterFrames(pendingId, completedAt);
      });
    });
  }, []);

  const closeActiveScene = useCallback(() => {
    const current = activeOverlayRef.current;
    if (!current || current.kind !== 'scene') return false;

    const previousRoute = sceneHistoryRef.current.pop();
    const targetRoute = previousRoute && sceneRefs.current[previousRoute]
      ? previousRoute
      : '/schedule';
    beginNavigationMeasurement('SCENE', current.route, targetRoute);
    setNativeOverlayVisibility('scene', current.route, false);
    if (targetRoute === '/schedule') {
      sceneHistoryRef.current = [];
      activeOverlayRef.current = null;
    } else {
      const next = {
        route: targetRoute,
        title: '',
        id: nextIdRef.current++,
        kind: 'scene' as const,
      };
      activeOverlayRef.current = next;
      setNativeOverlayVisibility('scene', targetRoute, true);
    }
    completeVisibleScene(targetRoute);
    return true;
  }, [completeVisibleScene, setNativeOverlayVisibility]);

  const runWithTransitionShell = useCallback<
    TransitionContextValue['runWithTransitionShell']
  >((shell, navigationAction) => {
    const activeOverlay = activeOverlayRef.current;
    if (
      shell.route === '/schedule'
      && activeOverlay?.kind === 'scene'
      && underlyingRouteRef.current === '/schedule'
    ) {
      beginNavigationMeasurement('SCENE', activeOverlay.route, '/schedule');
      setNativeOverlayVisibility('scene', activeOverlay.route, false);
      sceneHistoryRef.current = [];
      activeOverlayRef.current = null;
      completeVisibleScene('/schedule');
      return;
    }

    const nativeScene = sceneRefs.current[shell.route];
    const preMountedScene = preMountedScenes.find(
      scene => scene.route === shell.route,
    );
    const sceneKeyMatches = !preMountedScene?.sceneKey
      || preMountedScene.sceneKey === shell.sceneKey;
    if (
      nativeScene
      && sceneKeyMatches
      && (!activeOverlay || activeOverlay.kind === 'scene')
      && underlyingRouteRef.current === '/schedule'
    ) {
      const fromRoute = activeOverlay?.route ?? '/schedule';
      if (activeOverlay?.kind === 'scene') {
        const previousRoute = sceneHistoryRef.current.at(-1);
        if (previousRoute === shell.route) sceneHistoryRef.current.pop();
        else sceneHistoryRef.current.push(activeOverlay.route);
        setNativeOverlayVisibility('scene', activeOverlay.route, false);
      } else {
        sceneHistoryRef.current = [];
      }
      const next = {
        ...shell,
        id: nextIdRef.current++,
        kind: 'scene' as const,
      };
      activeOverlayRef.current = next;
      beginNavigationMeasurement('SCENE', fromRoute, shell.route);
      setNativeOverlayVisibility('scene', shell.route, true);
      completeVisibleScene(shell.route);
      return;
    }

    const nativeShell = shellRefs.current[shell.route];
    if (!nativeShell) {
      navigationAction();
      return;
    }

    if (navigationFrameRef.current !== null) {
      cancelAnimationFrame(navigationFrameRef.current);
    }
    if (completionFrameRef.current !== null) {
      cancelAnimationFrame(completionFrameRef.current);
    }
    const previous = activeOverlayRef.current;
    if (previous) {
      setNativeOverlayVisibility(previous.kind, previous.route, false);
    }

    const next = {
      ...shell,
      id: nextIdRef.current++,
      kind: 'shell' as const,
    };
    activeOverlayRef.current = next;
    beginNavigationMeasurement('SHELL', undefined, shell.route);
    suppressAutomaticNavigationMeasurements();
    setNativeOverlayVisibility('shell', shell.route, true);

    navigationFrameRef.current = requestAnimationFrame(() => {
      navigationFrameRef.current = null;
      try {
        navigationAction();
      } catch (error) {
        clearOverlay(next.id);
        throw error;
      }
    });

    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
    }
    fallbackTimerRef.current = setTimeout(() => clearOverlay(next.id), 3_000);
  }, [
    clearOverlay,
    completeVisibleScene,
    preMountedScenes,
    setNativeOverlayVisibility,
  ]);

  const contextValue = useMemo(
    () => ({
      runWithTransitionShell,
      closeActiveScene,
    }),
    [closeActiveScene, runWithTransitionShell],
  );

  useEffect(() => subscribeToFocusedDestination(route => {
    underlyingRouteRef.current = route;
    const current = activeOverlayRef.current;
    if (!current) return;
    if (current.kind === 'shell' && current.route === route) {
      requestAnimationFrame(() => clearOverlay(current.id));
      return;
    }
    if (current.kind === 'scene' && route !== '/schedule') {
      sceneHistoryRef.current = [];
      requestAnimationFrame(() => clearOverlay(current.id));
    }
  }), [clearOverlay]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      closeActiveScene,
    );
    return () => subscription.remove();
  }, [closeActiveScene]);

  useEffect(() => () => {
    if (navigationFrameRef.current !== null) {
      cancelAnimationFrame(navigationFrameRef.current);
    }
    if (completionFrameRef.current !== null) {
      cancelAnimationFrame(completionFrameRef.current);
    }
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
    }
  }, []);

  return (
    <TransitionContext.Provider value={contextValue}>
      <View ref={contentRef} style={styles.content}>
        {children}
      </View>
      {preMountedScenes.map(scene => (
        <View
          key={scene.route}
          ref={view => { sceneRefs.current[scene.route] = view; }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.overlay, styles.hiddenOverlay]}
        >
          <PreMountedSceneActivityContext.Provider value={sceneActivityRefs.current[scene.route]}>
            {scene.content}
          </PreMountedSceneActivityContext.Provider>
        </View>
      ))}
      {PREMOUNTED_SHELLS.map(shell => (
        <View
          key={shell.route}
          ref={view => { shellRefs.current[shell.route] = view; }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.overlay, styles.hiddenOverlay]}
        >
          <ScreenFirstPaintShell
            title={shell.title}
            backAccessibilityLabel={
              shell.backAccessibilityLabel ?? '뒤로 가기'
            }
            showBack={shell.showBack}
            testID={`immediate-navigation-shell-${shell.route}`}
          />
        </View>
      ))}
    </TransitionContext.Provider>
  );
}

export function useImmediateNavigationTransition() {
  const context = useContext(TransitionContext);
  if (!context) {
    return {
      runWithTransitionShell: (
        _shell: NavigationTransitionShell,
        navigationAction: () => void,
      ) => navigationAction(),
      closeActiveScene: () => false,
    };
  }
  return context;
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10_000,
    elevation: 10_000,
  },
  hiddenOverlay: {
    opacity: 0,
  },
});
