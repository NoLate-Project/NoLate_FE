/** WebView 지도 문서를 생성할 때 각 HTML 조각이 공유하는 직렬화 값입니다. */
export type TmapWebHtmlContext = {
  initialMapBackground: string;
  vectorScriptVersionJson: string;
  vectorScriptUrl: string;
  initialLat: number;
  initialLng: number;
  initialZoom: number;
  isDevelopmentFlag: string;
  showZoomControlFlag: string;
  showLocationControlFlag: string;
  darkFlag: string;
  nativeDirectionCapabilityScript: string;
  nativeStrokeColorScript: string;
  nativeDirectionReportScript: string;
  busBadgeGlyphJson: string;
  subwayBadgeGlyphJson: string;
  mapSelectionEventsJson: string;
  mapTouchSelectionMaxMovementPx: number;
};
