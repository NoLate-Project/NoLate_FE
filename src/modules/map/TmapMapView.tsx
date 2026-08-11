import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { getEnv } from '../../api/env';
import styles from './TmapMapView.styles';
import TmapNativeMapView, {
  isNativeTMapViewAvailable,
} from './TmapNativeMapView';
import {
  expandNativeDashPathOverlays,
  type NativeDashViewport,
} from './nativeDashPathPresentation';
import {
  addNativeDirectionScreenFallbacks,
  enqueueTmapCommand,
  getTmapVectorScriptUrl,
  isDuplicateTmapMapSelection,
  isValidWgs84Coordinate,
  MAP_INITIALIZATION_TIMEOUT_MS,
  MAP_LOAD_ERROR_MESSAGE,
  safeNumber,
  TMAP_MAP_SELECTION_EVENTS,
  TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX,
  TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT,
  TMAP_NATIVE_DIRECTION_REPORT_SCRIPT,
  TMAP_NATIVE_STROKE_COLOR_SCRIPT,
  TMAP_VECTOR_JS_SCRIPT_VERSION,
  WebView,
  type TmapMapSelectionSample,
  type TmapMapViewHandle,
  type TmapMapViewProps,
} from './tmapMapViewCore';
import { buildTmapWebHtml } from './tmapWebHtml';

export {
  addNativeDirectionScreenFallbacks,
  enqueueTmapCommand,
  getTmapVectorMapType,
  getTmapVectorScriptUrl,
  isDuplicateTmapMapSelection,
  isValidWgs84Coordinate,
  readTmapNativeDirectionCapability,
  TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES,
  TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS,
  TMAP_MAP_SELECTION_EVENTS,
  TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX,
  TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT,
  TMAP_NATIVE_DIRECTION_REPORT_SCRIPT,
  TMAP_NATIVE_STROKE_COLOR_SCRIPT,
  TMAP_VECTOR_JS_NAMESPACE,
  TMAP_VECTOR_JS_SCRIPT_VERSION,
} from './tmapMapViewCore';
export type {
  TmapCameraState,
  TmapLatLng,
  TmapMapLayoutReport,
  TmapMapSelectionSample,
  TmapMapViewHandle,
  TmapMapViewProps,
  TmapMarker,
  TmapNativeDirectionCapability,
  TmapPathOverlay,
} from './tmapMapViewCore';

