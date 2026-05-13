import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { getEnv } from "../../api/env";

export type TmapLatLng = {
    latitude: number;
    longitude: number;
};

export type TmapMarker = {
    id: string;
    latitude: number;
    longitude: number;
    tintColor?: string;
    caption?: string;
    displayType?: "pin" | "badge" | "arrow" | "dot";
    markerStyle?: "default" | "origin" | "destination" | "bus" | "subway" | "transfer";
    pinLabel?: string;
    badgeLabel?: string;
    badgeTextColor?: string;
    badgeBorderColor?: string;
    badgeConnectorColor?: string;
    badgeGlyph?: string;
    dotSize?: number;
    rotationDeg?: number;
    zIndex?: number;
};

export type TmapPathOverlay = {
    id: string;
    coords: TmapLatLng[];
    color?: string;
    width?: number;
    outlineColor?: string;
    outlineWidth?: number;
};

export type TmapMapViewHandle = {
    animateCameraTo: (camera: {
        latitude: number;
        longitude: number;
        zoom?: number;
        duration?: number;
        easing?: string;
    }) => void;
    animateRegionTo: (region: {
        latitude: number;
        longitude: number;
        latitudeDelta: number;
        longitudeDelta: number;
        duration?: number;
        easing?: string;
        pivot?: { x: number; y: number };
    }) => void;
    fitToCoordinates: (coords: TmapLatLng[], options?: { padding?: number }) => void;
    zoomBy: (delta: number) => void;
};

type TmapMapViewProps = {
    style?: StyleProp<ViewStyle>;
    camera: {
        latitude: number;
        longitude: number;
        zoom?: number;
    };
    markers?: TmapMarker[];
    pathOverlays?: TmapPathOverlay[];
    pathCoords?: TmapLatLng[];
    pathColor?: string;
    pathWidth?: number;
    pathOutlineColor?: string;
    pathOutlineWidth?: number;
    nightModeEnabled?: boolean;
    showLocationButton?: boolean;
    showZoomControls?: boolean;
    onTapMap?: (event: { latitude: number; longitude: number }) => void;
    onZoomChanged?: (zoom: number) => void;
    onInitialized?: () => void;
    fallbackBackgroundColor?: string;
    fallbackTextColor?: string;
};

const tmapWebviewModule = (() => {
    try {
        return require("react-native-webview");
    } catch {
        return null;
    }
})();

const WebView = tmapWebviewModule?.WebView as any;

