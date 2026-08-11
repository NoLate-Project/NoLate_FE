import type { TmapWebHtmlContext } from './tmapWebHtmlContext';

/** TMAP WebView 문서의 ProjectionAndSvg 영역을 생성합니다. */
export function buildTmapWebHtmlProjectionAndSvg(
  _context: TmapWebHtmlContext,
): string {
  return `      function buildLinearSvgPath(points) {
        if (!Array.isArray(points) || points.length < 2) return "";
        var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
        for (var i = 1; i < points.length; i += 1) {
          path += " L" + points[i].x.toFixed(1) + " " + points[i].y.toFixed(1);
        }
        return path;
      }

      function buildRoundedSvgPath(points, radius) {
        if (!Array.isArray(points) || points.length < 3 || !isFinite(radius) || radius <= 0) {
          return buildLinearSvgPath(points);
        }
        var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
        for (var i = 1; i < points.length - 1; i += 1) {
          var previous = points[i - 1];
          var current = points[i];
          var next = points[i + 1];
          var prevLength = pointDistance(previous, current);
          var nextLength = pointDistance(current, next);
          if (prevLength < 5 || nextLength < 5) {
            path += " L" + current.x.toFixed(1) + " " + current.y.toFixed(1);
            continue;
          }
          var cornerRadius = Math.min(radius, prevLength * 0.42, nextLength * 0.42);
          var prevRatio = cornerRadius / prevLength;
          var nextRatio = cornerRadius / nextLength;
          var before = {
            x: current.x + ((previous.x - current.x) * prevRatio),
            y: current.y + ((previous.y - current.y) * prevRatio),
          };
          var after = {
            x: current.x + ((next.x - current.x) * nextRatio),
            y: current.y + ((next.y - current.y) * nextRatio),
          };
          path += " L" + before.x.toFixed(1) + " " + before.y.toFixed(1);
          path += " Q" + current.x.toFixed(1) + " " + current.y.toFixed(1) + " " + after.x.toFixed(1) + " " + after.y.toFixed(1);
        }
        var last = points[points.length - 1];
        path += " L" + last.x.toFixed(1) + " " + last.y.toFixed(1);
        return path;
      }

      function buildSmoothedSvgPath(points) {
        if (!Array.isArray(points) || points.length < 3) return buildLinearSvgPath(points);
        var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
        for (var i = 1; i < points.length - 1; i += 1) {
          var current = points[i];
          var next = points[i + 1];
          var midX = (current.x + next.x) / 2;
          var midY = (current.y + next.y) / 2;
          path += " Q" + current.x.toFixed(1) + " " + current.y.toFixed(1) + " " + midX.toFixed(1) + " " + midY.toFixed(1);
        }
        var last = points[points.length - 1];
        path += " L" + last.x.toFixed(1) + " " + last.y.toFixed(1);
        return path;
      }

      function buildRouteSvgPath(points, item) {
        if (item && item.smoothPath === true && Array.isArray(points) && points.length >= 4) {
          var smoothRadius = Number(item && item.cornerRadiusPx);
          if (!isFinite(smoothRadius) || smoothRadius <= 0) smoothRadius = 6;
          return buildRoundedSvgPath(points, smoothRadius * 0.72);
        }
        return buildRoundedSvgPath(points, Number(item && item.cornerRadiusPx) || 0);
      }

      function isArrowNearSharpCorner(points, cx, cy, avoidRadius) {
        if (!Array.isArray(points) || points.length < 3) return false;
        var radius = isFinite(avoidRadius) ? Math.max(12, avoidRadius) : 24;
        for (var i = 1; i < points.length - 1; i += 1) {
          var previous = points[i - 1];
          var current = points[i];
          var next = points[i + 1];
          var prevLength = pointDistance(previous, current);
          var nextLength = pointDistance(current, next);
          if (!isFinite(prevLength) || !isFinite(nextLength) || prevLength < 8 || nextLength < 8) continue;
          var incomingX = (current.x - previous.x) / prevLength;
          var incomingY = (current.y - previous.y) / prevLength;
          var outgoingX = (next.x - current.x) / nextLength;
          var outgoingY = (next.y - current.y) / nextLength;
          var dot = Math.max(-1, Math.min(1, (incomingX * outgoingX) + (incomingY * outgoingY)));
          var turnDegrees = Math.acos(dot) * 180 / Math.PI;
          if (!isFinite(turnDegrees) || turnDegrees < 28) continue;
          var cornerDistance = pointDistance({ x: cx, y: cy }, current);
          if (cornerDistance <= radius) return true;
        }
        return false;
      }

      function appendDirectionalArrows(svgParts, points, item) {
        if (!item || !item.showDirection || !Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.directionSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 24;
        var size = Number(item.directionSizePx);
        if (!isFinite(size) || size <= 0) size = 7;
        var arrowColor = item.directionColor ? String(item.directionColor) : "rgba(255,255,255,0.84)";
        var arrowOpacity = Number(item.directionOpacity);
        if (!isFinite(arrowOpacity)) arrowOpacity = 0.86;

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < spacing * 1.05) return;

        var requestedInset = Number(item.directionInsetPx);
        var inset = isFinite(requestedInset) && requestedInset > 0
          ? Math.min(requestedInset, total * 0.24)
          : Math.min(spacing * 0.72, total * 0.18);
        var endLimit = total - inset;
        var nextDistance = inset + (spacing * 0.48);
        var traveled = 0;
        var drawn = 0;
        var requestedMaxArrows = Number(item.directionMaxCount);
        var defaultMaxArrows = Math.max(1, Math.floor((endLimit - inset) / Math.max(8, spacing)) + 1);
        var maxArrows = Math.min(
          isFinite(requestedMaxArrows) && requestedMaxArrows > 0 ? requestedMaxArrows : 120,
          defaultMaxArrows
        );

        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxArrows; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 5) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }

          var ux = (to.x - from.x) / segmentDistance;
          var uy = (to.y - from.y) / segmentDistance;
          var nx = -uy;
          var ny = ux;

          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxArrows) {
	            var ratio = (nextDistance - traveled) / segmentDistance;
	            var cx = from.x + ((to.x - from.x) * ratio);
	            var cy = from.y + ((to.y - from.y) * ratio);
		            if (!isScreenPointNearViewport({ x: cx, y: cy }, Math.max(spacing * 1.4, size * 2.2))) {
		              nextDistance += spacing;
		              continue;
		            }
		            if (isArrowNearSharpCorner(points, cx, cy, Math.max(size * 2.8, spacing * 0.22))) {
		              nextDistance += spacing;
		              continue;
		            }
			            var tipX = cx + (ux * size * 0.38);
			            var tipY = cy + (uy * size * 0.38);
			            var tailX = cx - (ux * size * 0.30);
			            var tailY = cy - (uy * size * 0.30);
			            var halfWidth = size * 0.24;
		            var leftX = tailX + (nx * halfWidth);
		            var leftY = tailY + (ny * halfWidth);
		            var rightX = tailX - (nx * halfWidth);
		            var rightY = tailY - (ny * halfWidth);
		            svgParts.push(
		              '<path d="M' + leftX.toFixed(1) + ' ' + leftY.toFixed(1) +
		              ' L' + tipX.toFixed(1) + ' ' + tipY.toFixed(1) +
		              ' L' + rightX.toFixed(1) + ' ' + rightY.toFixed(1) +
		              ' Z" fill="' + escapeXml(arrowColor) +
		              '" stroke="none" opacity="' + arrowOpacity.toFixed(2) + '" />'
		            );
            drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
      }

      function findPointAtDistance(points, targetDistance) {
        if (!Array.isArray(points) || points.length < 2) return null;
        var traveled = 0;
        for (var i = 1; i < points.length; i += 1) {
          var from = points[i - 1];
          var to = points[i];
          var distance = pointDistance(from, to);
          if (!isFinite(distance) || distance < 0.5) continue;
          if (traveled + distance >= targetDistance) {
            var ratio = (targetDistance - traveled) / distance;
            return {
              x: from.x + ((to.x - from.x) * ratio),
              y: from.y + ((to.y - from.y) * ratio),
              ux: (to.x - from.x) / distance,
              uy: (to.y - from.y) / distance,
            };
          }
          traveled += distance;
        }
        var last = points[points.length - 1];
        var beforeLast = points[points.length - 2];
        var lastDistance = Math.max(1, pointDistance(beforeLast, last));
        return {
          x: last.x,
          y: last.y,
          ux: (last.x - beforeLast.x) / lastDistance,
          uy: (last.y - beforeLast.y) / lastDistance,
        };
      }

      function estimateSvgTextWidth(text) {
        var value = String(text || "");
        var width = 0;
        for (var i = 0; i < value.length; i += 1) {
          var ch = value.charAt(i);
          var code = value.charCodeAt(i);
          if (/[0-9]/.test(ch)) width += 7;
          else if (/[A-Za-z]/.test(ch)) width += 7;
          else if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)) width += 12;
          else width += 8;
        }
        return Math.max(18, width);
      }

      function appendLineLabel(svgParts, points, item, totalDistance) {
        var label = item && item.lineLabel ? String(item.lineLabel).trim() : "";
        if (!label || !Array.isArray(points) || points.length < 2 || !isFinite(totalDistance) || totalDistance < 48) return;
        var anchorDistance = totalDistance < 180
          ? totalDistance * 0.5
          : Math.min(totalDistance * 0.18, 72);
        var anchor = findPointAtDistance(points, anchorDistance);
        if (!anchor) return;
        var offset = Number(item.lineLabelOffsetPx);
        if (!isFinite(offset)) offset = 12;
        var nx = -anchor.uy;
        var ny = anchor.ux;
        var cx = anchor.x + (nx * offset);
        var cy = anchor.y + (ny * offset);
        var displayLabel = label.length <= 7 ? (label + " ›") : label;
        var width = Math.min(68, Math.max(38, estimateSvgTextWidth(displayLabel) + 15));
        var height = 19;
        var x = cx - (width / 2);
        var y = cy - (height / 2);
        var bg = item.lineLabelBackgroundColor ? String(item.lineLabelBackgroundColor) : (item.color || "#2F80FF");
        var textColor = item.lineLabelTextColor ? String(item.lineLabelTextColor) : "#FFFFFF";
        svgParts.push(
          '<g opacity="0.96">' +
            '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + width.toFixed(1) + '" height="' + height + '" rx="5" fill="' + escapeXml(bg) + '" stroke="rgba(255,255,255,0.52)" stroke-width="0.55" />' +
            '<text x="' + cx.toFixed(1) + '" y="' + (cy + 3.7).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-family="Arial, sans-serif" font-weight="800" fill="' + escapeXml(textColor) + '">' + escapeXml(displayLabel) + '</text>' +
          '</g>'
        );
      }

      function appendDotPath(svgParts, points, item) {
        if (!Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.dotSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 14;
        var dotSize = Number(item.dotSizePx);
        if (!isFinite(dotSize) || dotSize <= 0) dotSize = 6;
        var dotColor = item.dotColor ? String(item.dotColor) : (item.color || "#2F7BFF");
        var dotOutlineColor = item.dotOutlineColor ? String(item.dotOutlineColor) : "rgba(235,244,255,0.94)";
        var dotOutlineWidth = Number(item.dotOutlineWidth);
        if (!isFinite(dotOutlineWidth)) dotOutlineWidth = Math.max(0.8, dotSize * 0.16);
        var supportLineWidth = Number(item.supportLineWidth);
        var supportLineColor = item.supportLineColor ? String(item.supportLineColor) : "rgba(47,123,255,0.18)";
        if (isFinite(supportLineWidth) && supportLineWidth > 0) {
          svgParts.push(
            '<path d="' + buildRouteSvgPath(points, item) +
            '" fill="none" stroke="' + escapeXml(supportLineColor) +
            '" stroke-width="' + supportLineWidth.toFixed(1) +
            '" stroke-linecap="round" stroke-linejoin="round" />'
          );
        }

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < 6) return;

        function appendDotCircle(point) {
          svgParts.push(
            '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + dotRadius.toFixed(1) + '" fill="' + escapeXml(dotColor) + '" stroke="' + escapeXml(dotOutlineColor) + '" stroke-width="' + Math.max(0, dotOutlineWidth).toFixed(1) + '" />'
          );
        }

        var nextDistance = Math.min(spacing * 0.82, total * 0.28);
        var endLimit = Math.max(nextDistance, total - Math.min(spacing * 0.24, total * 0.12));
        var traveled = 0;
        var dotRadius = dotSize / 2;
        var maxDots = Math.min(600, Math.max(2, Math.floor(total / Math.max(5, spacing)) + 1));
        var drawn = 0;
        appendDotCircle(points[0]);
        drawn += 1;
        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxDots; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 1) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }
          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxDots) {
            var ratio = (nextDistance - traveled) / segmentDistance;
            var cx = from.x + ((to.x - from.x) * ratio);
            var cy = from.y + ((to.y - from.y) * ratio);
            appendDotCircle({ x: cx, y: cy });
            drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
        if (drawn < maxDots && pointDistance(points[0], points[points.length - 1]) > spacing * 0.42) {
          appendDotCircle(points[points.length - 1]);
        }
      }

      function totalScreenDistance(points) {
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          total += pointDistance(points[i - 1], points[i]);
        }
        return total;
      }

      function prepareRouteCanvas(canvas, size) {
        if (!canvas || !canvas.getContext) return null;
        var dpr = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
        var pixelWidth = Math.max(1, Math.round(size.width * dpr));
        var pixelHeight = Math.max(1, Math.round(size.height * dpr));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        canvas.style.width = size.width + "px";
        canvas.style.height = size.height + "px";
        routeOverlayDpr = dpr;
        var ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        return ctx;
      }

      function traceCanvasRoutePath(ctx, points, item) {
        if (!ctx || !Array.isArray(points) || points.length < 2) return;
        var radius = Number(item && item.cornerRadiusPx);
        if (!isFinite(radius) || radius <= 0) radius = 0;
        if (item && item.smoothPath === true && points.length >= 4) radius *= 0.72;

        ctx.moveTo(points[0].x, points[0].y);
        if (points.length < 3 || radius <= 0) {
          for (var i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          return;
        }

        for (var pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
          var previous = points[pointIndex - 1];
          var current = points[pointIndex];
          var next = points[pointIndex + 1];
          var prevLength = pointDistance(previous, current);
          var nextLength = pointDistance(current, next);
          if (prevLength < 5 || nextLength < 5) {
            ctx.lineTo(current.x, current.y);
            continue;
          }
          var cornerRadius = Math.min(radius, prevLength * 0.42, nextLength * 0.42);
          var prevRatio = cornerRadius / prevLength;
          var nextRatio = cornerRadius / nextLength;
          var before = {
            x: current.x + ((previous.x - current.x) * prevRatio),
            y: current.y + ((previous.y - current.y) * prevRatio),
          };
          var after = {
            x: current.x + ((next.x - current.x) * nextRatio),
            y: current.y + ((next.y - current.y) * nextRatio),
          };
          ctx.lineTo(before.x, before.y);
          ctx.quadraticCurveTo(current.x, current.y, after.x, after.y);
        }

        var last = points[points.length - 1];
        ctx.lineTo(last.x, last.y);
      }

      function strokeCanvasRoutePath(ctx, points, item, color, width, alpha) {
        if (!ctx || !Array.isArray(points) || points.length < 2 || !isFinite(width) || width <= 0) return;
        ctx.save();
        ctx.globalAlpha = isFinite(alpha) ? alpha : 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        traceCanvasRoutePath(ctx, points, item);
        ctx.stroke();
        ctx.restore();
      }

      function drawCanvasDirectionalArrows(ctx, points, item) {
        if (!ctx || !item || !item.showDirection || !Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.directionSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 24;
        var size = Number(item.directionSizePx);
        if (!isFinite(size) || size <= 0) size = 6;
        var arrowColor = item.directionColor ? String(item.directionColor) : "rgba(255,255,255,0.86)";
        var arrowOpacity = Number(item.directionOpacity);
        if (!isFinite(arrowOpacity)) arrowOpacity = 0.88;

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < spacing * 1.05) return;

        var requestedInset = Number(item.directionInsetPx);
        var inset = isFinite(requestedInset) && requestedInset > 0
          ? Math.min(requestedInset, total * 0.24)
          : Math.min(spacing * 0.7, total * 0.18);
        var endLimit = total - inset;
        var nextDistance = inset + (spacing * 0.48);
        var traveled = 0;
        var drawn = 0;
        var requestedMaxArrows = Number(item.directionMaxCount);
        var defaultMaxArrows = Math.max(1, Math.floor((endLimit - inset) / Math.max(8, spacing)) + 1);
        var maxArrows = Math.min(
          isFinite(requestedMaxArrows) && requestedMaxArrows > 0 ? requestedMaxArrows : 120,
          defaultMaxArrows
        );

        ctx.save();
        ctx.fillStyle = arrowColor;
        ctx.globalAlpha = arrowOpacity;
        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxArrows; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 5) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }

          var ux = (to.x - from.x) / segmentDistance;
          var uy = (to.y - from.y) / segmentDistance;
          var nx = -uy;
          var ny = ux;

          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxArrows) {
	            var ratio = (nextDistance - traveled) / segmentDistance;
	            var cx = from.x + ((to.x - from.x) * ratio);
	            var cy = from.y + ((to.y - from.y) * ratio);
		            if (!isScreenPointNearViewport({ x: cx, y: cy }, Math.max(spacing * 1.4, size * 2.2))) {
		              nextDistance += spacing;
		              continue;
		            }
		            if (isArrowNearSharpCorner(points, cx, cy, Math.max(size * 2.8, spacing * 0.22))) {
		              nextDistance += spacing;
		              continue;
		            }
				            var tipX = cx + (ux * size * 0.38);
				            var tipY = cy + (uy * size * 0.38);
				            var tailX = cx - (ux * size * 0.30);
				            var tailY = cy - (uy * size * 0.30);
				            var halfWidth = size * 0.24;
            ctx.beginPath();
			            ctx.moveTo(tailX + (nx * halfWidth), tailY + (ny * halfWidth));
            ctx.lineTo(tipX, tipY);
			            ctx.lineTo(tailX - (nx * halfWidth), tailY - (ny * halfWidth));
			            ctx.closePath();
			            ctx.fill();
            drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
        ctx.restore();
      }

      function drawCanvasRoundedRect(ctx, x, y, width, height, radius) {
        var r = Math.max(0, Math.min(radius, width / 2, height / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }

      function drawCanvasLineLabel(ctx, points, item, totalDistance) {
        var label = item && item.lineLabel ? String(item.lineLabel).trim() : "";
        if (!ctx || !label || !Array.isArray(points) || points.length < 2 || !isFinite(totalDistance) || totalDistance < 48) return;
        var anchorDistance = totalDistance < 180 ? totalDistance * 0.5 : Math.min(totalDistance * 0.18, 72);
        var anchor = findPointAtDistance(points, anchorDistance);
        if (!anchor) return;
        var offset = Number(item.lineLabelOffsetPx);
        if (!isFinite(offset)) offset = 12;
        var nx = -anchor.uy;
        var ny = anchor.ux;
        var cx = anchor.x + (nx * offset);
        var cy = anchor.y + (ny * offset);
        var displayLabel = label.length <= 7 ? (label + " ›") : label;
        var width = Math.min(68, Math.max(38, estimateSvgTextWidth(displayLabel) + 15));
        var height = 19;
        var x = cx - (width / 2);
        var y = cy - (height / 2);
        var bg = item.lineLabelBackgroundColor ? String(item.lineLabelBackgroundColor) : (item.color || "#2F80FF");
        var textColor = item.lineLabelTextColor ? String(item.lineLabelTextColor) : "#FFFFFF";

        ctx.save();
        ctx.globalAlpha = 0.96;
        drawCanvasRoundedRect(ctx, x, y, width, height, 5);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = 0.55;
        ctx.strokeStyle = "rgba(255,255,255,0.52)";
        ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.font = "800 10.5px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayLabel, cx, cy + 0.5);
        ctx.restore();
      }

      function drawCanvasDotPath(ctx, points, item) {
        if (!ctx || !Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.dotSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 14;
        var dotSize = Number(item.dotSizePx);
        if (!isFinite(dotSize) || dotSize <= 0) dotSize = 6;
        var dotRadius = dotSize / 2;
        var dotColor = item.dotColor ? String(item.dotColor) : (item.color || "#2F7BFF");
        var dotOutlineColor = item.dotOutlineColor ? String(item.dotOutlineColor) : "rgba(235,244,255,0.94)";
        var dotOutlineWidth = Number(item.dotOutlineWidth);
        if (!isFinite(dotOutlineWidth)) dotOutlineWidth = Math.max(0.8, dotSize * 0.16);
        var supportLineWidth = Number(item.supportLineWidth);
        var supportLineColor = item.supportLineColor ? String(item.supportLineColor) : "rgba(47,123,255,0.18)";
        if (isFinite(supportLineWidth) && supportLineWidth > 0) {
          strokeCanvasRoutePath(ctx, points, item, supportLineColor, supportLineWidth, 1);
        }

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < 6) return;

        function drawDot(point) {
          // 긴 경로가 화면 밖에서 시작해도 dot 제한을 소진하지 않게 보이는 점만 센다.
          if (!isScreenPointNearViewport(point, Math.max(spacing * 1.3, dotSize * 2.2))) return false;
          ctx.beginPath();
          ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
          if (dotOutlineWidth > 0 && dotOutlineColor !== "transparent") {
            ctx.lineWidth = dotOutlineWidth;
            ctx.strokeStyle = dotOutlineColor;
            ctx.stroke();
          }
          return true;
        }

        ctx.save();
        var nextDistance = Math.min(spacing * 0.82, total * 0.28);
        var endLimit = Math.max(nextDistance, total - Math.min(spacing * 0.24, total * 0.12));
        var traveled = 0;
        var maxDots = Math.min(600, Math.max(2, Math.floor(total / Math.max(5, spacing)) + 1));
        var drawn = 0;
        if (drawDot(points[0])) drawn += 1;
        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxDots; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 1) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }
          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxDots) {
            var ratio = (nextDistance - traveled) / segmentDistance;
            if (drawDot({
              x: from.x + ((to.x - from.x) * ratio),
              y: from.y + ((to.y - from.y) * ratio),
            })) drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
        if (drawn < maxDots && pointDistance(points[0], points[points.length - 1]) > spacing * 0.42) {
          drawDot(points[points.length - 1]);
        }
        ctx.restore();
      }

      function renderScreenRouteOverlaysNow() {
        screenRouteFrame = null;
        screenRouteRenderDelay = null;
        var overlayEl = document.getElementById("routeOverlay");
        if (!overlayEl) return;
        var items = Array.isArray(screenRouteOverlays) ? screenRouteOverlays : [];
        var size = getRouteOverlaySize();
        var ctx = prepareRouteCanvas(overlayEl, size);
        if (!ctx) return;
        if (isRouteOverlayMoving) {
          return;
        }
        if (!items.length) {
          return;
        }

        var sorted = items.slice().sort(function (a, b) {
          var az = Number(a && a.zIndex);
          var bz = Number(b && b.zIndex);
          if (!isFinite(az)) az = 0;
          if (!isFinite(bz)) bz = 0;
          return az - bz;
        });

        sorted.forEach(function (item) {
          var points = cleanScreenPoints(item.coords);
          if (points.length < 2) return;
          var totalDistance = totalScreenDistance(points);
          var shape = item.shape ? String(item.shape) : "solid";
          if (shape === "dot") {
            drawCanvasDotPath(ctx, points, item);
            return;
          }

          var strokeColor = item.color ? String(item.color) : "#1D72FF";
          var width = Number(item.width);
          if (!isFinite(width) || width <= 0) width = 8;
          var outlineWidth = Number(item.outlineWidth);
          if (!isFinite(outlineWidth)) outlineWidth = 0;
          var shouldDrawLine = item.drawLine !== false;
          if (shouldDrawLine && outlineWidth > 0) {
            var outlineColor = item.outlineColor ? String(item.outlineColor) : "rgba(255,255,255,0.5)";
            strokeCanvasRoutePath(ctx, points, item, outlineColor, width + (outlineWidth * 2), 1);
          }
          if (shouldDrawLine) {
            strokeCanvasRoutePath(ctx, points, item, strokeColor, width, 1);
          }
          // 방향 화살표는 screen Canvas에서 그리지 않고 TMAP Polyline direction이 전담한다.
          drawCanvasLineLabel(ctx, points, item, totalDistance);
        });
      }

      function scheduleScreenRouteOverlayRender(delayMs) {
        if (screenRouteRenderDelay !== null) {
          clearTimeout(screenRouteRenderDelay);
          screenRouteRenderDelay = null;
        }
        if (screenRouteFrame !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(screenRouteFrame);
        }
        var delay = Number(delayMs);
        if (isFinite(delay) && delay > 0) {
          screenRouteRenderDelay = setTimeout(function () {
            screenRouteRenderDelay = null;
            scheduleScreenRouteOverlayRender();
          }, delay);
          return;
        }
        if (typeof requestAnimationFrame === "function") {
          screenRouteFrame = requestAnimationFrame(renderScreenRouteOverlaysNow);
          return;
        }
        screenRouteFrame = null;
        setTimeout(renderScreenRouteOverlaysNow, 0);
      }

      function setRouteOverlayMoving(active) {
        var overlayEl = document.getElementById("routeOverlay");
        isRouteOverlayMoving = active === true;
        if (overlayEl && overlayEl.classList) {
          if (isRouteOverlayMoving) overlayEl.classList.add("route-overlay-moving");
          else overlayEl.classList.remove("route-overlay-moving");
        }
        var signature = [
          isRouteOverlayMoving ? "moving" : "idle",
          routeOverlayProjectionVersion,
        ].join(":");
        if (signature === lastRouteOverlayStateSignature) return;
        lastRouteOverlayStateSignature = signature;
        post("routeOverlayState", {
          isCameraMoving: isRouteOverlayMoving,
          projectionVersion: routeOverlayProjectionVersion,
          arrowRenderer: screenRouteOverlays.length > 0 ? "screen-overlay-idle-only" : "none",
          visible: !isRouteOverlayMoving,
        });
      }

      function markRouteOverlayMoving() {
        if (routeOverlayIdleTimer !== null) {
          clearTimeout(routeOverlayIdleTimer);
          routeOverlayIdleTimer = null;
        }
        isMapIdle = false;
        setRouteOverlayMoving(true);
        reportMapLayout("CAMERA_MOVING");
      }

      function markRouteOverlayIdleSoon(delayMs) {
        if (routeOverlayIdleTimer !== null) {
          clearTimeout(routeOverlayIdleTimer);
        }
        var delay = Number(delayMs);
        routeOverlayIdleTimer = setTimeout(function () {
          routeOverlayIdleTimer = null;
          routeOverlayProjectionVersion += 1;
          isMapIdle = true;
          setRouteOverlayMoving(false);
          scheduleScreenRouteOverlayRender();
          reportMapLayout("CAMERA_IDLE");
        }, isFinite(delay) ? Math.max(80, delay) : 160);
      }

      function setScreenRouteOverlays(items) {
        screenRouteOverlays = Array.isArray(items) ? items.slice() : [];
        scheduleScreenRouteOverlayRender();
        if (!isRouteOverlayMoving) {
          markRouteOverlayIdleSoon(90);
        }
      }

`;
}