const DEFAULT_FALLBACK_BACKGROUND = '#E5E7EB';
const DEFAULT_FALLBACK_TEXT = '#6B7280';
const TMAP_WEBVIEW_HTML_VERSION = 'route-vector-v45-tmap-native-direction';
// WebView 내부 SVG <image>에서 안정적으로 렌더되도록 아이콘을 data URI로 고정한다.
const BUS_BADGE_GLYPH_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAMAAADDpiTIAAAAA3NCSVQICAjb4U/gAAAACXBIWXMAAJv3AACb9wGlhj2oAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAAwBQTFRF////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACyO34QAAAP90Uk5TAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+6wjZNQAAE1pJREFUeNrtnQtwVdW5gFeSQx6QhEdCSE5AghUhvIwUTABBBKUCQrAqPqDVCldBW2tVBNSptLeW6nXaYltaqdXeojCO0gYIWAERBAIFawHBRJB3EiDhEQiPvE/Do06HMXD2e629vi/DwDBn7b3X/3/nX//e2WefCOE3ohPP0zIxISYqEAg0/Seqrqb6q5//+udXP5UVFXXC70Qofvwx51J9MeMXiLVz85UVxy/8XPjrNALIQGTbYDA9GAymtUpMjHZ1z7X/MeGcEkcO1iCAm7Q5n/VGUgNyHFCorKS4uLjxT8lpBHCMhItZDwZj5D3IigsiFJccRwDbSM7smtn1G8F4pcJ5pvhiUSgLIYDpJb5j13O5T1Z6aa3dX9hIUQUCGCG2c2Zj6q+N80+PfbBRgsLCUgS4YoN3/k3fKdKf59onis6Vgz31CPA1RPXMvj6za4rwP9U7zmmwowoBvqJDdnb2N5sLrWjYW1j46br92guQ0Kcx+WlCV0oKCgr+VaurAImDhg7pESl05+ymgoL1R3QTILb/0CF9AgIusmNdQUFhSBMBAn2GDukfS9Iv5fiGgnUbT/tdgIQRdwxPJNlNUb+loMCT1tAdAVJG3zE0hixfsTX8+5Llp/wnQKcxdwyg5QuTmtX5+bv9JEDaA/dkkVZjFOXnr6vzhQCB2ycMjyKhJqj4+ztLa1QXoMuE77YjlebPDd59e01IXQFajJ0wgCRaZP+8t7arKUDSEz9oSf7sYMtb80uUE6DdU5PjSZ1tVwgWzVqtlADpUx6OI232loFZ86tUESBj6ve44mM/5XNml6ogQMyz06LJliPUvverTdILcNNrXciUcyx4dof9G7XxGm3r1z8i/05y5/bZ9l9Yse9C3b1LBkaQJEeJ7Dsp5hObLxDalbPEt0aRIDco+8mcOgkFyMjvTm5cYtO4ndItAf1WZpAYt0h/qPxTyZrA+z9qS17co8WcvGSpBJjxNtd+3CX3s+ESLQEvzCAjbhM/rtlKWQTI/T1nfx4wqNUHcgiQuZT67wk5Ke/LIECrlWnkwhv6pi8JeS5A5IJsMuEVvTstDnktwINPkwfvuK7B+q0i1hq4ZjsySIOH1OZYviRk7TrABPLvKc3+33IHbmkJiHmPT/t5S0r0Ci8rwKT2pMBjnu7vYQ/QfDcf/PCcnd1rPasA95B/7+k83rsKsOZGO2cydYcmKUv/ra2b+6Jbg1fuhWwlR5f3bFd74xa606sl4HvUXymY5pEAUd8l9lLQ5xZvBBiWTuzlYLo3ArACyMKQG7wQIDGXyMvCRC8EuJUPAUrDXdEeCDCCuEtD69vcFyBiOHGXh/vdFyCLO8EkYlS86wKwAshE8zEIwBrgqgBtuBdUKm5NdlmAb/EAUKkI3OW2AMRcLka4LABPAZWMwQFXBWh3DSGXi4QcVwXoT8SlawNdFYAVAAFALm5o6aIAsb0JuGxE3eyiAH34VbBv1gBTArACIADIRueO7gnQj3BLyEDXBEhPJtoSku2aAD0ItpQnggigN1kxCKA10VkIwBrghgAR3Yi1f7pAEwJ0ak6sta4ArACS0rkNAuhNXxNjAtIIMChVkzQ597H67A9UFuAl3sFeVADjD4kKnOaXwZKyL8ONHuBa8i8rHRPcEIAeUF66uyEAXxCouQBUAHnpgQBUAKfPAmJP8blQaTkYdL4CZJJ/eUlr47wArAD+WgMQQPMuEAGoAFwG0LkCGD0LSDhJlCWmPMXpCsCTIaSmbQunBbiKIEtNBgIgAAIgAALoSiejA4zeEmb4M8g/KiIrJrn6dy5UgIDTFWDDBjJpkiwJl4DoVPKidQ/QPoIYS01SgrMCdCTEPisBBgXgJAABAAHAPxcC6AGoAFQABAibDkRYawGSeTiI7LRu6aQArAC+KwHGBKAH1FwAKgACgL8uBCAAFYAeAAGoAAgQDjEpxFd6WrZ2ToAO3A7iuxJgSABaAM0FoAXwnwDh3xWclp09mugqwJO9t2zdesjmjfb6/f6QOXLIiFmyQubZ+zMbP8YbPW6t+SNBAE8EaGTtBJue6Tpin5XDQACvBAiFim6xoQlsO28JvZ+idFn+TrpVAe4ovI9AqsvYotutCfDwe0lEUWXi8yZaEWD6a5HEUG2i/viC+cEzQ9ahCfSuCbzIL8xWgPumkQQ/MPVOcwJcO4fY+YM3rzUjQNy78YTOHyQsaG5CgP/tReT8Qo/njQuQ9hhx8w+PpxgWYGosYfMPLaYbFSDtEaLmJya3NyjA4xQAXxHzfYMC5BIzfzHKmACdMgmZv+iWYUiAEUTMb4xEAL0ZYUiALALmN7obESCSjwD5jrQIAwIkBwiY34hOMiBAGvHyH0EDAvBMcD+uAQYEiCNc/iPOyFkA6AICIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIABIJECIwPiPkAEBKgmX/zhpQIBywuU/ygwIUEa4/MdhAwIcoQnwHfVHDQhQ/wUB8xs7jTSB4mMC5jdWCwTQmlUIgADhC3AAA3zG+kOGBBCzCZm/mCWMCfDXg8TMTxQvMChA7W8Imp+YXWdQAPHLL4maf9jT1ArQtADVjxM2/zDpjGEBxPsLiJtfmLtMGBdATOR6sE/48glhRoCKUceJnR84MvyYKQHEzruqiZ76nB19uX7+svcErvxWBfFTnZNj1guzAojVA4uJoNrsylkmzAsgtuUsJ4Yqs+KGQmFFAFEybALLgLIcfmDYMetbCb5eHTJPDmkwS1bIGtW/SrTpSNJfqUQA1QTYPS3FxmN5FAEUE+ChiPB2EuZHwwKkQzG2hBBAa6IEAmhNwF4BmhFRKgAgAOgqAEuA5j0AFYAlAFgCgAoA9ADAEgAsAYAAwBIANIHAEgAsAUAFAHoAYAkAlgBAAPBZD8ASQAUABADOAoDrAMASACwBQAUAegBgCQANBIjgO6b1FoAVQPMegBWACgAIANoKwBKgeQ9ABfBtBQg4LUDnKpJhki7yCGBhCfgLiaQJBHoA4CwAWAIAAUDFHoAlgAoACACcBQDXAYAlAFgCgAoA9ADAEgA6CMDHAjQXoIGA6t0DhAgoFQA0FoAKQAUAKgAoRIgKgAAIgAAsAQhABUAAKgACUAEQgAqAAFQABEAABGAJQAAqAAJQARCACoAAVAAEoAIgAAIgAEsAAlABEIAK4BcaqABUACoAAlABEAABEIAlAAGoAAhABUAAKgACUAEQgAqAAFQABKACIAACIABLAAJQARCACoAAVAAEoAIgABUAARDAF9h7TyBLABUAaAKBCgBUAKACAAIASwBQAYAKADoIUE9AVcPeS8HVBNSvhCkAa4DeS4CoIaJ6C1BFRPUWgCbArwIE5KkAZ0rLk4LxPs/L2dKy1ukJ6gngbAX4cuHW0tKSE+f+mRgMpncb3c2Hqd+7cHNpSenxc/+MD6YHu466TgoBIsJ72daejh3oJ3l5n1/6n51zc/tH+in7ny7M23rp/2Xk5g4MOLbHNYNs3dymkDMcmZLexB7bPloS8gnHp3doYpJtJu5xaqerbPbJkYM88/OWl9ln3PQKP6S/6pU2l5lkzJNHndntR/YKsMKBQ6z7Y/AKe036ZbXq6W+Y2/EKk2z10lkndrzCXgHy7T/CjZlh7Ddjudr535oVxiQ7LHVgz8tkvw7w9qDCcFrn215Vuff7W//NYbzqwO0v2b/rensFsPs6QMO08eFtsv6HE5W9DB366Z2nwozGuLOSC2BzBTg5Onzn/zS0TM38n777hbB/hzZvYLFOFaC83xIDr17bd7eK+T82YIGBV/+z73Z9KkDNtz839Pr9oyvVy3/9PVsMvf5Q7jF7F1mJK8Bjaw0O2D5evZsSnzJ6HrZrbJ0mS8Crrxsesuh51fL/5izDQz58So8lYMWTJgbNnK9W/tdPMvPOeEOHCnBorKk7TB8qUin/Fd82de46easGFWDGcVPDqqapJMDMQ+a642f83wR+8SeTAxeuVSf/+81evvzgQ99XgGmmW91n1BHgOdPvl2dCkgpgVwVYl2e+r/qrKvn/9G3zQ+f7vAJYeRtPr1NEgCkW3sbP2fWbDzl7gE0FFgbveF+N/G9baWHw3oW+rgALPRztGoukmKScPYC12S1u0ECAJXU+rgC7tlkaXrZehfwf2mhpeMVqH1eAhR6Pd4X8kBSTbJCxAmghwCI5JiljBahZZ3EDO0oUEMDq/dj7d/m2Bzhk+UEjCghQccrqFg74tgIclGALjlMqwRYcEKAGARQTwOYmMFSNAG6tUiUyVgBbmgBZ3hwsASYEqKIC6C2AHRUgUoItOE6EBFuQtQKkSbAFx0mXYAsONIG2VAAtBAhKsAUqAAJI2QOwBLi4BFABqADSVYBUy8/E6iC/AIkt5Zhkg4QVoNlNFjfQPVV+AcQtFsdf3cm3FUCM8Xi8K1g9yNFCSgFseYRJrsfjXWFkQIpJ2i3ACTsOqkNva+1xHxUEaG3tEZ2tb5RTgAoJymNuhAoCWJzkSJueHtsgYwWwGBslWgCrntq1zMlZAXoOszA46xY1BLjqbguDr5FVAHsqgHgpwpuxrvJiM2/GKlABRNb9pocOHaZI/sU1D5se2udu4e8KIH4WbXJgxMtCGX5s+ntPXratyjXIWQFExmMmB97bWx0BUqaYHDj8ZuF2BQjXuDZHbTqwo90PmxmWsKWTOgKI0933mRkWu6mHbYfQf729FcCuJUAk/S3GxKjIeSrlX7RYZGoReN2+/NveA9SfsuvI+s0xMWjm7UIpes01sZhPHyfcFyBsDtj3XQbGV8jvqPdVES8anmRug537v95uAbbZd2z1Iw3uO6dKwS8Luc/oRbJKW3ffy+YlwL4moHGf8/sben2PvBihHm/cauziwWJ7vzPT7h7AtvPA8y39ygcMvHpUQTsF8y9il37fwKuH/KOjkFuAE3YeXcyf/y/sHU/NSxBKEvjNH8K+rvvoB21s3nuDzBWgkacXJYanytxfqPsVoo8sSwpPldm/s/0rROWuAI2MXJ8dzvK/erxQmMEbw7kNsvOyyfbvul7yCiBEtw3vdr7CS9q/sSVbKM3Vq/KvdHGn3ezPbxbeCRA2kxw4U6qdfbn2zqGv1HSb+jcvd593/IxKZ3YbtFuAex05zFMvNvVN8Vc/e8wvXx599pWmvin+qqcPO7XTcO+gD/uK5fClDlXJnXl5Gy5tWb85Jren8BN78/LWXlqUs3Jzr3dujynlNgvQr8C5gz2cv7W0tORgjRDNUoPpwcxRHYT/OJq/ubSktLS6sek/N8muozo6urukYzYL0G270xEKHS1PahshfM7RstYpbpzYtjphswDBEgEKkRDmr289uw4AzmL7lcDTdQRVJWy/EEQJ0F2ACoJKBQBVCIUQgB6QJYAVgAqAAFQABKACIAAVgCaQCkAFsCLASaKqtwCniKreApwmqlQA0LgJRADNK0AlUdVbgLKzhFVrAUK7CKvWAogvCavWTSAC6F4BthFWvQX4kLDqLUBxEXHVWgCxgrhq3QSKhcRV7wrwIecByrDfCQFCrxFYVdgQ7gsNfRw7aU8CoVWDXp85UAHE0R8TWTVY8ZkjFUBEfZJFcBUgdNMaJ3qAxt7yQe4LUiH/k8LOv0EBxJbxIeIrPT808JUMUQa3XbRvWDMiLDdTfm3gxcYfypQ5/zpiLDGrf7rSyMuNP7CqMHsWy4C0LB802FD+hanHsmXdNzaDWEtHydo1qww/zM/sc/myB6emtqk4dOhrbhTs+ISlafxIj2zd3d/K6I3zz/8Vk5ycHN+YwjMHD5aWbt4rydRyrD3kVpO36x8sBenPth1HpACtQQAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABABdBaizNLpek8DXeTjaYQGKPRytDrJEyQEBDldZGb1XEwH2Cjmi5IAAIUtHt0cTAfYIOaIUKZvcVADlK4D43LPBCnH4qIXBJ6XuAcRfLIw9vliX86+5FsbOk/xcaaP5B+C9qs0JeHcLjwnsLfnc/sf81HpqI4BYZzpI/5R9agmVZqe2QZ/8iwdNCzBJ+rk9a3JmDUM1EiDmM5NRKoqTfm5RBeamNkvoxHXVpoJU21eBuX3jlJmpFcZpJYCYZkqAGUrM7REzavfRK/8icq2JKG0MqDG5OcYbgIlCNzrsMhylfZ0UmVvErw3OrO47Qj+ChQajtPMqdSb3c0Mzq7lL6EjbzYaitD1Npck91xD+zM6MFHrSeoORK0DJak3uph3hzmzlNUJXmj1fFW6R/Em0apOLnVkbzsyOTxA603VNWPlf313FyWX948rd/zupQm8iJh+7YpQqHlf1/t1BC+ouN7HK33YR0HzS9stf/X0sXuHZdXy5ScF3P9mS7F/g1sVN9cwN798W4Vz1cWVycQMGDsq+9DrvsXUff/xJA5n/ivTBAwdlXvqfX3y8ZtUBJ5cf16YX3WdA+7bJjT+15UeOlB/ZtWYbX0H8NdcFbuyd0hik5FYnyxuDVPavNWUO7/Dfjwn7WNHa2IYAAAAASUVORK5CYII=';
const SUBWAY_BADGE_GLYPH_URI =
  'data:image/png;base64,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';