function safeNumber(value: unknown): number | undefined {
    const numberValue = typeof value === "string" ? Number(value) : (value as number);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

const DEFAULT_FALLBACK_BACKGROUND = "#E5E7EB";
const DEFAULT_FALLBACK_TEXT = "#6B7280";
// WebView 내부 SVG <image>에서 안정적으로 렌더되도록 아이콘을 data URI로 고정한다.
const BUS_BADGE_GLYPH_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAMAAADDpiTIAAAAA3NCSVQICAjb4U/gAAAACXBIWXMAAJv3AACb9wGlhj2oAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAAwBQTFRF////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACyO34QAAAP90Uk5TAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+6wjZNQAAE1pJREFUeNrtnQtwVdW5gFeSQx6QhEdCSE5AghUhvIwUTABBBKUCQrAqPqDVCldBW2tVBNSptLeW6nXaYltaqdXeojCO0gYIWAERBAIFawHBRJB3EiDhEQiPvE/Do06HMXD2e629vi/DwDBn7b3X/3/nX//e2WefCOE3ohPP0zIxISYqEAg0/Seqrqb6q5//+udXP5UVFXXC70Qofvwx51J9MeMXiLVz85UVxy/8XPjrNALIQGTbYDA9GAymtUpMjHZ1z7X/MeGcEkcO1iCAm7Q5n/VGUgNyHFCorKS4uLjxT8lpBHCMhItZDwZj5D3IigsiFJccRwDbSM7smtn1G8F4pcJ5pvhiUSgLIYDpJb5j13O5T1Z6aa3dX9hIUQUCGCG2c2Zj6q+N80+PfbBRgsLCUgS4YoN3/k3fKdKf59onis6Vgz31CPA1RPXMvj6za4rwP9U7zmmwowoBvqJDdnb2N5sLrWjYW1j46br92guQ0Kcx+WlCV0oKCgr+VaurAImDhg7pESl05+ymgoL1R3QTILb/0CF9AgIusmNdQUFhSBMBAn2GDukfS9Iv5fiGgnUbT/tdgIQRdwxPJNlNUb+loMCT1tAdAVJG3zE0hixfsTX8+5Llp/wnQKcxdwyg5QuTmtX5+bv9JEDaA/dkkVZjFOXnr6vzhQCB2ycMjyKhJqj4+ztLa1QXoMuE77YjlebPDd59e01IXQFajJ0wgCRaZP+8t7arKUDSEz9oSf7sYMtb80uUE6DdU5PjSZ1tVwgWzVqtlADpUx6OI232loFZ86tUESBj6ve44mM/5XNml6ogQMyz06LJliPUvverTdILcNNrXciUcyx4dof9G7XxGm3r1z8i/05y5/bZ9l9Yse9C3b1LBkaQJEeJ7Dsp5hObLxDalbPEt0aRIDco+8mcOgkFyMjvTm5cYtO4ndItAf1WZpAYt0h/qPxTyZrA+z9qS17co8WcvGSpBJjxNtd+3CX3s+ESLQEvzCAjbhM/rtlKWQTI/T1nfx4wqNUHcgiQuZT67wk5Ke/LIECrlWnkwhv6pi8JeS5A5IJsMuEVvTstDnktwINPkwfvuK7B+q0i1hq4ZjsySIOH1OZYviRk7TrABPLvKc3+33IHbmkJiHmPT/t5S0r0Ci8rwKT2pMBjnu7vYQ/QfDcf/PCcnd1rPasA95B/7+k83rsKsOZGO2cydYcmKUv/ra2b+6Jbg1fuhWwlR5f3bFd74xa606sl4HvUXymY5pEAUd8l9lLQ5xZvBBiWTuzlYLo3ArACyMKQG7wQIDGXyMvCRC8EuJUPAUrDXdEeCDCCuEtD69vcFyBiOHGXh/vdFyCLO8EkYlS86wKwAshE8zEIwBrgqgBtuBdUKm5NdlmAb/EAUKkI3OW2AMRcLka4LABPAZWMwQFXBWh3DSGXi4QcVwXoT8SlawNdFYAVAAFALm5o6aIAsb0JuGxE3eyiAH34VbBv1gBTArACIADIRueO7gnQj3BLyEDXBEhPJtoSku2aAD0ItpQnggigN1kxCKA10VkIwBrghgAR3Yi1f7pAEwJ0ak6sta4ArACS0rkNAuhNXxNjAtIIMChVkzQ597H67A9UFuAl3sFeVADjD4kKnOaXwZKyL8ONHuBa8i8rHRPcEIAeUF66uyEAXxCouQBUAHnpgQBUAKfPAmJP8blQaTkYdL4CZJJ/eUlr47wArAD+WgMQQPMuEAGoAFwG0LkCGD0LSDhJlCWmPMXpCsCTIaSmbQunBbiKIEtNBgIgAAIgAALoSiejA4zeEmb4M8g/KiIrJrn6dy5UgIDTFWDDBjJpkiwJl4DoVPKidQ/QPoIYS01SgrMCdCTEPisBBgXgJAABAAHAPxcC6AGoAFQABAibDkRYawGSeTiI7LRu6aQArAC+KwHGBKAH1FwAKgACgL8uBCAAFYAeAAGoAAgQDjEpxFd6WrZ2ToAO3A7iuxJgSABaAM0FoAXwnwDh3xWclp09mugqwJO9t2zdesjmjfb6/f6QOXLIiFmyQubZ+zMbP8YbPW6t+SNBAE8EaGTtBJue6Tpin5XDQACvBAiFim6xoQlsO28JvZ+idFn+TrpVAe4ovI9AqsvYotutCfDwe0lEUWXi8yZaEWD6a5HEUG2i/viC+cEzQ9ahCfSuCbzIL8xWgPumkQQ/MPVOcwJcO4fY+YM3rzUjQNy78YTOHyQsaG5CgP/tReT8Qo/njQuQ9hhx8w+PpxgWYGosYfMPLaYbFSDtEaLmJya3NyjA4xQAXxHzfYMC5BIzfzHKmACdMgmZv+iWYUiAEUTMb4xEAL0ZYUiALALmN7obESCSjwD5jrQIAwIkBwiY34hOMiBAGvHyH0EDAvBMcD+uAQYEiCNc/iPOyFkA6AICIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIABIJECIwPiPkAEBKgmX/zhpQIBywuU/ygwIUEa4/MdhAwIcoQnwHfVHDQhQ/wUB8xs7jTSB4mMC5jdWCwTQmlUIgADhC3AAA3zG+kOGBBCzCZm/mCWMCfDXg8TMTxQvMChA7W8Imp+YXWdQAPHLL4maf9jT1ArQtADVjxM2/zDpjGEBxPsLiJtfmLtMGBdATOR6sE/48glhRoCKUceJnR84MvyYKQHEzruqiZ76nB19uX7+svcErvxWBfFTnZNj1guzAojVA4uJoNrsylkmzAsgtuUsJ4Yqs+KGQmFFAFEybALLgLIcfmDYMetbCb5eHTJPDmkwS1bIGtW/SrTpSNJfqUQA1QTYPS3FxmN5FAEUE+ChiPB2EuZHwwKkQzG2hBBAa6IEAmhNwF4BmhFRKgAgAOgqAEuA5j0AFYAlAFgCgAoA9ADAEgAsAYAAwBIANIHAEgAsAUAFAHoAYAkAlgBAAPBZD8ASQAUABADOAoDrAMASACwBQAUAegBgCQANBIjgO6b1FoAVQPMegBWACgAIANoKwBKgeQ9ABfBtBQg4LUDnKpJhki7yCGBhCfgLiaQJBHoA4CwAWAIAAUDFHoAlgAoACACcBQDXAYAlAFgCgAoA9ADAEgA6CMDHAjQXoIGA6t0DhAgoFQA0FoAKQAUAKgAoRIgKgAAIgAAsAQhABUAAKgACUAEQgAqAAFQABEAABGAJQAAqAAJQARCACoAAVAAEoAIgAAIgAEsAAlABEIAK4BcaqABUACoAAlABEAABEIAlAAGoAAhABUAAKgACUAEQgAqAAFQABKACIAACIABLAAJQARCACoAAVAAEoAIgABUAARDAF9h7TyBLABUAaAKBCgBUAKACAAIASwBQAYAKADoIUE9AVcPeS8HVBNSvhCkAa4DeS4CoIaJ6C1BFRPUWgCbArwIE5KkAZ0rLk4LxPs/L2dKy1ukJ6gngbAX4cuHW0tKSE+f+mRgMpncb3c2Hqd+7cHNpSenxc/+MD6YHu466TgoBIsJ72daejh3oJ3l5n1/6n51zc/tH+in7ny7M23rp/2Xk5g4MOLbHNYNs3dymkDMcmZLexB7bPloS8gnHp3doYpJtJu5xaqerbPbJkYM88/OWl9ln3PQKP6S/6pU2l5lkzJNHndntR/YKsMKBQ6z7Y/AKe036ZbXq6W+Y2/EKk2z10lkndrzCXgHy7T/CjZlh7Ddjudr535oVxiQ7LHVgz8tkvw7w9qDCcFrn215Vuff7W//NYbzqwO0v2b/rensFsPs6QMO08eFtsv6HE5W9DB366Z2nwozGuLOSC2BzBTg5Onzn/zS0TM38n777hbB/hzZvYLFOFaC83xIDr17bd7eK+T82YIGBV/+z73Z9KkDNtz839Pr9oyvVy3/9PVsMvf5Q7jF7F1mJK8Bjaw0O2D5evZsSnzJ6HrZrbJ0mS8Crrxsesuh51fL/5izDQz58So8lYMWTJgbNnK9W/tdPMvPOeEOHCnBorKk7TB8qUin/Fd82de46easGFWDGcVPDqqapJMDMQ+a642f83wR+8SeTAxeuVSf/+81evvzgQ99XgGmmW91n1BHgOdPvl2dCkgpgVwVYl2e+r/qrKvn/9G3zQ+f7vAJYeRtPr1NEgCkW3sbP2fWbDzl7gE0FFgbveF+N/G9baWHw3oW+rgALPRztGoukmKScPYC12S1u0ECAJXU+rgC7tlkaXrZehfwf2mhpeMVqH1eAhR6Pd4X8kBSTbJCxAmghwCI5JiljBahZZ3EDO0oUEMDq/dj7d/m2Bzhk+UEjCghQccrqFg74tgIclGALjlMqwRYcEKAGARQTwOYmMFSNAG6tUiUyVgBbmgBZ3hwsASYEqKIC6C2AHRUgUoItOE6EBFuQtQKkSbAFx0mXYAsONIG2VAAtBAhKsAUqAAJI2QOwBLi4BFABqADSVYBUy8/E6iC/AIkt5Zhkg4QVoNlNFjfQPVV+AcQtFsdf3cm3FUCM8Xi8K1g9yNFCSgFseYRJrsfjXWFkQIpJ2i3ACTsOqkNva+1xHxUEaG3tEZ2tb5RTgAoJymNuhAoCWJzkSJueHtsgYwWwGBslWgCrntq1zMlZAXoOszA46xY1BLjqbguDr5FVAHsqgHgpwpuxrvJiM2/GKlABRNb9pocOHaZI/sU1D5se2udu4e8KIH4WbXJgxMtCGX5s+ntPXratyjXIWQFExmMmB97bWx0BUqaYHDj8ZuF2BQjXuDZHbTqwo90PmxmWsKWTOgKI0933mRkWu6mHbYfQf729FcCuJUAk/S3GxKjIeSrlX7RYZGoReN2+/NveA9SfsuvI+s0xMWjm7UIpes01sZhPHyfcFyBsDtj3XQbGV8jvqPdVES8anmRug537v95uAbbZd2z1Iw3uO6dKwS8Luc/oRbJKW3ffy+YlwL4moHGf8/sben2PvBihHm/cauziwWJ7vzPT7h7AtvPA8y39ygcMvHpUQTsF8y9il37fwKuH/KOjkFuAE3YeXcyf/y/sHU/NSxBKEvjNH8K+rvvoB21s3nuDzBWgkacXJYanytxfqPsVoo8sSwpPldm/s/0rROWuAI2MXJ8dzvK/erxQmMEbw7kNsvOyyfbvul7yCiBEtw3vdr7CS9q/sSVbKM3Vq/KvdHGn3ezPbxbeCRA2kxw4U6qdfbn2zqGv1HSb+jcvd593/IxKZ3YbtFuAex05zFMvNvVN8Vc/e8wvXx599pWmvin+qqcPO7XTcO+gD/uK5fClDlXJnXl5Gy5tWb85Jren8BN78/LWXlqUs3Jzr3dujynlNgvQr8C5gz2cv7W0tORgjRDNUoPpwcxRHYT/OJq/ubSktLS6sek/N8muozo6urukYzYL0G270xEKHS1PahshfM7RstYpbpzYtjphswDBEgEKkRDmr289uw4AzmL7lcDTdQRVJWy/EEQJ0F2ACoJKBQBVCIUQgB6QJYAVgAqAAFQABKACIAAVgCaQCkAFsCLASaKqtwCniKreApwmqlQA0LgJRADNK0AlUdVbgLKzhFVrAUK7CKvWAogvCavWTSAC6F4BthFWvQX4kLDqLUBxEXHVWgCxgrhq3QSKhcRV7wrwIecByrDfCQFCrxFYVdgQ7gsNfRw7aU8CoVWDXp85UAHE0R8TWTVY8ZkjFUBEfZJFcBUgdNMaJ3qAxt7yQe4LUiH/k8LOv0EBxJbxIeIrPT808JUMUQa3XbRvWDMiLDdTfm3gxcYfypQ5/zpiLDGrf7rSyMuNP7CqMHsWy4C0LB802FD+hanHsmXdNzaDWEtHydo1qww/zM/sc/myB6emtqk4dOhrbhTs+ISlafxIj2zd3d/K6I3zz/8Vk5ycHN+YwjMHD5aWbt4rydRyrD3kVpO36x8sBenPth1HpACtQQAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABABdBaizNLpek8DXeTjaYQGKPRytDrJEyQEBDldZGb1XEwH2Cjmi5IAAIUtHt0cTAfYIOaIUKZvcVADlK4D43LPBCnH4qIXBJ6XuAcRfLIw9vliX86+5FsbOk/xcaaP5B+C9qs0JeHcLjwnsLfnc/sf81HpqI4BYZzpI/5R9agmVZqe2QZ/8iwdNCzBJ+rk9a3JmDUM1EiDmM5NRKoqTfm5RBeamNkvoxHXVpoJU21eBuX3jlJmpFcZpJYCYZkqAGUrM7REzavfRK/8icq2JKG0MqDG5OcYbgIlCNzrsMhylfZ0UmVvErw3OrO47Qj+ChQajtPMqdSb3c0Mzq7lL6EjbzYaitD1Npck91xD+zM6MFHrSeoORK0DJak3uph3hzmzlNUJXmj1fFW6R/Em0apOLnVkbzsyOTxA603VNWPlf313FyWX948rd/zupQm8iJh+7YpQqHlf1/t1BC+ouN7HK33YR0HzS9stf/X0sXuHZdXy5ScF3P9mS7F/g1sVN9cwN798W4Vz1cWVycQMGDsq+9DrvsXUff/xJA5n/ivTBAwdlXvqfX3y8ZtUBJ5cf16YX3WdA+7bJjT+15UeOlB/ZtWYbX0H8NdcFbuyd0hik5FYnyxuDVPavNWUO7/Dfjwn7WNHa2IYAAAAASUVORK5CYII=";
const SUBWAY_BADGE_GLYPH_URI = "data:image/png;base64,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";

const TmapMapView = forwardRef<TmapMapViewHandle, TmapMapViewProps>(function TmapMapView(
    {
        style,
        camera,
        markers = [],
        pathOverlays = [],
        pathCoords = [],
        pathColor = "#1D72FF",
        pathWidth = 10,
        pathOutlineColor = "#FFFFFF",
        pathOutlineWidth = 3,
        nightModeEnabled = false,
        showLocationButton = true,
        showZoomControls = true,
        onTapMap,
        onZoomChanged,
        onInitialized,
        fallbackBackgroundColor = DEFAULT_FALLBACK_BACKGROUND,
        fallbackTextColor = DEFAULT_FALLBACK_TEXT,
    },
    ref
) {
    // WebView 인스턴스와 초기화 이전 명령 큐를 별도로 유지한다.
    const webViewRef = useRef<any>(null);
    const commandQueueRef = useRef<string[]>([]);
    // isReady=true 이후에만 postMessage를 즉시 보낸다.
    const [isReady, setIsReady] = useState(false);
    const [runtimeErrorMessage, setRuntimeErrorMessage] = useState<string | undefined>(undefined);

    const appKey = getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY");

    const hasWebView = !!WebView;
    const canRender = hasWebView && !!appKey;

    useEffect(() => {
        if (!canRender) {
            setIsReady(false);
            onInitialized?.();
        }
    }, [canRender, onInitialized]);

    // WebView 준비 전에는 명령을 큐에 쌓아 초기화 직후 순차 전송한다.
    const postCommand = useCallback((command: Record<string, unknown>) => {
        const json = JSON.stringify(command);
        if (!isReady || !webViewRef.current) {
            commandQueueRef.current.push(json);
            return;
        }
        webViewRef.current.postMessage(json);
    }, [isReady]);

    useImperativeHandle(ref, () => ({
        animateCameraTo(nextCamera) {
            postCommand({ type: "animateCamera", payload: nextCamera });
        },
        animateRegionTo(region) {
            postCommand({ type: "animateRegion", payload: region });
        },
        fitToCoordinates(coords, options) {
            postCommand({ type: "fitBounds", payload: { coords, padding: options?.padding ?? 48 } });
        },
        zoomBy(delta) {
            postCommand({ type: "zoomBy", payload: { delta } });
        },
    }), [postCommand]);

    useEffect(() => {
        if (!canRender) return;
        postCommand({
            type: "setData",
            payload: {
                markers,
                pathOverlays,
                pathCoords,
                pathColor,
                pathWidth,
                pathOutlineColor,
                pathOutlineWidth,
                nightModeEnabled,
            },
        });
    }, [
        canRender,
        markers,
        pathOverlays,
        pathCoords,
        pathColor,
        pathWidth,
        pathOutlineColor,
        pathOutlineWidth,
        nightModeEnabled,
        postCommand,
    ]);

    // WebView -> React Native 메시지를 파싱해 탭/줌/초기화 이벤트로 분기한다.
    const onWebViewMessage = useCallback((event: any) => {
        const data = event?.nativeEvent?.data;
        if (!data) return;

        try {
            const message = JSON.parse(data);
            const type = message?.type;

            if (type === "initialized") {
                setIsReady(true);
                setRuntimeErrorMessage(undefined);
                if (webViewRef.current && commandQueueRef.current.length > 0) {
                    commandQueueRef.current.forEach((command) => {
                        webViewRef.current.postMessage(command);
                    });
                    commandQueueRef.current = [];
                }
                onInitialized?.();
                return;
            }

            if (type === "error") {
                const errorMessage = typeof message?.payload?.message === "string"
                    ? message.payload.message
                    : "지도 초기화 중 오류가 발생했습니다.";
                setRuntimeErrorMessage(errorMessage);
                return;
            }

            if (type === "tap") {
                const latitude = safeNumber(message?.payload?.latitude);
                const longitude = safeNumber(message?.payload?.longitude);
                if (typeof latitude === "number" && typeof longitude === "number") {
                    onTapMap?.({ latitude, longitude });
                }
                return;
            }

            if (type === "zoomChanged") {
                const zoom = safeNumber(message?.payload?.zoom);
                if (typeof zoom === "number") {
                    onZoomChanged?.(zoom);
                }
                return;
            }
        } catch {
            // ignore malformed message
        }
    }, [onInitialized, onTapMap, onZoomChanged]);

    // Tmap SDK를 포함한 WebView HTML을 생성한다.
    const html = useMemo(() => {
        if (!appKey) return "";
        const initialZoom = Math.max(5, Math.min(18, Math.round(camera.zoom ?? 12)));
        const initialLat = camera.latitude;
        const initialLng = camera.longitude;
        const showZoomControlFlag = showZoomControls ? "true" : "false";
        const showLocationControlFlag = showLocationButton ? "true" : "false";
        const darkFlag = nightModeEnabled ? "true" : "false";

        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #111827; }
    #mapTone {
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 3000;
      opacity: 0;
      transition: opacity 180ms ease, background 180ms ease;
    }
    #locationBtn {
      position: absolute;
      right: 14px;
      bottom: 88px;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      border: 1px solid rgba(17, 24, 39, 0.2);
      background: rgba(255,255,255,0.95);
      color: #111827;
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 10px rgba(0,0,0,0.18);
      z-index: 1000;
      transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
    }
    #locationBtn.hidden { display: none; }
  </style>
  <script src="https://apis.openapi.sk.com/tmap/jsv2?version=1&appKey=${encodeURIComponent(appKey)}"></script>
</head>
<body>
  <div id="map"></div>
  <div id="mapTone"></div>
  <button id="locationBtn" class="${showLocationControlFlag === "true" ? "" : "hidden"}">◎</button>
  <script>
    (function () {
      var map = null;
      var markers = {};
      var pathLayers = [];
      var pendingData = null;
      var initRetry = 0;
      var isDarkTheme = ${darkFlag};
      var nativeMapTypeCandidates = null;
      var fallbackTileFilter = "invert(0.89) hue-rotate(182deg) saturate(0.72) brightness(0.84) contrast(1.14)";
      var fallbackTileFilterObserver = null;
      var fallbackTileFilterEnabled = false;
      var busBadgeGlyphUri = ${JSON.stringify(BUS_BADGE_GLYPH_URI)};
      var subwayBadgeGlyphUri = ${JSON.stringify(SUBWAY_BADGE_GLYPH_URI)};

      function post(type, payload) {
        if (!window.ReactNativeWebView) return;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload || {} }));
      }

      function toLatLng(point) {
        return new Tmapv2.LatLng(point.latitude, point.longitude);
      }

      function escapeXml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      }

      // 색상 문자열(hex/rgb/rgba)을 alpha가 포함된 rgba 형태로 변환한다.
      function colorWithAlpha(color, alpha) {
        var value = color ? String(color).trim() : "";
        if (!value) return "rgba(248,250,252," + alpha + ")";
        if (value.indexOf("rgba(") === 0) return value.replace(/rgba\(([^)]+)\)/, function (_m, body) {
          var p = body.split(",");
          if (p.length < 3) return value;
          return "rgba(" + p[0].trim() + "," + p[1].trim() + "," + p[2].trim() + "," + alpha + ")";
        });
        if (value.indexOf("rgb(") === 0) return value.replace(/rgb\(([^)]+)\)/, function (_m, body) {
          var p = body.split(",");
          if (p.length < 3) return value;
          return "rgba(" + p[0].trim() + "," + p[1].trim() + "," + p[2].trim() + "," + alpha + ")";
        });
        var hex = value.replace("#", "");
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length !== 6) return value;
        var r = parseInt(hex.slice(0, 2), 16);
        var g = parseInt(hex.slice(2, 4), 16);
        var b = parseInt(hex.slice(4, 6), 16);
        if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return value;
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
      }

      // 출발/도착처럼 "지도 포인트 자체"를 강조할 때 쓰는 핀 렌더러.
      function markerIcon(item) {
        var fill = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var label = item && item.pinLabel ? String(item.pinLabel).trim() : "";
        // 출발/도착 핀 가시성을 위해 기본 크기를 넉넉하게 유지한다.
        var w = label ? 60 : 42;
        var h = label ? 66 : 52;
        var centerX = Math.round(w / 2);
        var textSize = label.length >= 3 ? 10.2 : 11.3;
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            (label
              ? (
                '<ellipse cx="' + centerX + '" cy="62" rx="9.8" ry="3.1" fill="rgba(15,23,42,0.14)" />' +
                '<circle cx="' + centerX + '" cy="24.8" r="16.8" fill="' + fill + '" stroke="#FFFFFF" stroke-width="2.5" />' +
                '<path d="M' + (centerX - 4.2) + ' 38.2 L' + centerX + ' 47.8 L' + (centerX + 4.2) + ' 38.2 Z" fill="' + fill + '" stroke="#FFFFFF" stroke-width="1.9" stroke-linejoin="round" />' +
                '<text x="' + centerX + '" y="28.4" text-anchor="middle" font-size="' + textSize + '" font-family="Arial, sans-serif" font-weight="800" fill="#FFFFFF">' + escapeXml(label) + '</text>'
              )
              : '<path fill="' + fill + '" d="M17 2C12.6 2 9 5.6 9 10c0 5.2 6.1 11 7.4 12.2c.3.3.9.3 1.2 0C18.9 21 25 15.2 25 10c0-4.4-3.6-8-8-8Zm0 11.2c-1.8 0-3.2-1.4-3.2-3.2S15.2 6.8 17 6.8s3.2 1.4 3.2 3.2s-1.4 3.2-3.2 3.2Z"/>') +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
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
            width += 4.2;
          } else if (/[0-9]/.test(ch)) {
            width += 7.1;
          } else if (/[A-Z]/.test(ch)) {
            width += 7.8;
          } else if (/[a-z]/.test(ch)) {
            width += 6.8;
          } else if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)) {
            width += 10.8;
          } else {
            width += 8.2;
          }
        }
        return Math.max(16, Math.round(width));
      }

      // 버스/지하철/환승 캡슐 마커는 텍스트 길이에 따라 폭을 먼저 계산해 둔다.
      function buildBadgeConfig(item) {
        var labelRaw = (item && item.badgeLabel) ? String(item.badgeLabel) : "";
        var label = labelRaw.trim();
        if (!label) label = item && item.caption ? String(item.caption) : "구간";

        var style = item && item.markerStyle ? String(item.markerStyle) : "default";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var textColor = item && item.badgeTextColor ? String(item.badgeTextColor) : "#1F2937";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(148,163,184,0.72)";
        // badgeConnectorColor가 주어지면 배지 하단의 수직 가이드/링 색을 강제로 맞춘다.
        // 주지 않으면 기존 동작(버스는 파랑, 그 외는 accent)을 유지한다.
        var connectorColor = item && item.badgeConnectorColor
          ? String(item.badgeConnectorColor)
          // 정류장/역/환승 배지 아래 포인트는 보행 점선과 다른 역할이다.
          // 기본값을 중립 톤으로 두어 "접근 점선(파랑)"과 "실제 승하차 지점(링)"을 구분한다.
          : ((style === "bus" || style === "subway" || style === "transfer")
            ? "rgba(17,24,39,0.78)"
            : accent);
        var glyph = item && item.badgeGlyph ? String(item.badgeGlyph) : "";
        var hasGlyph = glyph.trim().length > 0 || style === "bus" || style === "subway" || style === "transfer";
        var textWidth = estimateBadgeTextWidth(label);
        // 버스/지하철 배지는 아이콘 영역 + 텍스트 영역을 분리해 폭을 계산한다.
        var iconAreaWidth = hasGlyph
          ? ((style === "bus" || style === "subway") ? 34 : 24)
          : 0;
        var horizontalPadding = style === "default" ? 22 : 26;
        var width = Math.round(textWidth + iconAreaWidth + horizontalPadding);
        var minWidth = style === "default"
          ? 58
          : (style === "bus" ? 100 : style === "subway" ? 100 : 82);
        var maxWidth = style === "default"
          // 버스/지하철 노선명+정류장명 조합을 고려해 상한을 크게 둔다.
          ? 210
          : (style === "bus" ? 360 : style === "subway" ? 340 : 280);
        width = Math.max(minWidth, Math.min(maxWidth, width));
        return {
          width: width,
          height: style === "default" ? 28 : 34,
          label: label,
          accent: accent,
          textColor: textColor,
          borderColor: borderColor,
          connectorColor: connectorColor,
          glyph: glyph,
          hasGlyph: hasGlyph,
          style: style,
        };
      }

      // 승차 정류장, 지하철역, 환승 지점을 네이버 지도 느낌의 캡슐 배지로 렌더링한다.
      function markerBadgeIcon(item) {
        var cfg = buildBadgeConfig(item);
        var label = escapeXml(cfg.label);
        var glyph = escapeXml(cfg.glyph);
        var w = cfg.width;
        var bubbleH = cfg.height;
        var specialStyle = cfg.style === "bus" || cfg.style === "subway" || cfg.style === "transfer";
        var h = specialStyle ? (bubbleH + 15) : (bubbleH + 6);
        var centerY = Math.round(bubbleH / 2);
        var pointerCenterX = Math.round(w / 2);
        var pointerHalfW = 4;
        var iconCenterX = 23;
        // 지도 배경 위에서도 텍스트 대비가 유지되도록 배지 배경을 충분히 불투명하게 둔다.
        var cardFill = specialStyle ? colorWithAlpha(cfg.accent, 0.86) : "#FFFFFF";
        // 배지 경계를 분명하게 보이게 하는 보조 외곽선.
        var cardBorder = specialStyle ? "rgba(15,23,42,0.30)" : cfg.borderColor;
        // 진한 배경색 위 텍스트 가독성을 위한 색/스트로크.
        var labelFill = specialStyle ? "#FFFFFF" : cfg.textColor;
        var labelStroke = specialStyle ? "rgba(15,23,42,0.44)" : "none";
        var connectorColor = cfg.connectorColor || cfg.accent;
        var labelX = cfg.hasGlyph
          ? ((cfg.style === "bus" || cfg.style === "subway") ? 50 : 39)
          : 13;
        var shadow = specialStyle
          ? '<ellipse cx="' + pointerCenterX + '" cy="' + (h - 2.5) + '" rx="5.7" ry="1.8" fill="rgba(15,23,42,0.12)" />'
          : '';
        var iconMarkup = '';
        if (cfg.style === "bus") {
          // 사용자 제공 버스 PNG 아이콘을 사용한다.
          // URI의 특수문자는 XML escape 처리해 SVG 파싱 오류를 막는다.
          var busGlyphHref = busBadgeGlyphUri ? escapeXml(String(busBadgeGlyphUri)) : "";
          var busIconMarkup = busGlyphHref
            ? '<image href="' + busGlyphHref + '" xlink:href="' + busGlyphHref + '" x="' + (iconCenterX - 9.4) + '" y="' + (centerY - 9.4) + '" width="18.8" height="18.8" preserveAspectRatio="xMidYMid meet" />'
            : '<text x="' + iconCenterX + '" y="' + (centerY + 4.2) + '" text-anchor="middle" font-size="9.8" font-family="Arial, sans-serif" font-weight="800" fill="#FFFFFF">버</text>';
          iconMarkup =
            '<rect x="' + (iconCenterX - 10.8) + '" y="' + (centerY - 10.8) + '" width="21.6" height="21.6" rx="6.6" fill="' + colorWithAlpha(cfg.accent, 0.22) + '" stroke="rgba(17,24,39,0.15)" stroke-width="1.0" />' +
            busIconMarkup;
        } else if (cfg.style === "subway") {
          // 사용자 제공 지하철 PNG 아이콘을 사용한다.
          // URI의 특수문자는 XML escape 처리해 SVG 파싱 오류를 막는다.
          var subwayGlyphHref = subwayBadgeGlyphUri ? escapeXml(String(subwayBadgeGlyphUri)) : "";
          var subwayIconMarkup = subwayGlyphHref
            ? '<image href="' + subwayGlyphHref + '" xlink:href="' + subwayGlyphHref + '" x="' + (iconCenterX - 9.4) + '" y="' + (centerY - 9.4) + '" width="18.8" height="18.8" preserveAspectRatio="xMidYMid meet" />'
            : '<text x="' + iconCenterX + '" y="' + (centerY + 4.2) + '" text-anchor="middle" font-size="9.8" font-family="Arial, sans-serif" font-weight="800" fill="#FFFFFF">지</text>';
          iconMarkup =
            '<rect x="' + (iconCenterX - 10.8) + '" y="' + (centerY - 10.8) + '" width="21.6" height="21.6" rx="6.6" fill="' + colorWithAlpha(cfg.accent, 0.22) + '" stroke="rgba(17,24,39,0.15)" stroke-width="1.0" />' +
            subwayIconMarkup;
        } else if (cfg.style === "transfer") {
          iconMarkup =
            '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="10" fill="' + cfg.accent + '" />' +
            '<path d="M11.2 ' + (centerY - 1.4) + ' H20.3 L17.8 ' + (centerY - 3.9) + ' M22.8 ' + (centerY + 1.4) + ' H13.7 L16.2 ' + (centerY + 3.9) + '" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none" />';
        } else {
          iconMarkup = cfg.hasGlyph
            ? '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="8" fill="' + cfg.accent + '" />' +
              '<text x="' + iconCenterX + '" y="' + (centerY + 3) + '" text-anchor="middle" font-size="9" font-family="Arial, sans-serif" font-weight="800" fill="#FFFFFF">' + glyph + '</text>'
            : '';
        }
        var labelText = '<text x="' + labelX + '" y="' + (centerY + 4.2) + '" font-size="11.1" font-family="Arial, sans-serif" font-weight="800" fill="' + labelFill + '" stroke="' + labelStroke + '" stroke-width="' + (specialStyle ? 0.75 : 0) + '" paint-order="stroke fill">' + label + '</text>';
        // bus/subway/transfer 배지는 "수직 가이드 + 하단 링"으로 지점 연결을 표현한다.
        var connectorMarkup = specialStyle
          // 짧고 얇은 스템으로 배지와 지점 연결을 최소 노이즈로 표현한다.
          ? '<path d="M' + pointerCenterX + ' ' + (bubbleH - 0.6) + ' L' + pointerCenterX + ' ' + (bubbleH + 5.6) + '" stroke="' + connectorColor + '" stroke-width="1.15" stroke-linecap="round" />' +
            '<circle cx="' + pointerCenterX + '" cy="' + (bubbleH + 9.2) + '" r="3.4" fill="#FFFFFF" stroke="' + connectorColor + '" stroke-width="1.25" />' +
            '<circle cx="' + pointerCenterX + '" cy="' + (bubbleH + 9.2) + '" r="1.15" fill="' + connectorColor + '" />'
          : '<path d="M' + (pointerCenterX - pointerHalfW) + ' ' + (bubbleH - 1) + ' L' + (pointerCenterX + pointerHalfW) + ' ' + (bubbleH - 1) + ' L' + pointerCenterX + ' ' + (h - 1) + ' Z" fill="' + cardFill + '" stroke="' + cardBorder + '" stroke-width="1.4" stroke-linejoin="round" />';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            shadow +
            '<rect x="1" y="1" width="' + (w - 2) + '" height="' + (bubbleH - 2) + '" rx="15" ry="15" fill="' + cardFill + '" stroke="' + cardBorder + '" stroke-width="1.35" />' +
            iconMarkup +
            labelText +
            connectorMarkup +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
        };
      }

      function markerArrowIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(255,255,255,0.92)";
        var rotation = Number(item && item.rotationDeg);
        if (!isFinite(rotation)) rotation = 0;
        // 진행 방향 화살표는 라인 실루엣을 가리지 않게 작은 보조 힌트 크기로 유지한다.
        var size = 6;
        var center = Math.round(size / 2);
        var groupTransform = 'rotate(' + rotation + ' ' + center + ' ' + center + ')';
        var hasVisibleBorder = borderColor && borderColor !== "transparent" && borderColor !== "rgba(0,0,0,0)";
        var arrowPath = '<path d="M0.7 1.2 L5.3 3 L0.7 4.8 L1.9 3 Z" fill="' + bg + '"' +
          (hasVisibleBorder
            ? ' stroke="' + borderColor + '" stroke-width="0.46" stroke-linejoin="round"'
            : '') +
          ' />';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<g transform="' + groupTransform + '">' +
              arrowPath +
            '</g>' +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: size,
          height: size,
        };
      }

      function markerDotIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(255,255,255,0.95)";
        var rawSize = Number(item && item.dotSize);
        // 도트 점선은 최소/최대 크기 범위를 제한해 줌 변화 시 모양을 안정화한다.
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
      // 다크모드 적용은 \"네이티브 mapType 우선, 실패 시 CSS 필터 fallback\" 순서로 처리한다.
      // Tmap Web SDK는 dark mapType 이름이 런타임마다 달라 보이지만,
      // 지원하지 않는 값을 넣어도 setMapType()이 조용히 통과하는 경우가 있다.
      // 기존 구현처럼 후보를 넓게 추측하면 \"적용 성공\"으로 오판해서 CSS fallback이 꺼지고
      // 결과적으로 지도 타일은 계속 라이트로 남는다.
      // 그래서 아래 로직은:
      // 1) SDK가 실제로 export한 정확한 키만 후보로 사용하고
      // 2) getter로 mapType 변화가 확인될 때만 native theme 성공으로 인정한다.
      // 검증이 불가능하면 false를 반환해 CSS dark fallback을 유지한다.
      function resolveVerifiedNativeMapTypeCandidates() {
        if (nativeMapTypeCandidates) return nativeMapTypeCandidates;

        nativeMapTypeCandidates = {
          light: [],
          dark: [],
        };

        try {
          var mapTypeObj = (window.Tmapv2 && Tmapv2.MapType) ? Tmapv2.MapType : null;
          if (!mapTypeObj || typeof mapTypeObj !== "object") return nativeMapTypeCandidates;

          // 여기서는 "SDK가 실제로 export한 키"만 후보로 쓴다.
          // 추정 문자열까지 섞어 넣으면 setMapType()이 조용히 통과하는 런타임에서
          // dark theme 성공으로 오판할 수 있어서, 후보 집합 자체를 보수적으로 유지한다.
          var appendUniqueCandidate = function (bucket, key) {
            var value = mapTypeObj[key];
            if (value === undefined || value === null) return;
            if (bucket.some(function (candidate) { return String(candidate) === String(value); })) return;
            bucket.push(value);
          };

          ["ROAD", "BASIC", "NORMAL", "DEFAULT", "STANDARD", "BASE", "DAY"].forEach(function (key) {
            appendUniqueCandidate(nativeMapTypeCandidates.light, key);
          });
          ["NIGHT", "NAVI_NIGHT", "MIDNIGHT", "DARK", "BLACK", "DARKMODE"].forEach(function (key) {
            appendUniqueCandidate(nativeMapTypeCandidates.dark, key);
          });
        } catch (_error) {
          nativeMapTypeCandidates = {
            light: [],
            dark: [],
          };
        }

        return nativeMapTypeCandidates;
      }

      // 현재 mapType을 읽어 검증할 수 있는 런타임인지 먼저 확인한다.
      // setter만 있고 getter가 전혀 없으면 "실제로 바뀌었는지"를 증명할 수 없으므로
      // native theme 적용 성공으로 보지 않고 CSS fallback 경로를 유지한다.
      function canInspectMapType() {
        if (!map) return false;
        if (typeof map.getMapType === "function") return true;
        if (typeof map.mapType !== "undefined") return true;
        if (typeof map.mapTypeId !== "undefined") return true;
        return false;
      }

      function readCurrentMapType() {
        if (!map) return undefined;

        try {
          // SDK 버전에 따라 노출하는 getter/field 이름이 달라서 읽기 경로를 순서대로 시도한다.
          if (typeof map.getMapType === "function") {
            return map.getMapType();
          }
          if (typeof map.mapType !== "undefined") {
            return map.mapType;
          }
          if (typeof map.mapTypeId !== "undefined") {
            return map.mapTypeId;
          }
        } catch (_error) {}

        return undefined;
      }

      function isSameMapTypeValue(left, right) {
        if (left === right) return true;
        if (left === undefined || left === null || right === undefined || right === null) return false;
        return String(left) === String(right);
      }

      function trySetVerifiedMapType(candidates) {
        if (!map || !map.setMapType || !Array.isArray(candidates) || candidates.length === 0 || !canInspectMapType()) {
          return false;
        }

        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          var before = readCurrentMapType();

          try {
            map.setMapType(candidate);
            var after = readCurrentMapType();
            // setter 호출 직후에도 값을 읽지 못하면 "적용 여부를 입증할 수 없는 상태"다.
            // 이런 경우는 성공으로 치지 않고 다음 후보를 보거나 fallback으로 넘긴다.
            if (after === undefined || after === null) {
              continue;
            }
            // 1) getter가 후보 값을 그대로 돌려주거나
            // 2) before/after 값이 명확히 달라져 실제 변경이 관측될 때만
            // native mapType 적용이 성공했다고 판정한다.
            if (isSameMapTypeValue(after, candidate)) {
              return true;
            }
            if (before !== undefined && before !== null && !isSameMapTypeValue(before, after)) {
              return true;
            }
          } catch (_error) {
            // 다음 후보를 확인한다.
          }
        }

        return false;
      }

      function resolveVerifiedNativeThemeApplied(isDark) {
        var candidates = resolveVerifiedNativeMapTypeCandidates();
        if (isDark) {
          return trySetVerifiedMapType(candidates.dark);
        }
        // 라이트 모드는 대부분의 런타임에서 기본 상태다.
        // 전용 light mapType 상수가 없어도 굳이 실패로 볼 필요가 없고,
        // false를 반환하면 라이트 모드에서 불필요한 fallback tint가 깔릴 수 있으므로
        // 이런 경우는 "이미 정상 상태"로 간주한다.
        if (!Array.isArray(candidates.light) || candidates.light.length === 0) {
          return true;
        }
        return trySetVerifiedMapType(candidates.light);
      }

      function isFallbackTileImage(imgEl) {
        if (!imgEl || !imgEl.getAttribute) return false;
        var src = "";
        try {
          src = String(imgEl.getAttribute("src") || imgEl.src || "");
        } catch (_error) {
          return false;
        }
        if (!src) return false;
        // 우리가 만든 badge/arrow/dot marker는 data URI SVG라서,
        // 타일 dark filter가 여기에까지 걸리면 흰 배지가 검게 반전되고
        // 작은 화살표 외곽도 탁해져서 사용자 스크린샷처럼 깨진 인상으로 보인다.
        if (/^(data|blob):/i.test(src)) return false;
        return true;
      }

      function syncFallbackTileFilter() {
        var mapEl = document.getElementById("map");
        if (!mapEl || !mapEl.querySelectorAll) return;
        var imgNodes = mapEl.querySelectorAll("img");
        for (var index = 0; index < imgNodes.length; index += 1) {
          var imgEl = imgNodes[index];
          if (!imgEl || !imgEl.style) continue;
          if (!isFallbackTileImage(imgEl)) {
            imgEl.style.filter = "none";
            imgEl.style.transition = "";
            continue;
          }
          // fallback dark mode는 "지도 타일을 어둡게 보정"하는 용도다.
          // 팬/줌 때 타일 img가 자주 갈아끼워지므로 observer와 함께 매번 다시 적용해,
          // 새 타일만 밝게 남는 현상 없이 기본 지도 톤만 안정적으로 유지한다.
          imgEl.style.filter = fallbackTileFilterEnabled ? fallbackTileFilter : "none";
          imgEl.style.transition = "filter 180ms ease";
        }
      }

      function bindFallbackTileFilterObserver() {
        var mapEl = document.getElementById("map");
        if (!mapEl || typeof MutationObserver === "undefined") return;
        if (fallbackTileFilterObserver) {
          fallbackTileFilterObserver.disconnect();
          fallbackTileFilterObserver = null;
        }
        // Tmap은 이동/확대 때 타일 DOM을 계속 교체한다.
        // 그래서 테마 적용을 한 번만 해두면 이후에 로드된 타일은 다시 밝아질 수 있어서,
        // map 내부 변경을 감지할 때마다 tile filter를 재동기화한다.
        fallbackTileFilterObserver = new MutationObserver(function () {
          syncFallbackTileFilter();
        });
        fallbackTileFilterObserver.observe(mapEl, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"],
        });
        syncFallbackTileFilter();
      }

      function applyTheme(isDark) {
        isDarkTheme = !!isDark;
        var mapEl = document.getElementById("map");
        var toneEl = document.getElementById("mapTone");
        var locationBtn = document.getElementById("locationBtn");
        var nativeThemeApplied = false;

        // 지도는 "SDK가 후보를 받았다"가 아니라 "실제로 mapType이 바뀐 증거가 있다"일 때만
        // native theme 적용 성공으로 본다.
        // 증거가 없으면 의도적으로 CSS fallback을 유지해서,
        // 다크 UI 안에 밝은 타일 지도가 끼어드는 회귀를 막는다.
        nativeThemeApplied = resolveVerifiedNativeThemeApplied(isDarkTheme);

        if (mapEl) {
          // #map 전체를 뒤집으면 base tile만 아니라 marker svg도 함께 반전된다.
          // 그 결과 버스 배지는 검은 캡슐처럼 보이고, 화살표도 흐릿하게 깨져 보이므로
          // 컨테이너 filter는 비우고 tile img에만 fallback dark filter를 분리 적용한다.
          mapEl.style.filter = "none";
          mapEl.style.transition = "none";
        }

        fallbackTileFilterEnabled = isDarkTheme && !nativeThemeApplied;
        syncFallbackTileFilter();

        if (toneEl) {
          toneEl.style.background = isDarkTheme
            ? "radial-gradient(circle at 20% 12%, rgba(96,165,250,0.08), rgba(15,23,42,0.18) 58%, rgba(2,6,23,0.36) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.03))";
          toneEl.style.opacity = (isDarkTheme && !nativeThemeApplied) ? "0.72" : "0";
        }

        document.body.style.backgroundColor = isDarkTheme ? "#0B1220" : "#F3F4F6";

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

      function clearMarkers() {
        Object.keys(markers).forEach(function (key) {
          var marker = markers[key];
          if (marker && marker.setMap) marker.setMap(null);
        });
        markers = {};
      }

      // React 쪽 marker 모델(displayType / markerStyle)을 실제 Tmap Marker/SVG로 변환해 배치한다.
      function renderMarkers(markerItems) {
        if (!map) return;
        clearMarkers();
        // zIndex 낮은 순으로 생성해 고우선순위 마커(출발/도착)가 마지막에 그려지게 한다.
        var sortedItems = Array.isArray(markerItems) ? markerItems.slice() : [];
        sortedItems.sort(function (a, b) {
          var az = Number(a && a.zIndex);
          var bz = Number(b && b.zIndex);
          if (!isFinite(az)) az = 0;
          if (!isFinite(bz)) bz = 0;
          return az - bz;
        });
        sortedItems.forEach(function (item) {
          var displayType = item && item.displayType ? String(item.displayType) : "pin";
          var isBadge = displayType === "badge";
          var isArrow = displayType === "arrow";
          var isDot = displayType === "dot";
          // 아이콘 생성 실패 시 기본 pin 아이콘으로 fallback 한다.
          var iconInfo = null;
          try {
            iconInfo = isBadge
              ? markerBadgeIcon(item)
              : isArrow
                ? markerArrowIcon(item)
                : isDot
                  ? markerDotIcon(item)
                : markerIcon(item);
          } catch (_iconError) {
            try {
              iconInfo = markerIcon(item);
            } catch (_fallbackIconError) {
              return;
            }
          }

          var markerOption = {
            position: toLatLng(item),
            icon: iconInfo.uri,
            iconSize: new Tmapv2.Size(iconInfo.width, iconInfo.height),
            title: item.caption || "",
            map: map,
          };
          var markerZIndex = Number(item && item.zIndex);
          if (!isFinite(markerZIndex)) markerZIndex = undefined;

          if (window.Tmapv2 && Tmapv2.Point) {
            try {
              var markerStyle = item && item.markerStyle ? String(item.markerStyle) : "default";
              var isFloatingBadge = isBadge && (markerStyle === "bus" || markerStyle === "subway" || markerStyle === "transfer");
              markerOption.iconAnchor = isBadge
                ? new Tmapv2.Point(Math.round(iconInfo.width / 2), isFloatingBadge ? (iconInfo.height - 6) : iconInfo.height)
                : isArrow
                  ? new Tmapv2.Point(Math.round(iconInfo.width / 2), Math.round(iconInfo.height / 2))
                  : isDot
                    ? new Tmapv2.Point(Math.round(iconInfo.width / 2), Math.round(iconInfo.height / 2))
                  : new Tmapv2.Point(Math.round(iconInfo.width / 2), iconInfo.height);
            } catch (_error) {}
          }

          try {
            var marker = new Tmapv2.Marker({
              position: markerOption.position,
              icon: markerOption.icon,
              iconSize: markerOption.iconSize,
              title: markerOption.title,
              map: markerOption.map,
              iconAnchor: markerOption.iconAnchor,
            });
            if (isFinite(markerZIndex) && marker && typeof marker.setZIndex === "function") {
              try {
                marker.setZIndex(markerZIndex);
              } catch (_error) {}
            }
            markers[item.id] = marker;
          } catch (_markerError) {
            // 개별 마커 생성 실패는 무시하고 다음 마커 렌더를 계속 진행한다.
          }
        });
      }

      function clearPaths() {
        pathLayers.forEach(function (layer) {
          if (layer.line && layer.line.setMap) layer.line.setMap(null);
          if (layer.outline && layer.outline.setMap) layer.outline.setMap(null);
        });
        pathLayers = [];
      }

      // 모든 안내선은 outline + main stroke 2중 레이어로 그려서 밝은 지도에서도 또렷하게 보이게 한다.
      function renderPath(pathCoords, color, width, outlineColor, outlineWidth) {
        if (!map) return;
        if (!Array.isArray(pathCoords) || pathCoords.length < 2) return;

        var path = pathCoords.map(function (point) { return toLatLng(point); });
        var outlineLayer = null;
        var lineLayer = null;

        if (outlineWidth > 0) {
          outlineLayer = new Tmapv2.Polyline({
            path: path,
            strokeColor: outlineColor,
            strokeWeight: width + (outlineWidth * 2),
            lineCap: "round",
            lineJoin: "round",
            map: map,
          });
        }

        lineLayer = new Tmapv2.Polyline({
          path: path,
          strokeColor: color,
          strokeWeight: width,
          lineCap: "round",
          lineJoin: "round",
          map: map,
        });

        pathLayers.push({
          outline: outlineLayer,
          line: lineLayer,
        });
      }

      function inferZoomByDelta(latDelta, lngDelta) {
        var maxDelta = Math.max(latDelta || 0, lngDelta || 0);
        if (maxDelta > 2.2) return 8;
        if (maxDelta > 1.1) return 9;
        if (maxDelta > 0.65) return 10;
        if (maxDelta > 0.35) return 11;
        if (maxDelta > 0.18) return 12;
        if (maxDelta > 0.09) return 13;
        if (maxDelta > 0.045) return 14;
        if (maxDelta > 0.022) return 15;
        return 16;
      }

      // camera 이동은 확대 레벨 포함 단일 지점 포커스용.
      function setCamera(payload) {
        if (!map || !payload) return;
        var lat = Number(payload.latitude);
        var lng = Number(payload.longitude);
        if (!isFinite(lat) || !isFinite(lng)) return;
        map.setCenter(new Tmapv2.LatLng(lat, lng));
        if (isFinite(Number(payload.zoom))) {
          map.setZoom(Math.max(5, Math.min(18, Math.round(Number(payload.zoom)))));
        }
        emitZoomChanged();
      }

      // region 이동은 경로 전체를 한 화면에 담는 fit 동작용.
      function setRegion(payload) {
        if (!payload) return;
        var lat = Number(payload.latitude);
        var lng = Number(payload.longitude);
        var latDelta = Number(payload.latitudeDelta);
        var lngDelta = Number(payload.longitudeDelta);
        if (!isFinite(lat) || !isFinite(lng)) return;
        var centerLat = isFinite(latDelta) ? lat + (latDelta / 2) : lat;
        var centerLng = isFinite(lngDelta) ? lng + (lngDelta / 2) : lng;
        setCamera({
          latitude: centerLat,
          longitude: centerLng,
          zoom: inferZoomByDelta(latDelta, lngDelta),
        });
      }

      // 경로 전체 bounds fit용 보조 함수. SDK의 panToBounds가 실패하면 center/zoom 계산으로 fallback 한다.
      function fitBounds(payload) {
        if (!map || !payload || !Array.isArray(payload.coords) || payload.coords.length < 2) return;
        var bounds = new Tmapv2.LatLngBounds();
        var minLat = 90;
        var maxLat = -90;
        var minLng = 180;
        var maxLng = -180;
        payload.coords.forEach(function (coord) {
          var lat = Number(coord.latitude);
          var lng = Number(coord.longitude);
          if (!isFinite(lat) || !isFinite(lng)) return;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          bounds.extend(new Tmapv2.LatLng(lat, lng));
        });

        try {
          map.panToBounds(bounds);
          setTimeout(function () { emitZoomChanged(); }, 50);
        } catch (_error) {
          var centerLat = (minLat + maxLat) / 2;
          var centerLng = (minLng + maxLng) / 2;
          setCamera({
            latitude: centerLat,
            longitude: centerLng,
            zoom: inferZoomByDelta(maxLat - minLat, maxLng - minLng),
          });
        }
      }

      function zoomBy(payload) {
        if (!map || !payload) return;
        var delta = Number(payload.delta);
        if (!isFinite(delta) || delta === 0) return;

        var currentZoom = NaN;
        try {
          currentZoom = numberFromUnknown(map.getZoom ? map.getZoom() : map.zoom);
        } catch (_error) {}
        if (!isFinite(currentZoom)) {
          currentZoom = ${initialZoom};
        }

        var nextZoom = Math.max(5, Math.min(18, Math.round(currentZoom + delta)));
        try {
          map.setZoom(nextZoom);
          emitZoomChanged();
        } catch (_error) {}
      }

      function emitZoomChanged() {
        if (!map) return;
        var zoom = NaN;
        try {
          zoom = numberFromUnknown(map.getZoom ? map.getZoom() : map.zoom);
        } catch (_error) {}
        if (!isFinite(zoom)) return;
        post("zoomChanged", { zoom: zoom });
      }

      function applyData(payload) {
        if (!map) {
          pendingData = payload;
          return;
        }
        if (typeof payload.nightModeEnabled === "boolean") {
          applyTheme(payload.nightModeEnabled);
        }
        var markerItems = Array.isArray(payload.markers) ? payload.markers : [];
        renderMarkers(markerItems);
        clearPaths();

        var overlayItems = Array.isArray(payload.pathOverlays) ? payload.pathOverlays : [];
        if (overlayItems.length > 0) {
          overlayItems.forEach(function (overlay) {
            renderPath(
              Array.isArray(overlay.coords) ? overlay.coords : [],
              overlay.color || "#1D72FF",
              Number(overlay.width) || 10,
              overlay.outlineColor || "#FFFFFF",
              Number(overlay.outlineWidth) || 2.5
            );
          });
          return;
        }

        renderPath(
          Array.isArray(payload.pathCoords) ? payload.pathCoords : [],
          payload.pathColor || "#1D72FF",
          Number(payload.pathWidth) || 10,
          payload.pathOutlineColor || "#FFFFFF",
          Number(payload.pathOutlineWidth) || 3
        );
      }

      function numberFromUnknown(value) {
        if (typeof value === "number") return isFinite(value) ? value : NaN;
        if (typeof value === "string") {
          var parsed = Number(value);
          return isFinite(parsed) ? parsed : NaN;
        }
        if (typeof value === "function") {
          try {
            var fnResult = value();
            var parsedFn = Number(fnResult);
            return isFinite(parsedFn) ? parsedFn : NaN;
          } catch (_error) {
            return NaN;
          }
        }
        return NaN;
      }

      function parseTapLatLng(eventObj) {
        if (!eventObj || typeof eventObj !== "object") return null;

        var latLng =
          eventObj.latLng ||
          eventObj.latlng ||
          eventObj.coordinate ||
          eventObj.coord ||
          eventObj.position ||
          eventObj._latLng ||
          null;

        var lat = NaN;
        var lng = NaN;

        if (latLng) {
          lat = numberFromUnknown(latLng._lat);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.lat);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.latitude);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.getLat);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.getLatitude);

          lng = numberFromUnknown(latLng._lng);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.lng);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.longitude);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.getLng);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.getLongitude);
        }

        if (!isFinite(lat)) lat = numberFromUnknown(eventObj.lat);
        if (!isFinite(lat)) lat = numberFromUnknown(eventObj.latitude);
        if (!isFinite(lng)) lng = numberFromUnknown(eventObj.lng);
        if (!isFinite(lng)) lng = numberFromUnknown(eventObj.longitude);

        if (!isFinite(lat) || !isFinite(lng)) return null;
        return { latitude: lat, longitude: lng };
      }

      // 지도 탭 좌표를 React Native 쪽으로 다시 올려, 출발/도착 직접 지정 같은 상호작용에 사용한다.
      function bindMapTap() {
        if (!map) return;
        var tapHandler = function (eventObj) {
          var parsed = parseTapLatLng(eventObj);
          if (parsed) post("tap", parsed);
        };

        try {
          if (map.addListener) {
            map.addListener("click", tapHandler);
            map.addListener("tap", tapHandler);
            map.addListener("touchend", tapHandler);
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
            Tmapv2.events.addListener(map, "click", tapHandler);
            Tmapv2.events.addListener(map, "tap", tapHandler);
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
            Tmapv2.Event.addListener(map, "click", tapHandler);
            Tmapv2.Event.addListener(map, "tap", tapHandler);
          }
        } catch (_error) {}
      }

      // 현재 zoom 변화를 React 상태로 다시 보내 route-planner가 안내선/마커 레벨을 바꿀 수 있게 한다.
      function bindMapZoom() {
        if (!map) return;
        var zoomHandler = function () {
          emitZoomChanged();
        };

        try {
          if (map.addListener) {
            map.addListener("zoom_changed", zoomHandler);
            map.addListener("zoomend", zoomHandler);
            map.addListener("moveend", zoomHandler);
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
            Tmapv2.events.addListener(map, "zoom_changed", zoomHandler);
            Tmapv2.events.addListener(map, "zoomend", zoomHandler);
            Tmapv2.events.addListener(map, "moveend", zoomHandler);
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
            Tmapv2.Event.addListener(map, "zoom_changed", zoomHandler);
            Tmapv2.Event.addListener(map, "zoomend", zoomHandler);
            Tmapv2.Event.addListener(map, "moveend", zoomHandler);
          }
        } catch (_error) {}
      }

      // 현재 위치 버튼은 WebView 안에서 직접 geolocation을 호출해 지도 중심만 이동시킨다.
      function goToCurrentLocation() {
        if (!navigator.geolocation || !map) return;
        navigator.geolocation.getCurrentPosition(
          function (position) {
            var lat = Number(position.coords.latitude);
            var lng = Number(position.coords.longitude);
            if (!isFinite(lat) || !isFinite(lng)) return;
            map.setCenter(new Tmapv2.LatLng(lat, lng));
            map.setZoom(Math.max(14, map.getZoom ? map.getZoom() : 14));
          },
          function () {},
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
        );
      }

      // 실제 Tmap 인스턴스를 만들고 테마/이벤트/초기 data를 붙이는 지도 초기화 루틴.
      function initMap() {
        if (!window.Tmapv2 || !window.Tmapv2.Map) {
          initRetry += 1;
          if (initRetry > 40) {
            post("error", { message: "Tmap JS SDK 로딩 실패: 앱키 또는 네트워크/권한 설정을 확인해 주세요." });
            return;
          }
          setTimeout(initMap, 220);
          return;
        }

        map = new Tmapv2.Map("map", {
          center: new Tmapv2.LatLng(${initialLat}, ${initialLng}),
          width: "100%",
          height: "100%",
          zoom: ${initialZoom},
          zoomControl: ${showZoomControlFlag},
          scrollwheel: true,
        });

        bindFallbackTileFilterObserver();
        applyTheme(isDarkTheme);

        bindMapTap();
        bindMapZoom();

        var locationBtn = document.getElementById("locationBtn");
        if (locationBtn) {
          locationBtn.onclick = goToCurrentLocation;
        }

        if (pendingData) {
          applyData(pendingData);
          pendingData = null;
        }

        post("initialized", {});
        emitZoomChanged();
      }

      function onCommand(rawData) {
        if (!rawData) return;
        var parsed;
        try {
          parsed = JSON.parse(rawData);
        } catch (_error) {
          return;
        }
        var type = parsed.type;
        var payload = parsed.payload || {};

        if (type === "setData") {
          applyData(payload);
          return;
        }
        if (type === "animateCamera") {
          setCamera(payload);
          return;
        }
        if (type === "animateRegion") {
          setRegion(payload);
          return;
        }
        if (type === "fitBounds") {
          fitBounds(payload);
          return;
        }
        if (type === "zoomBy") {
          zoomBy(payload);
        }
      }

      document.addEventListener("message", function (event) {
        onCommand(event && event.data);
      });
      window.addEventListener("message", function (event) {
        onCommand(event && event.data);
      });
      window.addEventListener("error", function (event) {
        var message = (event && event.message) ? String(event.message) : "스크립트 오류";
        post("error", { message: message });
      });

      initMap();
    })();
  </script>
