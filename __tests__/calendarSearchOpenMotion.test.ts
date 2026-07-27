const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const SCHEDULE_SCREEN_PATH = "app/schedule/index.tsx";
const IOS_LIQUID_MENU_PATH = "ios/NoLateFE/ViewModeGlassControlView.swift";
const scheduleSource = readFileSync(SCHEDULE_SCREEN_PATH, "utf8");
const nativeSource = readFileSync(IOS_LIQUID_MENU_PATH, "utf8");

function sourceBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
}

function numericConstant(source: string, name: string): number {
    const match = source.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));

    expect(match).not.toBeNull();
    return Number(match?.[1]);
}

describe("calendar search open motion", () => {
    it("opens search on the existing native liquid surface", () => {
        const modelBridge = sourceBetween(
            nativeSource,
            "handleSearch: { [weak self] in",
            "handleSearchTextChange:"
        );
        const openMenu = sourceBetween(
            nativeSource,
            "private func openMenu(_ action: MenuAction)",
            "private func beginPendingExpansionIfReady()"
        );

        expect(modelBridge).toContain("prototypeSearchOpen = true");
        expect(modelBridge).toContain('onSearch?(["action": "search"])');
        expect(openMenu).toContain("model.handleSearchTextChange(\"\")");
        expect(openMenu).toContain("model.handleSearch()");
        expect(openMenu).toContain("expansionPending = true");
        expect(openMenu).toContain("model.handleOpenChange(true)");
        expect(openMenu).toContain("beginPendingExpansionIfReady()");
        expect(openMenu).not.toMatch(
            /if action == \.search \{[\s\S]*?model\.handleSearch\(\)[\s\S]*?return/
        );
    });

    it("preallocates the native canvas instead of resizing it after the tap", () => {
        const hostGeometry = sourceBetween(
            scheduleSource,
            "const liquidPrototypeLayerWidth",
            "const requestCloseLiquidPrototype"
        );
        const hostReadiness = sourceBetween(
            nativeSource,
            "override func layoutSubviews()",
            "override func hitTest"
        );

        expect(hostGeometry).toContain(
            "const liquidPrototypeLayerWidth = searchHeaderTargetWidth"
        );
        expect(hostGeometry).toContain(
            "const liquidPrototypeLayerHeight = LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT"
        );
        expect(hostGeometry).not.toContain("liquidPrototypeOpen ?");
        expect(hostReadiness).toContain(
            "bounds.height >= searchExpandedHitHeight - 1"
        );
        expect(hostReadiness).toContain(
            "bounds.width >= model.searchExpandedWidth - 1"
        );
    });

    it("lets touches pass through the preallocated transparent canvas", () => {
        const hitTesting = sourceBetween(
            nativeSource,
            "override func point(inside point: CGPoint",
            "@objc(LiquidGlassIconButtonView)"
        );

        expect(hitTesting).toContain(
            "return collapsedHitRect.contains(point)"
        );
        expect(hitTesting).toContain(
            "let activeHitRect = prototypeMenuOpen ? activeExpandedHitRect : collapsedHitRect"
        );
        expect(hitTesting).toContain("return nil");
        expect(hitTesting).toContain(
            "prototypeSearchOpen ? searchExpandedHitRect : expandedHitRect"
        );
        expect(hitTesting).toContain(
            "height: min(bounds.height, searchExpandedHitHeight)"
        );
    });

    it("does not mount or hard-swap a second React Native search surface", () => {
        const nativeHost = sourceBetween(
            scheduleSource,
            "{usesLiquidViewModeControl ? (",
            ") : ("
        );

        expect(scheduleSource).not.toContain("searchToolbarNativeOpacity");
        expect(scheduleSource).not.toContain("searchToolbarOverlayOpacity");
        expect(scheduleSource).not.toContain(
            "usesLiquidViewModeControl && isSearchToolbarOpen && ("
        );
        expect(nativeHost).toContain("onSearch={openSearchToolbar}");
        expect(nativeHost).toContain(
            "onSearchTextChange={setSearchQuery}"
        );
        expect(nativeHost).toContain("onSearchClose={closeSearchToolbar}");
        expect(nativeHost).not.toContain("searchQuery={searchQuery}");
    });

    it("fades only the year pill while the native surface morphs", () => {
        const openSearch = sourceBetween(
            scheduleSource,
            "const openSearchToolbar",
            "const closeSearchToolbar"
        );
        const closeSearch = sourceBetween(
            scheduleSource,
            "const closeSearchToolbar",
            "const handleLiquidPrototypeOpenChange"
        );
        const nativeOpenChange = sourceBetween(
            scheduleSource,
            "const handleLiquidPrototypeOpenChange",
            "useEffect(() => {\n        if (!isSearchToolbarOpen"
        );

        expect(openSearch).toContain("setActiveToolbarMenu(\"search\")");
        expect(openSearch).toContain(
            "Animated.timing(searchToolbarChromeOpacity"
        );
        expect(openSearch).toContain("toValue: 0");
        expect(closeSearch).toContain("Keyboard.dismiss()");
        expect(closeSearch).not.toContain(
            "searchToolbarChromeOpacity.setValue(1)"
        );
        expect(nativeOpenChange).toContain("if (open) return");
        expect(nativeOpenChange).toContain(
            "searchToolbarChromeOpacity.setValue(1)"
        );
        expect(nativeOpenChange).toContain(
            'currentMenu === "search" ? null : currentMenu'
        );
    });

    it("keeps the non-native fallback interaction within its motion budget", () => {
        const openDuration = numericConstant(
            scheduleSource,
            "SEARCH_TOOLBAR_OPEN_DURATION_MS"
        );
        const revealProgress = numericConstant(
            scheduleSource,
            "SEARCH_FIELD_REVEAL_START_PROGRESS"
        );
        const focusEffect = sourceBetween(
            scheduleSource,
            "useEffect(() => {\n        if (!isSearchToolbarOpen",
            "const openBlankSchedule"
        );

        expect(openDuration).toBeLessThanOrEqual(120);
        expect(revealProgress).toBeLessThanOrEqual(0.3);
        expect(openDuration * revealProgress).toBeLessThanOrEqual(40);
        expect(focusEffect).toContain("usesLiquidViewModeControl");
        expect(focusEffect).toContain("searchInputRef.current?.focus()");
    });

    it("keeps the requested left extension and aligns result cards", () => {
        const geometry = sourceBetween(
            scheduleSource,
            "const searchHeaderRightInset",
            "const liquidPrototypeLayerWidth"
        );
        const resultsLayer = sourceBetween(
            scheduleSource,
            "styles.searchResultsLayer",
            "<CalendarGlassSurface"
        );

        expect(numericConstant(scheduleSource, "SEARCH_TOOLBAR_LEFT_INSET")).toBe(16);
        expect(geometry).toContain("? ADD_MENU_SOURCE.nativeRightInset");
        expect(geometry).toContain(": ADD_MENU_SOURCE.fallbackRightInset");
        expect(geometry).toContain(
            "screenWidth - SEARCH_TOOLBAR_LEFT_INSET - searchHeaderRightInset"
        );
        expect(resultsLayer).toContain("right: searchHeaderRightInset");
    });
});
