const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

const SCHEDULE_SCREEN_PATH = "app/schedule/index.tsx";
const scheduleSource = readFileSync(SCHEDULE_SCREEN_PATH, "utf8");
const liquidGlassButtonSource = readFileSync(
    "src/modules/schedule/components/calendar/LiquidGlassIconButton.tsx",
    "utf8"
);
const calendarWrapperSource = readFileSync(
    "src/modules/schedule/components/calendar/CalendarWrapper.tsx",
    "utf8"
);

function sourceBetween(start: string, end: string): string {
    const startIndex = scheduleSource.indexOf(start);
    const endIndex = scheduleSource.indexOf(end, startIndex + start.length);
    if (startIndex < 0 || endIndex < 0) {
        throw new Error(`schedule source boundary not found: ${start} -> ${end}`);
    }
    return scheduleSource.slice(startIndex, endIndex);
}

describe("month agenda loading presentation", () => {
    test("같은 달 날짜 선택은 fetch 월 상태와 월 레이아웃 기준을 변경하지 않는다", () => {
        expect(scheduleSource).toContain(
            "const visibleMonthAnchor = getCalendarMonthAnchor(visibleMonth);"
        );
        expect(scheduleSource).toContain(
            "const monthDisplayLayoutAnchorDay = getCalendarMonthAnchor("
        );
        expect(scheduleSource).toContain(
            "current === monthAnchor ? current : monthAnchor"
        );
    });

    test("카테고리 오류 배너가 상단 pill 메뉴를 덮지 않는다", () => {
        const toolbarStyles = sourceBetween(
            "toolbarLayer: {",
            "scheduleActionPillLayer: {"
        );

        expect(toolbarStyles).toMatch(
            /toolbarLayer:[\s\S]*zIndex: 40,[\s\S]*categoryErrorLayer:[\s\S]*zIndex: 39,/
        );
    });

    test("상세 월 swipe는 무거운 선택 commit 전에 native pill을 먼저 갱신한다", () => {
        expect(liquidGlassButtonSource).toContain(
            "nativeButtonRef.current?.setNativeProps({"
        );
        expect(liquidGlassButtonSource).toContain(
            "setDisplayContent: ({ label: nextLabel, buttonWidth: nextButtonWidth })"
        );
        expect(calendarWrapperSource).toContain(
            "onDetailMonthPreview={onDetailMonthPreview}"
        );
        expect(scheduleSource).toContain(
            "primaryDatePillNativeRef.current?.setDisplayContent({"
        );
        expect(scheduleSource).toContain(
            "onDetailMonthPreview={"
        );
        expect(scheduleSource).toContain(
            "handleDetailMonthPreview"
        );
    });

    test("표시 중인 월이 캐시에 없을 때만 agenda loader를 노출한다", () => {
        expect(scheduleSource).toContain(
            "const monthAgendaLoading = !hasMonthAgendaCache\n        && (state.loading || scheduleError === null);"
        );
        expect(scheduleSource).not.toContain(
            "hasCompletedInitialScheduleLoadRef"
        );

        const agendaRenderer = sourceBetween(
            "const renderMonthAgendaPanelContent",
            "return ("
        );
        expect(
            agendaRenderer.match(/loading=\{monthAgendaLoading\}/g)
        ).toHaveLength(2);
        expect(agendaRenderer).not.toContain("loading={state.loading}");
    });

    test("일정 응답은 최신 범위 sequence만 화면에 게시한다", () => {
        const scheduleLoader = sourceBetween(
            "const loadSchedules = useCallback",
            "useEffect(() => {\n        if (!isFocused)"
        );
        expect(scheduleLoader).toContain(
            "publishScheduleSnapshot(requestSequence, cached.items);"
        );
        expect(scheduleLoader).toContain(
            "publishScheduleSnapshot(requestSequence, refreshed.items);"
        );
        expect(scheduleLoader).toMatch(
            /catch \(error\) \{\s*if \(requestSequence !== scheduleLoadSequenceRef\.current\) return;/
        );
        expect(scheduleLoader).toMatch(
            /finally \{\s*if \(requestSequence === scheduleLoadSequenceRef\.current\) \{\s*dispatch\(\{ type: "SET_LOADING", loading: false \}\);/
        );
    });

    test("visible 월 cache hit도 UI를 막지 않고 sliding prefetch edge를 갱신한다", () => {
        const scheduleLoader = sourceBetween(
            "const loadSchedules = useCallback",
            "useEffect(() => {\n        if (!isFocused)"
        );
        const cacheHitStart = scheduleLoader.indexOf(
            "if (hasVisibleMonthCache) {"
        );
        const cacheHitEnd = scheduleLoader.indexOf(
            "return;\n        }",
            cacheHitStart
        );
        expect(cacheHitStart).toBeGreaterThanOrEqual(0);
        expect(cacheHitEnd).toBeGreaterThan(cacheHitStart);
        const cacheHitBranch = scheduleLoader.slice(
            cacheHitStart,
            cacheHitEnd
        );

        expect(cacheHitBranch).toContain(
            'dispatch({ type: "SET_LOADING", loading: false });'
        );
        expect(cacheHitBranch).toContain(
            "refreshCalendarScheduleCache("
        );
        expect(cacheHitBranch).toContain(
            "publishScheduleSnapshot(requestSequence, refreshed.items);"
        );
        expect(cacheHitBranch).not.toContain(
            'dispatch({ type: "SET_ITEMS"'
        );
    });

    test("메타데이터 응답은 detail month motion 중 React state로 merge하지 않는다", () => {
        const metadataLoader = sourceBetween(
            "const loadCalendarMetadata = useCallback",
            "useEffect(() => {\n        if (!isFocused) return undefined;"
        );
        const activeMotionBranch = metadataLoader.indexOf(
            "if (detailMonthMotionActiveRef.current) {"
        );
        const pendingWrite = metadataLoader.indexOf(
            "pendingCalendarMetadataByDateRef.current =\n                    mergeCalendarMetadataDays(",
            activeMotionBranch
        );
        const immediateMerge = metadataLoader.indexOf(
            "mergeCalendarMetadataIntoState(nextDaysByDate);",
            pendingWrite
        );

        expect(activeMotionBranch).toBeGreaterThanOrEqual(0);
        expect(pendingWrite).toBeGreaterThan(activeMotionBranch);
        expect(immediateMerge).toBeGreaterThan(pendingWrite);
        expect(metadataLoader.slice(pendingWrite, immediateMerge)).toContain(
            "} else {"
        );
        expect(metadataLoader).toContain(
            "mergeCalendarMetadataDays(\n                        pendingCalendarMetadataByDateRef.current,"
        );
    });

    test("직전 motion 종료의 metadata merge는 다음 frame을 기다리고 retouch를 다시 확인한다", () => {
        const motionHandler = sourceBetween(
            "const handleDetailMonthMotionActiveChange = useCallback",
            "useEffect(() => () => {"
        );
        const cancelPendingFrame = motionHandler.indexOf(
            "cancelAnimationFrame(pendingFrame);"
        );
        const inactiveBoundary = motionHandler.indexOf("if (active) return;");
        const deferredFlush = motionHandler.indexOf(
            "const frame = requestAnimationFrame(() => {"
        );
        const retouchGuard = motionHandler.indexOf(
            "if (detailMonthMotionActiveRef.current) return;",
            deferredFlush
        );
        const pendingRead = motionHandler.indexOf(
            "pendingCalendarMetadataByDateRef.current;",
            retouchGuard
        );
        const pendingClear = motionHandler.indexOf(
            "pendingCalendarMetadataByDateRef.current = {};",
            pendingRead
        );
        const merge = motionHandler.indexOf(
            "mergeCalendarMetadataIntoState(pendingMetadata);",
            pendingClear
        );
        const fetchMonthUpdate = motionHandler.indexOf(
            "updateFetchVisibleMonth(visibleMonthRef.current);",
            merge
        );

        expect(cancelPendingFrame).toBeGreaterThanOrEqual(0);
        expect(inactiveBoundary).toBeGreaterThan(cancelPendingFrame);
        expect(deferredFlush).toBeGreaterThan(inactiveBoundary);
        expect(retouchGuard).toBeGreaterThan(deferredFlush);
        expect(pendingRead).toBeGreaterThan(retouchGuard);
        expect(pendingClear).toBeGreaterThan(pendingRead);
        expect(merge).toBeGreaterThan(pendingClear);
        expect(fetchMonthUpdate).toBeGreaterThan(merge);
    });

    test("안전한 cache hydrate는 삭제만 발생한 일정 집합도 교체한다", () => {
        const snapshotPublisher = sourceBetween(
            "const applyScheduleItemsToStore = useCallback",
            "const loadSchedules = useCallback"
        );

        expect(snapshotPublisher).toContain(
            "items.length !== Object.keys(currentScheduleItemsById).length"
        );
        expect(snapshotPublisher).toMatch(
            /hasItemSetChanged[\s\S]*dispatch\(\{ type: "SET_ITEMS", items \}\);/
        );
    });

    test("foreground 전체 일정 조회 대신 이미 받은 월 범위를 재사용한다", () => {
        const scheduleApiImport = sourceBetween(
            "import {\n    getCalendarSchedules,",
            "} from \"../../src/api/schedule\";"
        );
        const routeSetupProjection = sourceBetween(
            "const routeSetupItems = useMemo",
            "const writableCategories = useMemo"
        );

        expect(scheduleApiImport).not.toContain("getSchedules,");
        expect(routeSetupProjection).toContain(
            "itemsArray.filter((item) => item.routeSetupRequired === true)"
        );
    });

    test("폐기된 revision 응답은 이전 월 범위를 다시 조회하지 않는다", () => {
        const revisionEffect = sourceBetween(
            "useEffect(() => {\n        if (!isFocused)",
            "const mergeCalendarMetadataIntoState"
        );

        expect(revisionEffect).toContain("let cancelled = false;");
        expect(revisionEffect).toContain("if (cancelled) return;");
        expect(revisionEffect).toContain("cancelled = true;");
        expect(revisionEffect).toContain(
            "let revisionSync = calendarRevisionSyncPromiseRef.current;"
        );
        expect(revisionEffect).toContain(
            "calendarRevisionSyncPromiseRef.current =\n                            Promise.resolve(false);"
        );
    });

    test("일정 생성 실패는 서버에 calendar GET을 추가하지 않고 cache만 복구한다", () => {
        const addMutation = sourceBetween(
            "const addItem = async",
            "const closeToolbarMenu = useCallback"
        );
        const failureStart = addMutation.indexOf("} catch (error) {");
        const failureBranch = addMutation.slice(failureStart);

        expect(failureBranch).toContain(
            "hasCalendarScheduleMonthCache(fetchVisibleMonth)"
        );
        expect(failureBranch).toContain(
            "scheduleLoadSequenceRef.current = scheduleSequenceBeforeMutation;"
        );
        expect(failureBranch).toContain("readCalendarScheduleCache(");
        expect(failureBranch).not.toContain("loadSchedules();");
    });

    test("보조 badge는 active에서만 push/foreground와 10분 safety refresh를 사용한다", () => {
        const auxiliaryRefresh = sourceBetween(
            "const loadShareAttention = useCallback",
            "useEffect(() => {\n        let cancelled = false;\n        setCategoryLoading"
        );

        expect(scheduleSource).toContain(
            "const AUXILIARY_SAFETY_REFRESH_MS = 10 * 60 * 1000;"
        );
        expect(scheduleSource).not.toContain("SHARE_ATTENTION_REFRESH_MS");
        expect(auxiliaryRefresh).toContain(
            'AppState.currentState !== "active"'
        );
        expect(auxiliaryRefresh).toContain(
            "subscribeAppNotificationReceived(() => {"
        );
        expect(auxiliaryRefresh).not.toContain(
            "searchResultCacheRef.current.clear();"
        );
        expect(auxiliaryRefresh).toContain("auxiliaryRefreshInFlight");
        expect(auxiliaryRefresh).toContain("auxiliaryRefreshPending");
        expect(auxiliaryRefresh).toContain(
            "lastAuxiliaryRefreshAt: number | null = null"
        );
        expect(auxiliaryRefresh).toContain("startAuxiliarySafetyTimer()");
        expect(auxiliaryRefresh).toContain("stopAuxiliarySafetyTimer()");
        expect(auxiliaryRefresh).toMatch(
            /if \(nextState === "active"\) \{[\s\S]*startAuxiliarySafetyTimer\(\);[\s\S]*refreshAuxiliaryData\(\);[\s\S]*\} else \{[\s\S]*stopAuxiliarySafetyTimer\(\);/
        );
        expect(auxiliaryRefresh).toContain(
            "() => refreshAuxiliaryData(AUXILIARY_SAFETY_REFRESH_MS)"
        );
    });

    test("일정 검색은 두 글자·450ms·abort·작은 동일키 cache 경계를 지킨다", () => {
        const searchPolicy = sourceBetween(
            "const normalizedSearchKeyword =",
            "// 새 일정 payload를 백엔드에 저장한 뒤 응답 값을 일정 저장소에 추가한다."
        );

        expect(scheduleSource).toContain("const SEARCH_MIN_QUERY_LENGTH = 2;");
        expect(scheduleSource).toContain("const SEARCH_DEBOUNCE_MS = 450;");
        expect(scheduleSource).toContain("const SEARCH_RESULT_LIMIT = 20;");
        expect(searchPolicy).toContain(
            "searchKeywordLength < SEARCH_MIN_QUERY_LENGTH"
        );
        expect(searchPolicy).toContain("const abortController = new AbortController();");
        expect(searchPolicy).toContain("abortController.signal");
        expect(searchPolicy).toContain("searchResultCacheRef.current");
        expect(searchPolicy).toContain("SEARCH_RESULT_CACHE_TTL_MS");
        expect(searchPolicy).toContain("limit: SEARCH_RESULT_LIMIT");
        expect(searchPolicy).toContain("}, SEARCH_DEBOUNCE_MS);");
        expect(scheduleSource).toContain("두 글자 이상 입력해 주세요");
    });

    test("일정 mutation은 검색 cache를 즉시 무효화한다", () => {
        expect(scheduleSource).toContain(
            "subscribeScheduleMutation(invalidateSearchResults)"
        );
        expect(scheduleSource).toContain(
            "searchResultCacheRef.current.clear();"
        );
        expect(scheduleSource).toContain(
            "setSearchInvalidationKey((value) => value + 1);"
        );
        expect(scheduleSource).toContain("searchInvalidationKey,");
        expect(scheduleSource).toContain(
            "searchAbortControllerRef.current?.abort();"
        );
    });

    test("stack형 월 스크롤은 네트워크 기준 월을 160ms trailing coalesce한다", () => {
        const fetchMonthEffect = sourceBetween(
            "useEffect(() => {\n        if (isYearDepthTransitionActive) return;",
            "useEffect(() => {\n        if (pendingSelectedDay"
        );

        expect(scheduleSource).toContain(
            "const STACK_MONTH_FETCH_COALESCE_MS = 160;"
        );
        expect(fetchMonthEffect).toContain(
            "isContinuousMonthViewMode(calendarViewMode)"
        );
        expect(fetchMonthEffect).toContain(
            "}, STACK_MONTH_FETCH_COALESCE_MS);"
        );
        expect(fetchMonthEffect).toContain("return () => clearTimeout(timer);");
    });
});