const TmapWebMapView = forwardRef<TmapMapViewHandle, TmapMapViewProps>(
  function TmapWebMapView(
    {
      style,
      errorOverlayTop,
      camera,
      markers = [],
      pathOverlays = [],
      pathOverlayZoom,
      pathCoords = [],
      pathColor = '#1D72FF',
      pathWidth = 10,
      pathOutlineColor = '#FFFFFF',
      pathOutlineWidth = 3,
      clearRouteOverlays = false,
      routeOverlayScope,
      mapBaseDimOpacity = 0,
      routeFocusMode = false,
      nightModeEnabled = false,
      showLocationButton = true,
      showZoomControls = true,
      onTapMap,
      onMarkerPress,
      onZoomChanged,
      onCameraChanged,
      onInitialized,
      onMapLayoutReport,
      fallbackBackgroundColor = DEFAULT_FALLBACK_BACKGROUND,
      fallbackTextColor = DEFAULT_FALLBACK_TEXT,
    },
    ref,
  ) {
    // WebView 인스턴스와 초기화 이전 명령 큐를 별도로 유지한다.
    const webViewRef = useRef<any>(null);
    const commandQueueRef = useRef<string[]>([]);
    const lastMapSelectionRef = useRef<TmapMapSelectionSample | undefined>(
      undefined,
    );
    // isReady=true 이후에만 postMessage를 즉시 보낸다.
    const [isReady, setIsReady] = useState(false);
    const [runtimeErrorMessage, setRuntimeErrorMessage] = useState<
      string | undefined
    >(undefined);
    const [webViewReloadRevision, setWebViewReloadRevision] = useState(0);
    const [nativeDirectionUsable, setNativeDirectionUsable] = useState<
      boolean | undefined
    >();
    const [nativeDashViewport, setNativeDashViewport] = useState<
      NativeDashViewport & { zoom: number }
    >(() => ({
      center: { latitude: camera.latitude, longitude: camera.longitude },
      widthPx: 0,
      heightPx: 0,
      zoom: camera.zoom ?? pathOverlayZoom ?? 15,
    }));
    const routeOverlayScopeToken = routeOverlayScope?.trim() || 'default';
    const webViewKey = useMemo(
      () => `${TMAP_WEBVIEW_HTML_VERSION}:${routeOverlayScopeToken}`,
      [routeOverlayScopeToken],
    );
    const activeWebViewKey = [
      webViewKey,
      String(webViewReloadRevision),
      nightModeEnabled ? 'dark' : 'light',
      showLocationButton ? 'location' : 'no-location',
      showZoomControls ? 'zoom' : 'no-zoom',
    ].join(':');
    const readyWebViewKeyRef = useRef<string | null>(null);
    const htmlBootstrapScope = activeWebViewKey;
    const htmlInitialCameraRef = useRef({
      scope: htmlBootstrapScope,
      latitude: camera.latitude,
      longitude: camera.longitude,
      zoom: camera.zoom,
    });
    if (htmlInitialCameraRef.current.scope !== htmlBootstrapScope) {
      htmlInitialCameraRef.current = {
        scope: htmlBootstrapScope,
        latitude: camera.latitude,
        longitude: camera.longitude,
        zoom: camera.zoom,
      };
    }

    const appKey =
      getEnv('EXPO_PUBLIC_TMAP_APP_KEY') ?? getEnv('EXPO_PUBLIC_TMAP_API_KEY');

    const hasWebView = !!WebView;
    const canRender = hasWebView && !!appKey;
    const nativePathOverlays = useMemo(
      () =>
        expandNativeDashPathOverlays(
          pathOverlays,
          nativeDashViewport.zoom ?? pathOverlayZoom ?? camera.zoom ?? 15,
          nativeDashViewport.widthPx > 0 && nativeDashViewport.heightPx > 0
            ? nativeDashViewport
            : undefined,
        ),
      [camera.zoom, nativeDashViewport, pathOverlayZoom, pathOverlays],
    );
    const renderedPathOverlays = useMemo(
      () =>
        addNativeDirectionScreenFallbacks(
          nativePathOverlays,
          nativeDirectionUsable,
        ),
      [nativeDirectionUsable, nativePathOverlays],
    );

    useEffect(() => {
      setNativeDashViewport(current => ({
        ...current,
        center: { latitude: camera.latitude, longitude: camera.longitude },
        zoom: camera.zoom ?? current.zoom,
      }));
    }, [camera.latitude, camera.longitude, camera.zoom, webViewKey]);

    useEffect(() => {
      if (!canRender) {
        setIsReady(false);
        readyWebViewKeyRef.current = null;
        onInitialized?.();
      }
    }, [canRender, onInitialized]);

    // WebView 준비 전에는 명령을 큐에 쌓아 초기화 직후 순차 전송한다.
    const postCommand = useCallback(
      (command: Record<string, unknown>) => {
        const json = JSON.stringify(command);
        if (
          !isReady ||
          readyWebViewKeyRef.current !== activeWebViewKey ||
          !webViewRef.current
        ) {
          commandQueueRef.current = enqueueTmapCommand(
            commandQueueRef.current,
            command,
          );
          return;
        }
        webViewRef.current.postMessage(json);
      },
      [activeWebViewKey, isReady],
    );

    useEffect(() => {
      readyWebViewKeyRef.current = null;
      commandQueueRef.current = [];
      setIsReady(false);
      setRuntimeErrorMessage(undefined);
      setNativeDirectionUsable(undefined);
    }, [activeWebViewKey]);

    useEffect(() => {
      if (!canRender || isReady || runtimeErrorMessage) return;
      const timeoutId = setTimeout(() => {
        setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
      }, MAP_INITIALIZATION_TIMEOUT_MS);
      return () => clearTimeout(timeoutId);
    }, [activeWebViewKey, canRender, isReady, runtimeErrorMessage]);

    const retryMapLoad = useCallback(() => {
      commandQueueRef.current = [];
      readyWebViewKeyRef.current = null;
      setIsReady(false);
      setRuntimeErrorMessage(undefined);
      setWebViewReloadRevision(current => current + 1);
    }, []);

    const handleNativeWebViewError = useCallback((event: any) => {
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.warn('[tmap] WebView load failed', event?.nativeEvent);
      }
      setIsReady(false);
      setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        animateCameraTo(nextCamera) {
          postCommand({ type: 'animateCamera', payload: nextCamera });
        },
        animateRegionTo(region) {
          postCommand({ type: 'animateRegion', payload: region });
        },
        fitToCoordinates(coords, options) {
          postCommand({
            type: 'fitBounds',
            payload: {
              coords,
              padding: options?.padding ?? 48,
              edgePadding: options?.edgePadding,
            },
          });
        },
        resizeMap(reason = 'imperative') {
          postCommand({ type: 'resizeMap', payload: { reason } });
        },
        zoomBy(delta) {
          postCommand({ type: 'zoomBy', payload: { delta } });
        },
      }),
      [postCommand],
    );

    const handleContainerLayout = useCallback(
      (event: any) => {
        const width = Math.round(event?.nativeEvent?.layout?.width ?? 0);
        const height = Math.round(event?.nativeEvent?.layout?.height ?? 0);
        if (width <= 0 || height <= 0) return;
        setNativeDashViewport(current =>
          current.widthPx === width && current.heightPx === height
            ? current
            : { ...current, widthPx: width, heightPx: height },
        );
        onMapLayoutReport?.({
          reason: 'RN_CONTAINER_LAYOUT',
          mapContainerWidth: width,
          mapContainerHeight: height,
          webViewWidth: width,
          webViewHeight: height,
          isCameraAnimating: false,
          isMapIdle: true,
        });
        postCommand({
          type: 'resizeMap',
          payload: {
            reason: 'RN_CONTAINER_LAYOUT',
            width,
            height,
          },
        });
      },
      [onMapLayoutReport, postCommand],
    );

    useEffect(() => {
      if (!canRender) return;
      postCommand({
        type: 'setData',
        payload: {
          markers,
          pathOverlays: renderedPathOverlays,
          pathCoords,
          pathColor,
          pathWidth,
          pathOutlineColor,
          pathOutlineWidth,
          clearRouteOverlays,
          routeOverlayScope,
          mapBaseDimOpacity,
          routeFocusMode,
          nightModeEnabled,
        },
      });
    }, [
      canRender,
      markers,
      renderedPathOverlays,
      pathCoords,
      pathColor,
      pathWidth,
      pathOutlineColor,
      pathOutlineWidth,
      clearRouteOverlays,
      routeOverlayScope,
      mapBaseDimOpacity,
      routeFocusMode,
      nightModeEnabled,
      postCommand,
    ]);

    // camera prop 변경은 HTML 자체를 다시 만들지 않고 준비된 지도에 명령으로 반영한다.
    useEffect(() => {
      if (!canRender) return;
      postCommand({
        type: 'animateCamera',
        payload: {
          latitude: camera.latitude,
          longitude: camera.longitude,
          zoom: camera.zoom,
        },
      });
    }, [
      camera.latitude,
      camera.longitude,
      camera.zoom,
      canRender,
      postCommand,
    ]);

    // WebView -> React Native 메시지를 파싱해 탭/줌/초기화 이벤트로 분기한다.
    const onWebViewMessage = useCallback(
      (event: any) => {
        const data = event?.nativeEvent?.data;
        if (!data) return;

        try {
          const message = JSON.parse(data);
          const type = message?.type;

          if (type === 'initialized') {
            readyWebViewKeyRef.current = activeWebViewKey;
            lastMapSelectionRef.current = undefined;
            setIsReady(true);
            setRuntimeErrorMessage(undefined);
            if (webViewRef.current && commandQueueRef.current.length > 0) {
              commandQueueRef.current.forEach(command => {
                webViewRef.current.postMessage(command);
              });
              commandQueueRef.current = [];
            }
            onInitialized?.();
            return;
          }

          if (type === 'layout') {
            const width = safeNumber(
              message?.payload?.webViewWidth ??
                message?.payload?.mapContainerWidth,
            );
            const height = safeNumber(
              message?.payload?.webViewHeight ??
                message?.payload?.mapContainerHeight,
            );
            if (
              typeof width === 'number' &&
              width > 0 &&
              typeof height === 'number' &&
              height > 0
            ) {
              setNativeDashViewport(current =>
                current.widthPx === width && current.heightPx === height
                  ? current
                  : { ...current, widthPx: width, heightPx: height },
              );
            }
            onMapLayoutReport?.(message?.payload ?? {});
            return;
          }

          if (type === 'error') {
            if (typeof __DEV__ === 'boolean' && __DEV__) {
              console.warn(
                '[tmap] runtime initialization failed',
                message?.payload?.message,
              );
            }
            setIsReady(false);
            setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
            return;
          }

          if (type === 'tap') {
            const latitude = safeNumber(message?.payload?.latitude);
            const longitude = safeNumber(message?.payload?.longitude);
            if (
              typeof latitude === 'number' &&
              typeof longitude === 'number' &&
              isValidWgs84Coordinate(latitude, longitude)
            ) {
              const nextSelection = {
                latitude,
                longitude,
                timestampMs: Date.now(),
              };
              if (
                isDuplicateTmapMapSelection(
                  lastMapSelectionRef.current,
                  nextSelection,
                )
              ) {
                return;
              }
              lastMapSelectionRef.current = nextSelection;
              onTapMap?.({ latitude, longitude });
            }
            return;
          }

          if (type === 'markerPress') {
            const id =
              typeof message?.payload?.id === 'string'
                ? message.payload.id
                : undefined;
            const interactionId =
              typeof message?.payload?.interactionId === 'string'
                ? message.payload.interactionId
                : undefined;
            if (id) onMarkerPress?.({ id, interactionId });
            return;
          }

          if (type === 'zoomChanged') {
            const zoom = safeNumber(message?.payload?.zoom);
            if (typeof zoom === 'number') {
              onZoomChanged?.(zoom);
              const latitude = safeNumber(message?.payload?.latitude);
              const longitude = safeNumber(message?.payload?.longitude);
              if (
                typeof latitude === 'number' &&
                typeof longitude === 'number'
              ) {
                setNativeDashViewport(current => {
                  if (
                    Math.abs(current.center.latitude - latitude) < 1e-7 &&
                    Math.abs(current.center.longitude - longitude) < 1e-7 &&
                    Math.abs(current.zoom - zoom) < 1e-3
                  ) {
                    return current;
                  }
                  return {
                    ...current,
                    center: { latitude, longitude },
                    zoom,
                  };
                });
                const metersPerPixel = safeNumber(
                  message?.payload?.metersPerPixel,
                );
                onCameraChanged?.({
                  latitude,
                  longitude,
                  zoom,
                  metersPerPixel,
                });
              }
            }
            return;
          }

          if (type === 'routeOverlayState') {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.log('[route-overlay-state]', message?.payload ?? {});
            }
            return;
          }

          if (type === 'routeVisibility') {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              const summary = message?.payload?.summary ?? {};
              console.log('[route-visibility]', summary);
              if (Array.isArray(message?.payload?.rows)) {
                console.table(message.payload.rows);
              }
            }
            return;
          }

          if (type === 'tmapNativeDirectionReport') {
            const firstRow = Array.isArray(message?.payload?.rows)
              ? message.payload.rows[0]
              : undefined;
            setNativeDirectionUsable(firstRow?.usableForRouteLine === true);
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.log(
                '[tmap-sdk] native direction report:',
                message?.payload ?? {},
              );
              if (Array.isArray(message?.payload?.rows)) {
                console.table(
                  message.payload.rows.map((row: any) => ({
                    sdk: row?.sdk,
                    supportsDirection: row?.supportsDirection === true,
                    supportsDirectionColor:
                      row?.supportsDirectionColor === true,
                    supportsDirectionOpacity:
                      row?.supportsDirectionOpacity === true,
                    supportsDashStroke: row?.supportsDashStroke === true,
                    pathOrderControlsDirection:
                      row?.pathOrderControlsDirection === true,
                    arrowMovesWithPolyline:
                      row?.arrowMovesWithPolyline === true,
                    usableForRouteLine: row?.usableForRouteLine === true,
                    reasonNativeDirectionDisabled:
                      row?.reasonNativeDirectionDisabled ?? row?.reason,
                  })),
                );
              }
            }
            return;
          }
        } catch {
          // ignore malformed message
        }
      },
      [
        activeWebViewKey,
        onCameraChanged,
        onInitialized,
        onMapLayoutReport,
        onMarkerPress,
        onTapMap,
        onZoomChanged,
      ],
    );

    // Tmap SDK를 포함한 WebView HTML을 생성한다.
    const html = useMemo(() => {
      if (!appKey || !htmlBootstrapScope) return '';
      const initialCamera = htmlInitialCameraRef.current;
      const initialZoom = Math.max(
        6,
        Math.min(18, Math.round(initialCamera.zoom ?? 12)),
      );
      const initialLat = initialCamera.latitude;
      const initialLng = initialCamera.longitude;
      const isDevelopmentFlag =
        typeof __DEV__ === 'boolean' && __DEV__ ? 'true' : 'false';
      const showZoomControlFlag = showZoomControls ? 'true' : 'false';
      const showLocationControlFlag = showLocationButton ? 'true' : 'false';
      const darkFlag = nightModeEnabled ? 'true' : 'false';
      const initialMapBackground = nightModeEnabled ? '#0B1220' : '#F2F2F7';

      return buildTmapWebHtml({
        initialMapBackground,
        vectorScriptVersionJson: JSON.stringify(TMAP_VECTOR_JS_SCRIPT_VERSION),
        vectorScriptUrl: getTmapVectorScriptUrl(appKey),
        initialLat,
        initialLng,
        initialZoom,
        isDevelopmentFlag,
        showZoomControlFlag,
        showLocationControlFlag,
        darkFlag,
        nativeDirectionCapabilityScript:
          TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT,
        nativeStrokeColorScript: TMAP_NATIVE_STROKE_COLOR_SCRIPT,
        nativeDirectionReportScript: TMAP_NATIVE_DIRECTION_REPORT_SCRIPT,
        busBadgeGlyphJson: JSON.stringify(BUS_BADGE_GLYPH_URI),
        subwayBadgeGlyphJson: JSON.stringify(SUBWAY_BADGE_GLYPH_URI),
        mapSelectionEventsJson: JSON.stringify(TMAP_MAP_SELECTION_EVENTS),
        mapTouchSelectionMaxMovementPx:
          TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX,
      });
    }, [
      appKey,
      htmlBootstrapScope,
      nightModeEnabled,
      showLocationButton,
      showZoomControls,
    ]);

    if (!canRender) {
      const missingReason = !hasWebView
        ? '이 기기에서는 지도를 표시할 수 없습니다.'
        : '지도 설정을 불러오지 못했습니다. 앱을 최신 버전으로 업데이트해 주세요.';
      return (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLabel={missingReason}
          style={[
            styles.fallback,
            { backgroundColor: fallbackBackgroundColor },
            style,
          ]}
        >
          <Text style={[styles.fallbackText, { color: fallbackTextColor }]}>
            {missingReason}
          </Text>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: fallbackBackgroundColor },
          style,
        ]}
        onLayout={handleContainerLayout}
      >
        <WebView
          key={activeWebViewKey}
          ref={webViewRef}
          accessibilityLabel="지도"
          accessibilityElementsHidden={!!runtimeErrorMessage}
          importantForAccessibility={
            runtimeErrorMessage ? 'no-hide-descendants' : 'auto'
          }
          originWhitelist={['*']}
          source={{ html }}
          onMessage={onWebViewMessage}
          onError={handleNativeWebViewError}
          onHttpError={handleNativeWebViewError}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={true}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          style={[styles.webview, { backgroundColor: fallbackBackgroundColor }]}
        />
        {!isReady && !runtimeErrorMessage && (
          <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            style={[
              styles.loadingOverlay,
              { backgroundColor: fallbackBackgroundColor },
            ]}
          >
            <ActivityIndicator color="#2979FF" />
            <Text style={[styles.loadingText, { color: fallbackTextColor }]}>
              지도를 불러오는 중…
            </Text>
          </View>
        )}
        {!!runtimeErrorMessage && (
          <View
            accessibilityLiveRegion="assertive"
            style={[
              styles.errorOverlay,
              typeof errorOverlayTop === 'number'
                ? { top: errorOverlayTop, bottom: undefined }
                : null,
            ]}
          >
            <View style={styles.errorOverlayCopy}>
              <Text style={styles.errorOverlayTitle}>지도 로딩 실패</Text>
              <Text style={styles.errorOverlayText}>{runtimeErrorMessage}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지도 다시 불러오기"
              onPress={retryMapLoad}
              style={styles.errorRetryButton}
            >
              <Text style={styles.errorRetryText}>다시 시도</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  },
);
const TmapMapView = forwardRef<TmapMapViewHandle, TmapMapViewProps>(
  function TmapMapView(props, ref) {
    if (isNativeTMapViewAvailable()) {
      return <TmapNativeMapView ref={ref} {...props} />;
    }

    // iOS/Android에서는 TMAP 네이티브 모듈이 빠진 구빌드를 Web 지도로
    // 조용히 대체하지 않는다. 그렇게 하면 Web SDK의 검은 방향 표시가
    // 네이티브 SDK 결과처럼 보여 설치 누락을 알아차리기 어렵다.
    if (Platform.OS !== 'web' && process.env.NODE_ENV !== 'test') {
      const message =
        '지도를 사용할 수 없습니다. 앱을 업데이트한 뒤 다시 시도해 주세요.';
      return (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLabel={message}
          style={[
            styles.fallback,
            {
              backgroundColor:
                props.fallbackBackgroundColor ?? DEFAULT_FALLBACK_BACKGROUND,
            },
            props.style,
          ]}
        >
          <Text
            style={[
              styles.fallbackText,
              { color: props.fallbackTextColor ?? DEFAULT_FALLBACK_TEXT },
            ]}
          >
            {message}
          </Text>
        </View>
      );
    }

    return <TmapWebMapView ref={ref} {...props} />;
  },
);

export default TmapMapView;