</body>
</html>`;
    }, [
        appKey,
        camera.latitude,
        camera.longitude,
        camera.zoom,
        nightModeEnabled,
        showLocationButton,
        showZoomControls,
    ]);

    if (!canRender) {
        const missingReason = !hasWebView
            ? "Tmap 지도를 렌더링하려면 react-native-webview가 필요합니다."
            : "Tmap API 키가 없습니다. EXPO_PUBLIC_TMAP_APP_KEY를 설정해 주세요.";
        return (
            <View style={[styles.fallback, { backgroundColor: fallbackBackgroundColor }, style]}>
                <Text style={[styles.fallbackText, { color: fallbackTextColor }]}>
                    {missingReason}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, style]}>
            <WebView
                ref={webViewRef}
                originWhitelist={["*"]}
                source={{ html }}
                onMessage={onWebViewMessage}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                allowFileAccess={true}
                setSupportMultipleWindows={false}
                mixedContentMode="always"
                style={styles.webview}
            />
            {!!runtimeErrorMessage && (
                <View style={styles.errorOverlay}>
                    <Text style={styles.errorOverlayTitle}>지도 로딩 실패</Text>
                    <Text style={styles.errorOverlayText}>{runtimeErrorMessage}</Text>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    webview: {
        flex: 1,
        backgroundColor: "transparent",
    },
    fallback: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    fallbackText: {
        textAlign: "center",
        fontSize: 12,
        lineHeight: 18,
    },
    errorOverlay: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: "rgba(17, 24, 39, 0.86)",
    },
    errorOverlayTitle: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 12,
        marginBottom: 4,
    },
    errorOverlayText: {
        color: "rgba(255, 255, 255, 0.88)",
        fontSize: 11,
        lineHeight: 15,
    },
});

export default TmapMapView;
