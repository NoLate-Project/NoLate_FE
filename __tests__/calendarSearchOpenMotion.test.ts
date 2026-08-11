const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const SCHEDULE_SCREEN_PATH = 'app/schedule/index.tsx';
const SCHEDULE_SOURCE_PATHS = [
  'src/modules/schedule/hooks/useScheduleIndexMonthLayout.ts',
  'src/modules/schedule/hooks/useScheduleIndexTransitionStyles.ts',
  'src/modules/schedule/hooks/useScheduleIndexViewModeTransition.ts',
  'src/modules/schedule/hooks/useScheduleIndexDayNavigation.ts',
  'src/modules/schedule/hooks/useScheduleIndexToolbarActions.ts',
  'src/modules/schedule/hooks/useScheduleIndexToolbarPresentation.ts',
  'src/modules/schedule/hooks/useScheduleIndexDisplayModel.ts',
  'src/modules/schedule/hooks/useScheduleIndexController.tsx',
  'src/modules/schedule/components/list/ScheduleIndexCalendarPrimaryLayer.tsx',
  'src/modules/schedule/components/list/ScheduleIndexCalendarOverlayMenus.tsx',
  'src/modules/schedule/components/list/ScheduleIndexScreenContent.tsx',
  SCHEDULE_SCREEN_PATH,
];
const IOS_LIQUID_MENU_PATH = 'ios/NoLateFE/ViewModeGlassControlView.swift';
const LIQUID_MENU_COMPONENT_PATH =
  'src/modules/schedule/components/calendar/LiquidCalendarMenuPrototype.tsx';
const scheduleSource = SCHEDULE_SOURCE_PATHS.map(path =>
  readFileSync(path, 'utf8'),
).join('\n');
const nativeSource = readFileSync(IOS_LIQUID_MENU_PATH, 'utf8');
const liquidMenuComponentSource = readFileSync(
  LIQUID_MENU_COMPONENT_PATH,
  'utf8',
);

