const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync(
  'src/routeSupport/schedule/ScheduleDetailRouteSheet.tsx',
  'utf8',
);
const quickSummarySource = readFileSync(
  'src/routeSupport/schedule/ScheduleDetailRouteQuickSummary.tsx',
  'utf8',
);
const routeSummaryStart = detailSource.indexOf('styles.sheetRouteSummary');
const routeSummaryEnd = detailSource.indexOf(
  '<SavedJourneyRouteTimeline',
  routeSummaryStart,
);
const routeSummarySource = detailSource.slice(
  routeSummaryStart,
  routeSummaryEnd,
);

describe('schedule route detail information hierarchy', () => {
  test('keeps the route bar in the collapsed summary and out of the detailed timeline', () => {
    expect(routeSummaryStart).toBeGreaterThanOrEqual(0);
    expect(routeSummaryEnd).toBeGreaterThan(routeSummaryStart);
    expect(routeSummarySource).toContain('{hasDetailedRoute ? (');
    expect(routeSummarySource).toContain('{!hasDetailedRoute ? (');
    expect(detailSource).not.toContain('<TransitRouteProgressBar');
    expect(routeSummarySource).toContain('testID="schedule-route-timeline-heading"');
    expect(routeSummarySource).not.toContain('경로 상세');
    expect(quickSummarySource).toContain('<TransitRouteProgressBar');
    expect(quickSummarySource).toContain("getScheduleAccessibilityVisibility(sheetMode === 'compact')");
  });

  test('own-route base time is delegated to the timeline while participant plans retain it', () => {
    expect(routeSummarySource).toContain('routeDetailInfo && inspectedTravelPlan ? (');
    expect(routeSummarySource).toMatch(
      /\{hhmmText\(fromISO\(routeDetailInfo\.departureTime\)\)\}\s+출발\s+기준/,
    );
    expect(detailSource).toContain('<SavedJourneyRouteTimeline');
    const timelineSource = readFileSync('src/modules/journey/SavedJourneyRouteTimeline.tsx', 'utf8');
    expect(timelineSource).toContain('<RouteStepTimeline {...props}');
    expect(timelineSource).toContain('currentGuidance={savedJourneyTimelineHighlight');
  });
});
