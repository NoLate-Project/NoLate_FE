import type { TmapWebHtmlContext } from './tmapWebHtmlContext';

/** TMAP WebView 문서의 CanvasAndMarkers 영역을 생성합니다. */
export function buildTmapWebHtmlCanvasAndMarkers(
  _context: TmapWebHtmlContext,
): string {
  return `      // Lucide의 단순한 24px 선형을 마커 크기에 맞춰 배치한다.
      // 작은 지도 아이콘에서도 창문·바퀴·보행 형태가 뭉개지지 않는 형태만 사용한다.
      function markerLucideGlyph(style, centerX, centerY, renderedSize, color) {
        var size = Math.max(10, Number(renderedSize) || 14);
        var scale = size / 24;
        var x = centerX - (size / 2);
        var y = centerY - (size / 2);
        var stroke = color || "#FFFFFF";
        var paths = "";
        if (style === "bus") {
          paths =
            '<path d="M4 6 2 7" />' +
            '<path d="M10 6h4" />' +
            '<path d="m22 7-2-1" />' +
            '<rect width="16" height="16" x="4" y="3" rx="2" />' +
            '<path d="M4 11h16" />' +
            '<path d="M8 15h.01" />' +
            '<path d="M16 15h.01" />' +
            '<path d="M6 19v2" />' +
            '<path d="M18 21v-2" />';
        } else if (style === "subway") {
          paths =
            '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1" />' +
            '<path d="m9 15-1-1" />' +
            '<path d="m15 15 1-1" />' +
            '<path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" />' +
            '<path d="m8 19-2 3" />' +
            '<path d="m16 19 2 3" />';
        } else if (style === "walk") {
          paths =
            '<circle cx="12" cy="5" r="1" />' +
            '<path d="m9 20 3-6 3 6" />' +
            '<path d="m6 8 6 2 6-2" />' +
            '<path d="M12 10v4" />';
        }
        if (!paths) return "";
        return '<g transform="translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') scale(' + scale.toFixed(4) + ')" fill="none" stroke="' + stroke + '" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round">' + paths + '</g>';
      }

      // 출발/도착처럼 "지도 포인트 자체"를 강조할 때 쓰는 핀 렌더러.
      function markerIcon(item) {
        var fill = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var label = item && item.pinLabel ? String(item.pinLabel).trim() : "";
        var rawScale = Number(item && item.markerScale);
        var markerScale = isFinite(rawScale) ? Math.max(0.76, Math.min(1, rawScale)) : 1;
        // 핀 끝점을 TMAP Marker offset으로 반환해 경로 좌표와 시각적 끝점을 일치시킨다.
        var baseWidth = label ? 58 : 42;
        var baseHeight = label ? 64 : 52;
        var w = Math.round(baseWidth * markerScale);
        var h = Math.round(baseHeight * markerScale);
        var centerX = Math.round(baseWidth / 2);
        var textSize = label.length >= 3 ? 10.5 : 11.5;
        var anchorY = label ? 54 : 44;
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + baseWidth + ' ' + baseHeight + '">' +
            '<defs><filter id="pinShadow" x="-35%" y="-25%" width="170%" height="175%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.8" flood-color="#0F172A" flood-opacity="0.22" /></filter></defs>' +
            (label
              ? (
                '<ellipse cx="' + centerX + '" cy="58" rx="8.5" ry="2.6" fill="rgba(15,23,42,0.14)" />' +
                '<path filter="url(#pinShadow)" d="M' + centerX + ' 3 C18.5 3 10 11.3 10 21.5 C10 34.2 24.7 49.6 27.7 52.6 C28.4 53.3 29.6 53.3 30.3 52.6 C33.3 49.6 48 34.2 48 21.5 C48 11.3 39.5 3 ' + centerX + ' 3 Z" fill="' + fill + '" stroke="rgba(255,255,255,0.88)" stroke-width="1.7" stroke-linejoin="round" />' +
                '<circle cx="' + centerX + '" cy="21.5" r="13.2" fill="rgba(15,23,42,0.06)" />' +
                '<text x="' + centerX + '" y="25.2" text-anchor="middle" font-size="' + textSize + '" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="800" fill="#FFFFFF">' + escapeXml(label) + '</text>'
              )
              : '<path filter="url(#pinShadow)" fill="' + fill + '" stroke="rgba(255,255,255,0.88)" stroke-width="1.7" d="M21 3C11.6 3 4 10.6 4 20c0 11.6 13 24.5 15.6 27 .8.8 2 .8 2.8 0C25 44.5 38 31.6 38 20 38 10.6 30.4 3 21 3Zm0 23.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z"/>') +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
          anchorX: centerX * markerScale,
          anchorY: anchorY * markerScale,
        };
      }

      // 문자 종류별 가중치로 텍스트 폭을 추정한다.
      // 한글/숫자/영문의 실제 폭 차이를 반영해 배지 width 오차를 줄인다.
      function estimateBadgeTextWidth(label) {
        var text = String(label || "");
        var width = 0;
        for (var i = 0; i < text.length; i += 1) {
          var ch = text.charAt(i);
          var code = text.charCodeAt(i);
          if (/\s/.test(ch)) {
            width += 3.1;
          } else if (/[0-9]/.test(ch)) {
            width += 6.4;
          } else if (/[A-Z]/.test(ch)) {
            width += 7.0;
          } else if (/[a-z]/.test(ch)) {
            width += 6.1;
          } else if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)) {
            width += 9.7;
          } else {
            width += 7.4;
          }
        }
        return Math.max(16, Math.round(width));
      }

      // 교통 이벤트는 실제 좌표의 작은 원형 아이콘과 한 겹 라벨만 사용한다.
      function buildBadgeConfig(item) {
        var labelRaw = (item && item.badgeLabel) ? String(item.badgeLabel) : "";
        var label = labelRaw.trim();
        if (!label) label = item && item.caption ? String(item.caption) : "구간";

        var style = item && item.markerStyle ? String(item.markerStyle) : "default";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var textColor = item && item.badgeTextColor ? String(item.badgeTextColor) : "#1F2937";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(148,163,184,0.72)";
        var glyph = item && item.badgeGlyph ? String(item.badgeGlyph) : "";
        var eventIntent = item && item.eventIntent ? String(item.eventIntent) : "board";
        var variant = item && item.badgeVariant ? String(item.badgeVariant) : "default";
        var isRouteTag = variant === "route";
        var side = item && item.badgeSide === "left" ? "left" : "right";
        var specialStyle = style === "bus" || style === "subway" || style === "walk";
        var markerSize = specialStyle ? 28 : 24;
        var labelWidth = Math.max(44, Math.min(isRouteTag ? 96 : 116, estimateBadgeTextWidth(label) + 18));
        var overlap = 4;
        return {
          width: markerSize + labelWidth - overlap,
          height: Math.max(32, markerSize + 4),
          markerSize: markerSize,
          labelWidth: labelWidth,
          overlap: overlap,
          label: label,
          accent: accent,
          textColor: textColor,
          borderColor: borderColor,
          glyph: glyph,
          style: style,
          eventIntent: eventIntent,
          isRouteTag: isRouteTag,
          side: side,
          specialStyle: specialStyle,
        };
      }

      // 기준점은 원 중앙에 고정해 라벨 방향이 바뀌어도 승하차 좌표가 움직이지 않는다.
      function markerBadgeIcon(item) {
        var cfg = buildBadgeConfig(item);
        var label = escapeXml(cfg.label);
        var glyph = escapeXml(cfg.glyph);
        var w = cfg.width;
        var h = cfg.height;
        var centerY = h / 2;
        var labelX = cfg.side === "left" ? 0 : (cfg.markerSize - cfg.overlap);
        var iconCenterX = cfg.side === "left"
          ? (cfg.labelWidth - cfg.overlap + cfg.markerSize / 2)
          : cfg.markerSize / 2;
        var textX = labelX + 9;
        var markerFill = cfg.accent;
        var markerStroke = "#FFFFFF";
        var markerRadius = Math.max(10, (cfg.markerSize / 2) - 1);
        var cardFill = cfg.isRouteTag ? cfg.accent : "rgba(255,255,255,0.97)";
        var cardTextColor = cfg.isRouteTag ? "#FFFFFF" : cfg.textColor;
        var cardBorder = cfg.isRouteTag
          ? "rgba(255,255,255,0.72)"
          : (cfg.specialStyle ? colorWithAlpha(cfg.accent, 0.46) : cfg.borderColor);
        var badgeGlyphScale = cfg.style === "walk" ? 0.70 : 0.66;
        var iconMarkup = markerLucideGlyph(cfg.style, iconCenterX, centerY, cfg.markerSize * badgeGlyphScale, "#FFFFFF");
        if (!iconMarkup && glyph) {
          iconMarkup = '<text x="' + iconCenterX + '" y="' + (centerY + 3.5) + '" text-anchor="middle" font-size="10" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-weight="800" fill="#FFFFFF">' + glyph + '</text>';
        }
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<defs><filter id="badgeShadow" x="-25%" y="-35%" width="150%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#0F172A" flood-opacity="0.24" /></filter></defs>' +
            '<g filter="url(#badgeShadow)">' +
              '<rect x="' + (labelX + 0.75) + '" y="2.5" width="' + (cfg.labelWidth - 1.5) + '" height="25" rx="6" fill="' + cardFill + '" stroke="' + cardBorder + '" stroke-width="1.1" />' +
              '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="' + markerRadius + '" fill="' + markerFill + '" stroke="' + markerStroke + '" stroke-width="2" />' +
            '</g>' +
            '<text x="' + textX + '" y="19" font-size="11" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="700" fill="' + cardTextColor + '">' + label + '</text>' +
            iconMarkup +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
          anchorX: iconCenterX,
          anchorY: centerY,
        };
      }

      // 노선명 태그는 승하차 노드와 분리한다. 줌 단계가 바뀌어도 노드 아이콘은 교체되지 않는다.
      function markerRouteLabelIcon(item) {
        var rawLabel = item && item.badgeLabel ? String(item.badgeLabel).trim() : "";
        var label = rawLabel || (item && item.caption ? String(item.caption) : "노선");
        var subLabel = item && item.badgeSubLabel ? String(item.badgeSubLabel).trim() : "";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var side = item && item.badgeSide === "left" ? "left" : "right";
        var variant = item && item.badgeVariant ? String(item.badgeVariant) : "route";
        var isContext = variant === "context";
        var isStop = variant === "stop";
        var widthLimit = isContext ? 158 : (isStop ? 168 : 88);
        var widthFloor = isContext ? 92 : (isStop ? 54 : 40);
        var estimatedWidth = Math.max(
          estimateBadgeTextWidth(label),
          subLabel ? estimateBadgeTextWidth(subLabel) : 0
        );
        var labelWidth = Math.max(widthFloor, Math.min(widthLimit, estimatedWidth + (isContext ? 28 : 18)));
        // 핵심 노드의 바깥 링과 라벨 사이에 여백을 둬서 한 덩어리처럼 뭉쳐 보이지 않게 한다.
        var gap = isContext ? 12 : 11;
        var width = labelWidth + gap;
        var height = isContext ? 44 : (isStop ? 28 : 30);
        var centerY = height / 2;
        var boxX = side === "left" ? 0 : gap;
        var anchorX = side === "left" ? width : 0;
        var boxEdgeX = side === "left" ? labelWidth : gap;
        var textX = isContext || isStop ? boxX + 13 : boxX + (labelWidth / 2);
        var boxY = isContext ? 2.5 : (isStop ? 2.5 : 3.5);
        var boxHeight = isContext ? 39 : (isStop ? 23 : 23);
        var cardFill = isContext || isStop
          ? (isDarkTheme ? "rgba(17,24,39,0.97)" : "rgba(255,255,255,0.98)")
          : accent;
        var primaryColor = isContext || isStop
          ? (isDarkTheme ? "#F9FAFB" : "#111827")
          : "#FFFFFF";
        var secondaryColor = isDarkTheme ? "#CBD5E1" : "#4B5563";
        var textAnchor = isContext || isStop ? "start" : "middle";
        var textMarkup = isContext
          ? (
              '<text x="' + textX + '" y="17" text-anchor="start" font-size="11.2" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="750" fill="' + primaryColor + '">' + escapeXml(label) + '</text>' +
              (subLabel ? '<text x="' + textX + '" y="31.5" text-anchor="start" font-size="9.8" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="600" fill="' + secondaryColor + '">' + escapeXml(subLabel) + '</text>' : '')
            )
          : '<text x="' + textX + '" y="' + (isStop ? 18.1 : 18.9) + '" text-anchor="' + textAnchor + '" font-size="' + (isStop ? 10.2 : 10.5) + '" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="700" fill="' + primaryColor + '">' + escapeXml(label) + '</text>';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
            '<defs><filter id="routeLabelShadow" x="-25%" y="-35%" width="150%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#0F172A" flood-opacity="0.20" /></filter></defs>' +
            '<line x1="' + anchorX + '" y1="' + centerY + '" x2="' + boxEdgeX + '" y2="' + centerY + '" stroke="' + accent + '" stroke-width="1.6" stroke-linecap="round" />' +
            '<rect filter="url(#routeLabelShadow)" x="' + (boxX + 0.5) + '" y="' + boxY + '" width="' + (labelWidth - 1) + '" height="' + boxHeight + '" rx="6" fill="' + cardFill + '" stroke="' + (isContext || isStop ? colorWithAlpha(accent, 0.72) : "rgba(255,255,255,0.58)") + '" stroke-width="' + (isContext ? 1.1 : 0.8) + '" />' +
            (isContext ? '<rect x="' + (boxX + 1.5) + '" y="4.5" width="4" height="35" rx="2" fill="' + accent + '" />' : '') +
            textMarkup +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: width,
          height: height,
          anchorX: anchorX,
          anchorY: centerY,
        };
      }

      function markerDotIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(255,255,255,0.95)";
        var rawSize = Number(item && item.dotSize);
        // QA 앵커 비교용 단일 점이다. 경로 점선은 이 마커가 아니라 TMAP Polyline dash를 사용한다.
        var size = isFinite(rawSize) ? Math.max(4, Math.min(14, Math.round(rawSize))) : 8;
        var center = Math.round(size / 2);
        var borderWidth = borderColor === "transparent" ? 0 : Math.max(0.7, size * 0.16);
        var radius = Math.max(0.9, center - (borderWidth > 0 ? 1.0 : 0.7));
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="' + bg + '" stroke="' + borderColor + '" stroke-width="' + borderWidth + '" />' +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: size,
          height: size,
        };
      }

      function markerStationIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var style = item && item.markerStyle ? String(item.markerStyle) : "subway";
        var stationVariant = item && item.stationVariant ? String(item.stationVariant) : "default";
        var isCompact = stationVariant === "compact";
        var rawSize = Number(item && item.dotSize);
        // 통과 정류장은 얇은 노선색 링으로 유지하고, 승하차·환승 노드는 아이콘을 크게 보여준다.
        var size = isFinite(rawSize)
          ? Math.max(isCompact ? 10 : 20, Math.min(isCompact ? 16 : 36, Math.round(rawSize)))
          : (isCompact ? 12 : 28);
        var center = size / 2;
        if (isCompact) {
          var compactOuterStroke = Math.max(0.9, size * 0.08);
          var compactRouteStroke = Math.max(1.25, size * 0.11);
          var compactInnerRadius = Math.max(2.1, center - 3.0);
          var compactSvg = '' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
              '<defs><filter id="compactStopShadow" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="0.6" stdDeviation="0.7" flood-color="#0F172A" flood-opacity="0.24" /></filter></defs>' +
              '<circle filter="url(#compactStopShadow)" cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + (center - 1).toFixed(1) + '" fill="#FFFFFF" stroke="rgba(15,23,42,0.72)" stroke-width="' + compactOuterStroke.toFixed(1) + '" />' +
              '<circle cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + compactInnerRadius.toFixed(1) + '" fill="#FFFFFF" stroke="' + bg + '" stroke-width="' + compactRouteStroke.toFixed(1) + '" />' +
            '</svg>';
          return {
            uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(compactSvg),
            width: size,
            height: size,
          };
        }
        var glyphStyle = style === "bus" || style === "walk" ? style : "subway";
        var glyphScale = glyphStyle === "walk" ? 0.68 : 0.64;
        var glyph = markerLucideGlyph(glyphStyle, center, center, size * glyphScale, "#FFFFFF");
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<defs><filter id="stationNodeShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="0.9" stdDeviation="1.1" flood-color="#0F172A" flood-opacity="0.22" /></filter></defs>' +
            '<circle filter="url(#stationNodeShadow)" cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + (center - 1).toFixed(1) + '" fill="#FFFFFF" />' +
            '<circle cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + (center - 3.2).toFixed(1) + '" fill="' + bg + '" />' +
            glyph +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: size,
          height: size,
        };
      }
      // Vector JS는 ROAD/NIGHT mapType을 공식 지원한다. Raster 타일 DOM에 CSS 필터를
      // 적용하던 이전 보정은 벡터 라벨과 도로를 흐리게 만들 수 있어 사용하지 않는다.
      function applyTheme(isDark) {
        isDarkTheme = !!isDark;
        var mapEl = document.getElementById("map");
        var toneEl = document.getElementById("mapTone");
        var locationBtn = document.getElementById("locationBtn");
        var nextMapType = isDarkTheme ? "NIGHT" : "ROAD";

        try {
          if (map && typeof map.setMapType === "function" && appliedMapType !== nextMapType) {
            map.setMapType(nextMapType);
            appliedMapType = nextMapType;
          }
        } catch (_mapTypeError) {}

        if (mapEl) {
          mapEl.style.filter = "none";
          mapEl.style.transition = "none";
        }

        if (toneEl) {
          toneEl.style.background = "transparent";
          toneEl.style.opacity = "0";
        }

        document.body.style.backgroundColor = isDarkTheme ? "#0B1220" : "#F2F2F7";

        if (locationBtn) {
          locationBtn.style.backgroundColor = isDarkTheme
            ? "rgba(22, 28, 39, 0.9)"
            : "rgba(255,255,255,0.95)";
          locationBtn.style.color = isDarkTheme ? "#E5EDF8" : "#111827";
          locationBtn.style.borderColor = isDarkTheme
            ? "rgba(123, 145, 171, 0.4)"
            : "rgba(17, 24, 39, 0.2)";
          locationBtn.style.boxShadow = isDarkTheme
            ? "0 4px 10px rgba(2, 6, 23, 0.45)"
            : "0 4px 10px rgba(0,0,0,0.18)";
        }
      }

      function applyBaseDim(opacity) {
        var toneEl = document.getElementById("mapTone");
        if (!toneEl) return;
        var value = Number(opacity);
        if (!isFinite(value) || value <= 0) {
          toneEl.style.background = "transparent";
          toneEl.style.opacity = "0";
          return;
        }
        var clamped = Math.max(0, Math.min(0.85, value));
        toneEl.style.background = isDarkTheme
          ? "rgba(0,0,0,0.36)"
          : "rgba(255,255,255,0.64)";
        toneEl.style.opacity = String(clamped);
      }

      function clearMarkers() {
        Object.keys(markers).forEach(function (key) {
          var entry = markers[key];
          var marker = entry && entry.marker ? entry.marker : entry;
          if (marker && marker.setMap) marker.setMap(null);
        });
        markers = {};
      }

      function buildMarkerIconInfo(item) {
        var displayType = item && item.displayType ? String(item.displayType) : "pin";
        if (displayType === "routeLabel") return markerRouteLabelIcon(item);
        if (displayType === "badge") return markerBadgeIcon(item);
        if (displayType === "dot") return markerDotIcon(item);
        if (displayType === "station") return markerStationIcon(item);
        return markerIcon(item);
      }

      function markerRectFromIcon(item, iconInfo) {
        var point = projectLatLngToScreenPoint(item);
        if (!point || !iconInfo) return null;
        var anchorX = Number(iconInfo.anchorX);
        var anchorY = Number(iconInfo.anchorY);
        if (!isFinite(anchorX)) anchorX = iconInfo.width / 2;
        if (!isFinite(anchorY)) anchorY = iconInfo.height / 2;
        return {
          left: point.x - anchorX,
          top: point.y - anchorY,
          right: point.x - anchorX + iconInfo.width,
          bottom: point.y - anchorY + iconInfo.height,
        };
      }

      function paddedMarkerRect(rect, padding) {
        var value = isFinite(padding) ? Math.max(0, padding) : 0;
        return {
          left: rect.left - value,
          top: rect.top - value,
          right: rect.right + value,
          bottom: rect.bottom + value,
        };
      }

      function markerRectsOverlap(left, right) {
        return !(
          left.right <= right.left ||
          left.left >= right.right ||
          left.bottom <= right.top ||
          left.top >= right.bottom
        );
      }

      function resolveRouteLabelViewportSide(item, iconInfo) {
        var displayType = item && item.displayType ? String(item.displayType) : "pin";
        if (displayType !== "routeLabel") return { item: item, iconInfo: iconInfo };
        var rect = markerRectFromIcon(item, iconInfo);
        if (!rect) return { item: item, iconInfo: iconInfo };
        var viewport = getRouteOverlaySize();
        var side = item && item.badgeSide === "left" ? "left" : "right";
        var nextSide = side;
        if (rect.right > viewport.width - 10 && side !== "left") nextSide = "left";
        else if (rect.left < 10 && side !== "right") nextSide = "right";
        if (nextSide === side) return { item: item, iconInfo: iconInfo };

        var resolvedItem = Object.assign({}, item, { badgeSide: nextSide });
        return {
          item: resolvedItem,
          iconInfo: buildMarkerIconInfo(resolvedItem),
        };
      }

      // 실제 화면 좌표에서 고우선순위 마커 영역을 먼저 예약한다.
      // 핵심 승하차·출발·도착은 유지하고, 낮은 우선순위 라벨과 통과 정류장은 충돌 시 생략한다.
      function prepareMarkerItemsForRender(sortedItems) {
        var prepared = sortedItems.map(function (item) {
          var iconInfo = null;
          try {
            iconInfo = buildMarkerIconInfo(item);
          } catch (_iconError) {
            try { iconInfo = markerIcon(item); } catch (_fallbackError) {}
          }
          if (!iconInfo) return null;
          var resolved = resolveRouteLabelViewportSide(item, iconInfo);
          return { item: resolved.item, iconInfo: resolved.iconInfo };
        }).filter(function (entry) { return !!entry; });

        var retainedIds = {};
        var occupiedRects = [];
        var viewport = getRouteOverlaySize();
        prepared.slice().reverse().forEach(function (entry) {
          var item = entry.item;
          var displayType = item && item.displayType ? String(item.displayType) : "pin";
          var variant = item && item.badgeVariant ? String(item.badgeVariant) : "";
          var isRouteLabel = displayType === "routeLabel";
          var isContextLabel = isRouteLabel && variant === "context";
          var isPassStopNode = displayType === "station" && !(item && item.eventIntent);
          var markerId = item && item.id != null ? String(item.id) : "";
          if (!markerId) return;

          var rect = markerRectFromIcon(item, entry.iconInfo);
          if (!rect) {
            retainedIds[markerId] = true;
            return;
          }
          var outsideViewport = rect.right < 8 || rect.left > viewport.width - 8 ||
            rect.bottom < 8 || rect.top > viewport.height - 8;
          var collides = occupiedRects.some(function (occupied) {
            // 정류장명 라벨과 같은 정류장의 노드는 한 시각 단위다. 라벨이 먼저 예약한 영역을
            // 자기 노드의 충돌로 계산하면 노선 위 원형 정류장만 사라지므로 이 한 쌍만 제외한다.
            if (isPassStopNode && occupied.markerId === markerId + "-label") return false;
            return markerRectsOverlap(paddedMarkerRect(rect, 5), occupied.rect);
          });

          // 상세 승차·환승 문구는 행동에 필요한 핵심 정보라 근접 핀과 겹쳐도 유지한다.
          // 좌표가 화면 밖인 경우만 생략하고, 일반 노선·정류장 라벨은 충돌 시 정리한다.
          if ((isRouteLabel || isPassStopNode) && outsideViewport) return;
          if (((isRouteLabel && !isContextLabel) || isPassStopNode) && collides) return;
          retainedIds[markerId] = true;
          if (isRouteLabel || displayType === "badge" || displayType === "pin" || displayType === "station") {
            occupiedRects.push({
              markerId: markerId,
              rect: paddedMarkerRect(rect, isRouteLabel ? 5 : 4),
            });
          }
        });

        return prepared.filter(function (entry) {
          var markerId = entry.item && entry.item.id != null ? String(entry.item.id) : "";
          return !!retainedIds[markerId];
        });
      }

      // React 쪽 marker 모델(displayType / markerStyle)을 실제 Tmap Marker/SVG로 변환해 배치한다.
      function renderMarkers(markerItems, preserveCache) {
        if (!map) return;
        if (!preserveCache) latestMarkerItems = Array.isArray(markerItems) ? markerItems.slice() : [];
        var retainedMarkerIds = {};
        // zIndex 낮은 순으로 생성해 고우선순위 마커(출발/도착)가 마지막에 그려지게 한다.
        var sortedItems = Array.isArray(markerItems) ? markerItems.slice() : [];
        sortedItems.sort(function (a, b) {
          var az = Number(a && a.zIndex);
          var bz = Number(b && b.zIndex);
          if (!isFinite(az)) az = 0;
          if (!isFinite(bz)) bz = 0;
          return az - bz;
        });
        var preparedItems = prepareMarkerItemsForRender(sortedItems);
        preparedItems.forEach(function (preparedEntry) {
          var item = preparedEntry.item;
          var displayType = item && item.displayType ? String(item.displayType) : "pin";
          var isBadge = displayType === "badge";
          var isDot = displayType === "dot";
          var isStation = displayType === "station";
          var isRouteLabel = displayType === "routeLabel";
          // 아이콘 생성 실패 시 기본 pin 아이콘으로 fallback 한다.
          var iconInfo = preparedEntry.iconInfo;

          var markerOption = {
            position: toLatLng(item),
            icon: iconInfo.uri,
            iconSize: new Tmapv3.Size(iconInfo.width, iconInfo.height),
            title: item.caption || "",
            map: map,
          };
          var markerZIndex = Number(item && item.zIndex);
          if (!isFinite(markerZIndex)) markerZIndex = undefined;

          if (window.Tmapv3 && Tmapv3.Point) {
            try {
              var markerStyle = item && item.markerStyle ? String(item.markerStyle) : "default";
              var isFloatingBadge = isBadge && (markerStyle === "bus" || markerStyle === "subway" || markerStyle === "walk");
              var customAnchorX = Number(iconInfo && iconInfo.anchorX);
              var customAnchorY = Number(iconInfo && iconInfo.anchorY);
              var anchorX = isFinite(customAnchorX)
                ? customAnchorX
                : (iconInfo.width / 2);
              var anchorY = isFinite(customAnchorY)
                ? customAnchorY
                : (isDot || isStation ? (iconInfo.height / 2) : (isFloatingBadge ? iconInfo.height - 6 : iconInfo.height));
              // Vector Marker는 anchor 위치를 기준으로 offset을 더한다. 기존 이미지 내부
              // 기준점을 bottom anchor 대비 이동량으로 변환해 핀 끝이 좌표에 정확히 붙게 한다.
              markerOption.anchor = isDot || isStation ? "center" : "bottom";
              var baseAnchorX = iconInfo.width / 2;
              var baseAnchorY = markerOption.anchor === "center" ? iconInfo.height / 2 : iconInfo.height;
              markerOption.offset = new Tmapv3.Point(
                Math.round(baseAnchorX - anchorX),
                Math.round(baseAnchorY - anchorY)
              );
            } catch (_error) {}
          }

          var markerId = item && item.id != null ? String(item.id) : "";
          if (!markerId) return;
          var markerSignature = JSON.stringify({
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            icon: iconInfo.uri,
            width: iconInfo.width,
            height: iconInfo.height,
            anchorX: Number(iconInfo.anchorX),
            anchorY: Number(iconInfo.anchorY),
            title: markerOption.title,
            interactionId: item.interactionId || "",
            zIndex: markerZIndex,
          });
          var previousEntry = markers[markerId];
          if (previousEntry && previousEntry.signature === markerSignature && previousEntry.marker) {
            retainedMarkerIds[markerId] = true;
            return;
          }

          try {
            var marker = new Tmapv3.Marker({
              position: markerOption.position,
              icon: markerOption.icon,
              iconSize: markerOption.iconSize,
              title: markerOption.title,
              map: markerOption.map,
              anchor: markerOption.anchor,
              offset: markerOption.offset,
              zIndex: markerZIndex,
            });
            if (isFinite(markerZIndex) && marker && typeof marker.setZIndex === "function") {
              try {
                marker.setZIndex(markerZIndex);
              } catch (_error) {}
            }
            if (marker && item && item.interactionId) {
              var lastMarkerPressAt = 0;
              var markerPressHandler = function (eventObj) {
                var pressAt = Date.now();
                // iOS WebView는 touchend 뒤 click을 연이어 보낼 수 있어 한 번의 선택으로 합친다.
                if (pressAt - lastMarkerPressAt < 420) return;
                lastMarkerPressAt = pressAt;
                var sourceEvent = eventObj && (eventObj.originalEvent || eventObj.domEvent || eventObj.event);
                if (sourceEvent && typeof sourceEvent.stopPropagation === "function") {
                  try { sourceEvent.stopPropagation(); } catch (_error) {}
                }
                post("markerPress", {
                  id: String(item.id),
                  interactionId: String(item.interactionId),
                });
              };
              try {
                if (typeof marker.on === "function") {
                  marker.on("Click", markerPressHandler);
                }
              } catch (_error) {}
            }
            retainedMarkerIds[markerId] = true;
            markers[markerId] = {
              marker: marker,
              signature: markerSignature,
            };
            var previousMarker = previousEntry && previousEntry.marker ? previousEntry.marker : previousEntry;
            if (previousMarker && previousMarker !== marker && previousMarker.setMap) {
              setTimeout(function () {
                try { previousMarker.setMap(null); } catch (_removeError) {}
              }, 0);
            }
          } catch (_markerError) {
            // 새 아이콘 생성이 실패하면 직전 마커를 유지해 줌 동작 중 깜빡임을 피한다.
            if (previousEntry) retainedMarkerIds[markerId] = true;
          }
        });

        Object.keys(markers).forEach(function (markerId) {
          if (retainedMarkerIds[markerId]) return;
          var entry = markers[markerId];
          var marker = entry && entry.marker ? entry.marker : entry;
          if (marker && marker.setMap) {
            try { marker.setMap(null); } catch (_removeError) {}
          }
          delete markers[markerId];
        });
      }

`;
}