function normalizeSourceContract(value: string): string {
  return value
    .replace(/'/g, '"')
    .replace(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g, '$1 =>')
    .replace(/\s+/g, ' ')
    .trim();
}

expect.extend({
  toContain(received: unknown, expected: unknown) {
    const pass =
      typeof received === 'string' && typeof expected === 'string'
        ? normalizeSourceContract(received).includes(
            normalizeSourceContract(expected),
          )
        : Array.isArray(received) && received.includes(expected);
    return {
      pass,
      message: () =>
        `expected normalized source ${pass ? 'not ' : ''}to contain ${String(
          expected,
        )}`,
    };
  },
});

function sourceBetween(source: string, start: string, end: string): string {
  const normalizedSource = normalizeSourceContract(source);
  const normalizedStart = normalizeSourceContract(start);
  const normalizedEnd = normalizeSourceContract(end);
  const startIndex = normalizedSource.indexOf(normalizedStart);
  const endIndex = normalizedSource.indexOf(
    normalizedEnd,
    startIndex + normalizedStart.length,
  );

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return normalizedSource.slice(startIndex, endIndex);
}

function numericConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));

  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe('calendar search open motion', () => {
  it('opens search on the existing native liquid surface', () => {
    const modelBridge = sourceBetween(
      nativeSource,
      'handleSearch: { [weak self] generation in',
      'handleSearchTextChange:',
    );
    const openMenu = sourceBetween(
      nativeSource,
      'private func openMenu(_ action: MenuAction)',
      'private func beginPendingExpansionIfReady()',
    );

    expect(modelBridge).toContain('prototypeSearchOpen = true');
    expect(modelBridge).toContain('"generation": generation');
    expect(openMenu).toContain('model.handleSearchTextChange("")');
    expect(openMenu).toContain(
      'model.handleSearch(model.searchOpenGeneration)',
    );
    expect(openMenu).toContain('expansionPending = true');
    expect(openMenu).toContain('model.handleOpenChange(true)');
    expect(openMenu).toContain('beginPendingExpansionIfReady()');
    expect(openMenu).not.toMatch(/model\.handleSearch\([^)]*\)\s*\n\s*return/);
  });

  it('preallocates search width without covering the calendar while collapsed', () => {
    const hostGeometry = sourceBetween(
      scheduleSource,
      'const liquidPrototypeLayerWidth',
      'const requestCloseLiquidPrototype',
    );
    const hostReadiness = sourceBetween(
      nativeSource,
      'override func layoutSubviews()',
      'override func hitTest',
    );

    expect(hostGeometry).toContain(
      'const liquidPrototypeLayerWidth = searchHeaderTargetWidth',
    );
    expect(hostGeometry).toContain(
      'const liquidPrototypeLayerHeight = liquidPrototypeOpen',
    );
    expect(hostGeometry).toContain('? LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT');
    expect(hostGeometry).toContain(': LIQUID_TOOLBAR_SEARCH_HEIGHT');
    expect(hostReadiness).toContain(
      'bounds.height >= searchExpandedHitHeight - 1',
    );
    expect(hostReadiness).toContain(
      'bounds.width >= model.searchExpandedWidth - 1',
    );
    const searchWidthSetter = sourceBetween(
      nativeSource,
      '@objc var searchExpandedWidth',
      '@objc var searchQuery',
    );
    expect(searchWidthSetter).toContain('setNeedsLayout()');
    expect(searchWidthSetter).toContain('updateHostReadiness()');
  });

  it('lets touches pass through the preallocated transparent canvas', () => {
    const hitTesting = sourceBetween(
      nativeSource,
      'override func point(inside point: CGPoint',
      '@objc(LiquidGlassIconButtonView)',
    );

    expect(hitTesting).toContain('return collapsedHitRect.contains(point)');
    expect(hitTesting).toContain(
      'let activeHitRect = prototypeMenuOpen ? activeExpandedHitRect : collapsedHitRect',
    );
    expect(hitTesting).toContain('return nil');
    expect(hitTesting).toContain(
      'prototypeSearchOpen ? searchExpandedHitRect : expandedHitRect',
    );
    expect(hitTesting).toContain(
      'height: min(bounds.height, searchExpandedHitHeight)',
    );
    expect(scheduleSource).toContain('zIndex: 56');
    expect(scheduleSource).not.toContain(
      'zIndex: liquidPrototypeOpen ? 56 : 49',
    );
    expect(scheduleSource).toContain(
      'testID="calendar-primary-pill-hit-target"',
    );
    expect(scheduleSource).toContain('&& !liquidPrototypeOpen');
  });

  it('always releases the primary pill after a month view transition', () => {
    const transition = sourceBetween(
      scheduleSource,
      'const handleCalendarViewModeChange',
      'const handleDayViewMenuSelect',
    );
    const finalizer = sourceBetween(
      transition,
      'const finishMonthViewTransition',
      'monthViewTransitionWatchdogRef.current = setTimeout',
    );

    expect(finalizer).toContain('setIsMonthViewTransitionActive(false)');
    expect(finalizer).toContain('viewTransitioningRef.current = false');
    expect(transition).toContain(
      'monthViewTransitionWatchdogRef.current = setTimeout',
    );
    expect(transition).toContain(
      'const liveCalendarHeight = monthCalendarAnimatedHeight.value',
    );
    expect(transition).toContain(
      'const liveDayHeight = monthCalendarAnimatedDayHeight.value',
    );
    expect(transition).toMatch(
      /completionAnimation\.start\(\(\) => \{[\s\S]*finishMonthViewTransition\(\)/,
    );
  });

  it('animates responsive detail rows even when only the 5/6-week day height changes', () => {
    const responsiveLayout = sourceBetween(
      scheduleSource,
      'const shouldAnimateResponsiveDetailLayout',
      'const dayPillBloomScaleX',
    );

    expect(responsiveLayout).toContain(
      'Math.abs(liveCalendarHeight - targetHeight) > 0.5',
    );
    expect(responsiveLayout).toContain(
      'Math.abs(liveDayHeight - targetLayout.dayHeight) > 0.5',
    );
    expect(responsiveLayout).toContain(
      'monthCalendarAnimatedDayHeight.value = withTiming',
    );
  });

  it('does not mount or hard-swap a second React Native search surface', () => {
    const nativeHost = sourceBetween(
      scheduleSource,
      '{usesLiquidViewModeControl ? (',
      ') : (',
    );

    expect(scheduleSource).not.toContain('searchToolbarNativeOpacity');
    expect(scheduleSource).not.toContain('searchToolbarOverlayOpacity');
    expect(scheduleSource).not.toContain(
      'usesLiquidViewModeControl && isSearchToolbarOpen && (',
    );
    expect(nativeHost).toContain('onSearch={openSearchToolbar}');
    expect(nativeHost).toContain('onSearchTextChange={setSearchQuery}');
    expect(nativeHost).toContain('onSearchClose={closeSearchToolbar}');
    expect(nativeHost).not.toContain('searchQuery={searchQuery}');
  });

  it('keeps the year pill independent from the JS event queue', () => {
    const openSearch = sourceBetween(
      scheduleSource,
      'const openSearchToolbar',
      'const closeSearchToolbar',
    );
    const closeSearch = sourceBetween(
      scheduleSource,
      'const closeSearchToolbar',
      'const handleLiquidPrototypeOpenChange',
    );
    const nativeOpenChange = sourceBetween(
      scheduleSource,
      'const handleLiquidPrototypeOpenChange',
      'useEffect(() => {\n        if (!isSearchToolbarOpen',
    );
    const closeToolbarMenu = sourceBetween(
      scheduleSource,
      'const closeToolbarMenu',
      'const runToolbarAction',
    );
    const runToolbarAction = sourceBetween(
      scheduleSource,
      'const runToolbarAction',
      'const openToolbarMenu',
    );

    expect(openSearch).toContain('setActiveToolbarMenu("search")');
    expect(openSearch).toContain('nativeSearchGenerationRef.current');
    expect(openSearch).toContain('nativeSearchSessionRef.current');
    expect(openSearch).not.toContain('acknowledgeSearchChromeHidden');
    expect(scheduleSource).not.toContain('searchToolbarChromeOpacity');
    expect(liquidMenuComponentSource).not.toContain('setNativeProps');
    expect(liquidMenuComponentSource).not.toContain(
      'searchChromeAckGeneration',
    );
    expect(closeSearch).not.toContain('Keyboard.dismiss()');
    expect(
      sourceBetween(
        closeToolbarMenu,
        'if (activeToolbarMenu === "search" && usesLiquidViewModeControl) {',
        'return;',
      ),
    ).not.toContain('Keyboard.dismiss()');
    expect(
      sourceBetween(
        runToolbarAction,
        'if (activeToolbarMenu === "search" && usesLiquidViewModeControl) {',
        'return;',
      ),
    ).not.toContain('Keyboard.dismiss()');
    expect(closeSearch).not.toContain('setToolbarMenuClosing(true)');
    expect(nativeOpenChange).toContain('if (open) return');
    expect(nativeOpenChange).toContain(
      'context.generation < nativeSearchGenerationRef.current',
    );
    expect(nativeOpenChange).toContain('currentSession !== context.session');
    expect(nativeOpenChange).toMatch(
      /currentSession && currentSession !== context\.session\) \{\s+return;/,
    );
    expect(nativeOpenChange).toContain('setSearchQuery("")');
    expect(nativeOpenChange).toContain(
      'currentMenu === "search" ? null : currentMenu',
    );
  });

  it('keeps concrete primary-pill bounds while the year layer is hidden', () => {
    const pillWidthMotion = sourceBetween(
      scheduleSource,
      'const primaryPillAnimatedWidth',
      'const primaryPillAnimatedStyle',
    );
    const yearTransition = sourceBetween(
      scheduleSource,
      'const animateYearDepthTransition',
      'const animateDayModeTransition',
    );

    expect(pillWidthMotion).toContain(
      'useSharedValue(primaryPillContentWidth)',
    );
    expect(pillWidthMotion).toContain('withTiming(primaryPillContentWidth');
    expect(pillWidthMotion).not.toContain('withTiming(primaryPillLayout.width');
    expect(yearTransition).toContain('yearOverviewProgress.setValue(toValue)');
    expect(yearTransition).toMatch(
      /unstable_batchedUpdates\(\(\) => \{[\s\S]*afterAnimation\?\.\(\);[\s\S]*setIsYearDepthTransitionActive\(false\)/,
    );
  });

  it('hands search content off without an empty or overlapping pill', () => {
    const nativeMenuSurface = sourceBetween(
      nativeSource,
      'private func liquidMenuObject(nativeSurface: Bool)',
      '@available(iOS 26.0, *)\n  private var nativeLiquidSurface',
    );
    const nativeOpen = sourceBetween(
      nativeSource,
      'private func beginPendingExpansionIfReady()',
      'private func closeMenu()',
    );
    const nativeSearchField = sourceBetween(
      nativeSource,
      'private var searchExpandedContent',
      'private var addExpandedContent',
    );
    const nativeClose = sourceBetween(
      nativeSource,
      'private func closeMenu()',
      'private func morphAnimation',
    );

    expect(nativeSearchField).toContain('prompt: Text("검색")');
    expect(nativeMenuSurface).toContain(
      'alignment: activeAction == .search ? .topTrailing : .top',
    );
    expect(nativeMenuSurface).toContain('searchChromeOcclusionLayer');
    expect(nativeOpen).toContain('SearchOpenMotion.contentHandoffDelay');
    expect(nativeOpen).not.toContain('searchChromeAckGeneration');
    expect(nativeSource).not.toContain(
      '.onChange(of: model.searchChromeAckGeneration)',
    );
    expect(nativeSource).not.toContain('SearchOpenMotion.chromeHandoffDelay');
    expect(nativeOpen).toContain('transaction.disablesAnimations = true');
    expect(nativeOpen).toContain(
      'collapsedContentVisible = false\n          contentVisible = true',
    );
    expect(nativeOpen).not.toContain('SearchOpenMotion.contentFadeDuration');
    expect(nativeClose).toContain(
      'let isSearchClose = activeAction == .search',
    );
    expect(nativeClose).toContain('transaction.disablesAnimations = true');
    expect(nativeClose).toContain(
      'contentVisible = false\n        collapsedContentVisible = true',
    );
    expect(nativeClose).toContain(
      'SearchCloseMotion.addInteractionSettleDelay',
    );
    expect(nativeClose).toContain('lockCompactAddInteraction()');
    expect(nativeClose).not.toContain('compactInteractionLocked');
    expect(nativeSource).toContain('.allowsHitTesting(phase == .collapsed)');
    expect(nativeSource).toContain(
      'activeAction == .search && phase == .expanding',
    );
    expect(nativeSource).toContain(
      '.disabled(model.disabled || compactAddInteractionLocked)',
    );
    expect(nativeSource).toContain(
      'guard action != .add || !compactAddInteractionLocked else { return }',
    );
    expect(nativeClose).not.toContain('contentHandoffDelayFraction');
    expect(nativeClose).not.toContain('bridgeReleaseDelay');
    expect(nativeClose).toMatch(
      /contentVisible = false\s+collapsedContentVisible = true\s+phase = \.collapsed\s+}\s+model\.handleOpenChange\(false\)/,
    );
    expect(nativeClose).not.toContain('contentFadeDuration');
  });

  it('coalesces repeated close requests instead of snapping the native pill', () => {
    const backdrop = sourceBetween(
      scheduleSource,
      '{(activeToolbarMenu !== null || toolbarMenuClosing || liquidPrototypeOpen) && (',
      '{\n        <Animated.View',
    );
    const nativeCloseCoordinator = sourceBetween(
      nativeSource,
      'private func closeOrResetMenu()',
      'private func closeMenuFromOutsideTap()',
    );

    expect(backdrop).toContain('disabled={toolbarMenuClosing}');
    expect(backdrop).toContain('onPress={() => closeToolbarMenu()}');
    expect(backdrop).not.toContain(
      'if (liquidPrototypeOpen) requestCloseLiquidPrototype()',
    );
    expect(nativeCloseCoordinator).toMatch(
      /if phase == \.closing \{\s+return\s+\}/,
    );
    expect(nativeCloseCoordinator).not.toContain('collapseMenuImmediately()');
    expect(nativeSource).not.toContain(
      'private func collapseMenuImmediately()',
    );
  });

  it('invalidates delayed callbacks from earlier open and close transitions', () => {
    const nativeState = sourceBetween(
      nativeSource,
      '@State private var phase',
      '@FocusState private var searchFocused',
    );
    const nativeOpen = sourceBetween(
      nativeSource,
      'private func beginPendingExpansionIfReady()',
      'private func closeMenu()',
    );
    const nativeClose = sourceBetween(
      nativeSource,
      'private func closeMenu()',
      'private func morphAnimation',
    );
    const nativeSearchField = sourceBetween(
      nativeSource,
      'private var searchExpandedContent',
      'private var addExpandedContent',
    );

    expect(nativeState).toContain(
      '@State private var transitionGeneration = 0',
    );
    expect(nativeOpen).toContain('transitionGeneration += 1');
    expect(nativeOpen).toContain('let generation = transitionGeneration');
    expect(
      nativeOpen.match(/transitionGeneration == generation/g),
    ).toHaveLength(3);
    expect(nativeClose).toContain('transitionGeneration += 1');
    expect(nativeClose).toContain('let generation = transitionGeneration');
    expect(
      nativeClose.match(/transitionGeneration == generation/g),
    ).toHaveLength(2);
    expect(nativeClose).toContain('compactAddLockGeneration += 1');
    expect(nativeClose).toContain('compactAddLockGeneration == lockGeneration');
    expect(nativeSearchField).toContain(
      'closeSearchActionIfNeeded()\n        closeMenu()',
    );
    expect(nativeSearchField).not.toContain(
      'model.handleSearchClose()\n        closeMenu()',
    );
  });

  it('keeps the non-native fallback interaction within its motion budget', () => {
    const openDuration = numericConstant(
      scheduleSource,
      'SEARCH_TOOLBAR_OPEN_DURATION_MS',
    );
    const revealProgress = numericConstant(
      scheduleSource,
      'SEARCH_FIELD_REVEAL_START_PROGRESS',
    );
    const focusEffect = sourceBetween(
      scheduleSource,
      'useEffect(() => {\n        if (!isSearchToolbarOpen',
      'const openBlankSchedule',
    );

    expect(openDuration).toBeLessThanOrEqual(120);
    expect(revealProgress).toBeLessThanOrEqual(0.3);
    expect(openDuration * revealProgress).toBeLessThanOrEqual(40);
    expect(focusEffect).toContain('usesLiquidViewModeControl');
    expect(focusEffect).toContain('searchInputRef.current?.focus()');
  });

  it('keeps the requested left extension and aligns result cards', () => {
    const geometry = sourceBetween(
      scheduleSource,
      'const searchHeaderRightInset',
      'const liquidPrototypeLayerWidth',
    );
    const resultsLayer = sourceBetween(
      scheduleSource,
      'styles.searchResultsLayer',
      '<CalendarGlassSurface',
    );

    expect(numericConstant(scheduleSource, 'SEARCH_TOOLBAR_LEFT_INSET')).toBe(
      16,
    );
    expect(geometry).toContain('? ADD_MENU_SOURCE.nativeRightInset');
    expect(geometry).toContain(': ADD_MENU_SOURCE.fallbackRightInset');
    expect(geometry).toContain(
      'screenWidth - SEARCH_TOOLBAR_LEFT_INSET - searchHeaderRightInset',
    );
    expect(resultsLayer).toContain('right: searchHeaderRightInset');
  });
});
