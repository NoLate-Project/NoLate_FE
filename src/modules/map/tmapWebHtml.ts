import { buildTmapWebHtmlCanvasAndMarkers } from './tmapWebHtmlCanvasAndMarkers';
import type { TmapWebHtmlContext } from './tmapWebHtmlContext';
import { buildTmapWebHtmlInteractionAndBootstrap } from './tmapWebHtmlInteractionAndBootstrap';
import { buildTmapWebHtmlPathsAndCamera } from './tmapWebHtmlPathsAndCamera';
import { buildTmapWebHtmlProjectionAndSvg } from './tmapWebHtmlProjectionAndSvg';
import { buildTmapWebHtmlShellAndSdk } from './tmapWebHtmlShellAndSdk';

/** 분리된 HTML·스크립트 조각을 실행 순서를 보존해 하나의 WebView 문서로 결합합니다. */
export function buildTmapWebHtml(context: TmapWebHtmlContext): string {
  return [
    buildTmapWebHtmlShellAndSdk(context),
    buildTmapWebHtmlProjectionAndSvg(context),
    buildTmapWebHtmlCanvasAndMarkers(context),
    buildTmapWebHtmlPathsAndCamera(context),
    buildTmapWebHtmlInteractionAndBootstrap(context),
  ].join('');
}
