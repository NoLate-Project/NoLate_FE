import { isRouteInfo, type RouteInfo } from "./routeInfo";
import type { RoutePlannerPayload } from "./routePlannerSession";
import {
    hasPersistableScheduleRoute,
    reconcileScheduleRouteTiming,
} from "./scheduleRouteTiming";
import type {
    Place,
    ScheduleCategory,
    ScheduleItem,
    ScheduleParseResult,
    QuickScheduleReliabilityFeedback,
    TravelMode,
} from "./types";

export type QuickSchedulePreviewField =
    | "title"
    | "date"
    | "time"
    | "location"
    | "notification"
    | "memo";

export type QuickSchedulePreviewDraft = {
    title: string;
    date: string;
    time: string;
    /** 파서가 명시적인 종료 시각을 준 경우 시작 시각을 바꿔도 원래 길이를 보존한다. */
    durationMinutes: number;
    hasExplicitEndTime: boolean;
    location: string;
    origin?: Place;
    destination?: Place;
    travelMode?: TravelMode;
    travelMinutes?: number;
    route?: unknown;
    departAt?: string;
    notificationLeadMinutes?: number;
    memo: string;
    badges: Partial<Record<QuickSchedulePreviewField, string>>;
    parsed?: ScheduleParseResult;
    verification?: QuickScheduleVerificationState;
};

export type QuickScheduleVerifiedField = "date" | "time" | "destination";
export type QuickScheduleVerificationStatus = "USER_CONFIRMED" | "USER_CORRECTED";
export type QuickScheduleVerificationState = {
    requiredFields: QuickScheduleVerifiedField[];
    fields: Partial<Record<QuickScheduleVerifiedField, QuickScheduleVerificationStatus>>;
    globalRequired: boolean;
    globalConfirmed: boolean;
};

export type QuickScheduleBlockingReviewField = "date" | "time" | "location" | "review";

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_UNCONFIRMED_TIME = "19:00";

function getUsableQuickScheduleConfidence(
    confidence: ScheduleParseResult["confidence"]
): ScheduleParseResult["confidence"] | undefined {
    if (!confidence || !["HIGH", "MEDIUM", "REVIEW"].includes(confidence.level)) {
        return undefined;
    }
    const fields = confidence.fields;
    if (!fields) return undefined;
    const values = [
        confidence.overall,
        fields.date,
        fields.time,
        fields.destination,
    ];
    if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
        return undefined;
    }
    // 구버전 서버/네이티브가 만든 전 필드 0은 실제 측정 결과가 아니라 미제공 sentinel이다.
    if (values.every((value) => value === 0)) return undefined;

    const recognition = confidence.recognition;
    if (recognition === undefined) return confidence;
    if (!Number.isFinite(recognition) || recognition <= 0 || recognition > 1) {
        return { ...confidence, recognition: undefined };
    }
    return confidence;
}

function pad2(value: number) {
    return String(value).padStart(2, "0");
}

function toYmd(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toHm(date: Date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function isValidQuickScheduleDate(value: string | null | undefined): value is string {
    const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(0);
    candidate.setFullYear(year, month - 1, day);
    candidate.setHours(0, 0, 0, 0);

    return candidate.getFullYear() === year
        && candidate.getMonth() === month - 1
        && candidate.getDate() === day;
}

export function isValidQuickScheduleTime(value: string | null | undefined): value is string {
    const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function quickScheduleDateFromDraftTime(ymd: string, hm: string) {
    const [year, month, day] = ymd.split("-").map(Number);
    const [hours, minutes] = hm.split(":").map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) return null;

    // Date는 2026-02-30 같은 입력을 3월로 보정한다. 원문에 날짜/시간이 있으면
    // 먼저 각 필드 자체를 검증해 잘못된 파서 값을 조용히 저장하지 않는다.
    const localFields = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (localFields && (
        !isValidQuickScheduleDate(localFields[1])
        || !isValidQuickScheduleTime(localFields[2])
    )) {
        return null;
    }

    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function includesAny(values: string[], needles: string[]) {
    const normalized = values.join(" ").toLowerCase();
    return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

export function displayQuickSchedulePlaceName(place?: { name?: string; address?: string }) {
    return place?.name?.trim() || place?.address?.trim() || "";
}

export function quickSchedulePlaceFromLocation(location: string): Place | undefined {
    const normalized = location.trim();
    if (!normalized || normalized === "장소 미정") return undefined;
    return { name: normalized };
}

function isValidCoordinate(value: unknown, min: number, max: number) {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function hasValidCoordinates(place: Place | undefined) {
    return !!place
        && isValidCoordinate(place.lat, -90, 90)
        && isValidCoordinate(place.lng, -180, 180);
}

function hasValidRouteTimes(routeInfo: RouteInfo) {
    const departureAt = new Date(routeInfo.departureTime);
    const arrivalAt = new Date(routeInfo.arrivalTime);
    return Number.isFinite(departureAt.getTime())
        && Number.isFinite(arrivalAt.getTime())
        && arrivalAt.getTime() >= departureAt.getTime();
}

export function getQuickSchedulePreviewRouteInfo(
    draft: QuickSchedulePreviewDraft | null | undefined
): RouteInfo | undefined {
    if (!draft) return undefined;
    if (isRouteInfo(draft.route)) return draft.route;

    const routeObject = draft.route as Record<string, unknown> | null | undefined;
    return isRouteInfo(routeObject?.routeInfo) ? routeObject.routeInfo : undefined;
}

export function isQuickScheduleRouteReady(
    draft: QuickSchedulePreviewDraft | null | undefined
) {
    if (!draft || !draft.travelMode) return false;

    const destination = draft.destination ?? quickSchedulePlaceFromLocation(draft.location);
    const routeInfo = getQuickSchedulePreviewRouteInfo(draft);
    return hasValidCoordinates(draft.origin)
        && hasValidCoordinates(destination)
        && !!routeInfo
        && routeInfo.totalDurationMinutes > 0
        && hasPersistableScheduleRoute(
            draft.route,
            draft.travelMinutes,
            draft.origin,
            destination
        )
        && hasValidRouteTimes(routeInfo);
}

function getExplicitDurationMinutes(startAt: Date | null, endAtValue?: string) {
    const endAt = parseIsoDate(endAtValue);
    if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
        return null;
    }

    const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
    if (durationMinutes <= 0 || durationMinutes > 7 * 24 * 60) return null;
    return durationMinutes;
}

export function buildQuickSchedulePreviewDraft(
    parsed: ScheduleParseResult,
    fallbackText: string,
    referenceDay: string
): QuickSchedulePreviewDraft {
    const parsedStartAt = parseIsoDate(parsed.startAt);
    const parsedDate = parsed.date?.trim();
    const parsedTime = parsed.time?.trim();
    const validParsedDate = isValidQuickScheduleDate(parsedDate) ? parsedDate : undefined;
    const validParsedTime = isValidQuickScheduleTime(parsedTime)
        ? `${pad2(Number(parsedTime.split(":")[0]))}:${parsedTime.split(":")[1]}`
        : undefined;
    const safeReferenceDay = isValidQuickScheduleDate(referenceDay)
        ? referenceDay
        : toYmd(new Date());
    const missingFields = parsed.missingFields ?? [];
    const warnings = parsed.warnings ?? [];
    const confidence = getUsableQuickScheduleConfidence(parsed.confidence);
    // 수치 점수는 참고 정보다. 실제 missing/warning이 있을 때만 해당 필드 확인을 요구한다.
    const reviewSignals = [...missingFields, ...warnings];
    const dateMentioned = includesAny(reviewSignals, ["date", "day", "날짜", "요일"]);
    const timeMentioned = includesAny(reviewSignals, ["time", "hour", "시간", "시각", "오전", "오후", "am", "pm"]);
    const locationMentioned = includesAny(reviewSignals, [
        "place",
        "location",
        "destination",
        "장소",
        "위치",
        "목적지",
    ]);
    const destinationText = displayQuickSchedulePlaceName(parsed.destination);
    const date = parsedStartAt ? toYmd(parsedStartAt) : validParsedDate ?? safeReferenceDay;
    const time = parsedStartAt ? toHm(parsedStartAt) : validParsedTime ?? DEFAULT_UNCONFIRMED_TIME;
    // Legacy parser responses always included a generated default `endAt` but did
    // not expose its origin. Missing flags therefore fall back to false; inferring
    // from endAt alone would turn every one-hour default into a user-selected end.
    const parserMarkedExplicitEnd = parsed.hasExplicitEndTime ?? false;
    const explicitDurationMinutes = parserMarkedExplicitEnd
        ? getExplicitDurationMinutes(parsedStartAt, parsed.endAt)
        : null;
    const parsedTitleTime = parsedStartAt ? toHm(parsedStartAt) : validParsedTime;
    const defaultTitle = [parsedTitleTime, destinationText]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(" ");
    const badges: QuickSchedulePreviewDraft["badges"] = {};
    if (dateMentioned) {
        badges.date = "날짜 확인 필요";
    } else if (!parsedStartAt && !validParsedDate) {
        badges.date = "날짜 미확정";
    }

    if (timeMentioned) {
        badges.time = "시간 확인 필요";
    } else if (!parsedStartAt && !validParsedTime) {
        badges.time = "시간 미확정";
    }

    if (!destinationText || locationMentioned) {
        badges.location = "장소 확인 필요";
    }

    const requiredFields = [
        ...(badges.date ? ["date" as const] : []),
        ...(badges.time ? ["time" as const] : []),
        ...(badges.location ? ["destination" as const] : []),
    ];
    const globalReviewRequired = parsed.needsReview
        && warnings.length > 0
        && requiredFields.length === 0;

    const draft: QuickSchedulePreviewDraft = {
        title: parsed.title?.trim()
            || defaultTitle
            || fallbackText.split(/\n|,/)[0]?.trim()
            || "새 일정",
        date,
        time,
        durationMinutes: explicitDurationMinutes ?? DEFAULT_DURATION_MINUTES,
        hasExplicitEndTime: parserMarkedExplicitEnd && explicitDurationMinutes !== null,
        location: destinationText || "장소 미정",
        origin: parsed.origin,
        destination: parsed.destination,
        travelMode: parsed.travelMode,
        travelMinutes: parsed.travelMinutes,
        route: parsed.route,
        notificationLeadMinutes: parsed.notificationEnabled
            ? parsed.notificationLeadMinutes ?? 30
            : undefined,
        memo: parsed.notes?.trim() || "메모 없음",
        badges,
        parsed: confidence === parsed.confidence
            ? parsed
            : { ...parsed, confidence },
        verification: {
            requiredFields,
            fields: {},
            globalRequired: globalReviewRequired,
            globalConfirmed: false,
        },
    };

    if (!isQuickScheduleRouteReady(draft)) {
        draft.notificationLeadMinutes = undefined;
        badges.notification = "선택 설정";
    } else {
        draft.departAt = getQuickSchedulePreviewRouteInfo(draft)?.departureTime;
        if (!parsed.notificationEnabled) {
            badges.notification = "알림 미설정";
        }
    }

    if (
        parsed.needsReview
        && warnings.length > 0
        && !dateMentioned
        && !timeMentioned
        && !locationMentioned
        && !badges.date
        && !badges.time
        && !badges.location
    ) {
        badges.title = "내용 확인 필요";
    }

    return draft;
}

export function getQuickScheduleBlockingReviewField(
    draft: QuickSchedulePreviewDraft | null | undefined
): QuickScheduleBlockingReviewField | null {
    if (!draft) return null;
    if (draft.badges.date || !isValidQuickScheduleDate(draft.date)) return "date";
    if (draft.badges.time || !isValidQuickScheduleTime(draft.time)) return "time";
    if (draft.badges.location || !displayQuickSchedulePlaceName(draft.destination)) return "location";
    if (!draft.parsed?.confidence && !draft.verification) return "review";
    if (
        draft.verification?.globalRequired
        && !draft.verification.globalConfirmed
    ) return "review";
    return null;
}

function markQuickScheduleFieldVerified(
    draft: QuickSchedulePreviewDraft,
    field: QuickScheduleVerifiedField,
    status: QuickScheduleVerificationStatus
): QuickScheduleVerificationState {
    const current = draft.verification ?? {
        requiredFields: [],
        fields: {},
        globalRequired: !!draft.parsed?.needsReview,
        globalConfirmed: false,
    };
    return {
        ...current,
        fields: { ...current.fields, [field]: status },
    };
}

export function confirmQuickScheduleGlobalReview(
    draft: QuickSchedulePreviewDraft
): QuickSchedulePreviewDraft {
    const current = draft.verification ?? {
        requiredFields: [],
        fields: {},
        globalRequired: true,
        globalConfirmed: false,
    };
    return {
        ...draft,
        verification: {
            ...current,
            globalRequired: true,
            globalConfirmed: true,
        },
    };
}

export function buildQuickScheduleReliabilityFeedback(
    draft: QuickSchedulePreviewDraft,
    outcome: QuickScheduleReliabilityFeedback["outcome"],
): QuickScheduleReliabilityFeedback | null {
    const analysisId = draft.parsed?.analysisId?.trim();
    if (!analysisId) return null;
    const fields = draft.verification?.fields ?? {};
    return {
        analysisId,
        outcome,
        date: fields.date ?? "UNTOUCHED",
        time: fields.time ?? "UNTOUCHED",
        destination: fields.destination ?? "UNTOUCHED",
        globalConfirmed: draft.verification?.globalConfirmed ?? false,
    };
}

function clearTimeDependentRoute(
    draft: QuickSchedulePreviewDraft,
    nextBadges: QuickSchedulePreviewDraft["badges"]
) {
    const hadRoute = !!draft.route
        || !!draft.departAt
        || typeof draft.travelMinutes === "number"
        || draft.notificationLeadMinutes !== undefined;
    nextBadges.notification = hadRoute ? "경로 다시 확인" : "선택 설정";

    return {
        travelMinutes: undefined,
        route: undefined,
        departAt: undefined,
        notificationLeadMinutes: undefined,
    };
}

export function updateQuickSchedulePreviewDraft(
    draft: QuickSchedulePreviewDraft,
    field: QuickSchedulePreviewField,
    value: string
): QuickSchedulePreviewDraft {
    const nextBadges = { ...draft.badges };
    delete nextBadges[field];

    if (field === "notification") {
        const minutes = value === "none" ? undefined : Number(value);
        return {
            ...draft,
            notificationLeadMinutes: Number.isFinite(minutes) && Number(minutes) >= 0
                ? Number(minutes)
                : undefined,
            badges: nextBadges,
        };
    }

    if (field === "location") {
        const normalizedLocation = value.trim() || "장소 미정";
        const verificationStatus = normalizedLocation === draft.location.trim()
            ? "USER_CONFIRMED"
            : "USER_CORRECTED";
        if (normalizedLocation === "장소 미정") {
            nextBadges.location = "장소 확인 필요";
        }
        if (normalizedLocation === draft.location.trim()) {
            return {
                ...draft,
                badges: nextBadges,
                verification: markQuickScheduleFieldVerified(
                    draft,
                    "destination",
                    verificationStatus
                ),
            };
        }

        const destination = quickSchedulePlaceFromLocation(normalizedLocation);
        nextBadges.notification = "선택 설정";
        return {
            ...draft,
            location: normalizedLocation,
            destination,
            travelMinutes: undefined,
            route: undefined,
            departAt: undefined,
            notificationLeadMinutes: undefined,
            badges: nextBadges,
            verification: markQuickScheduleFieldVerified(
                draft,
                "destination",
                verificationStatus
            ),
            parsed: draft.parsed
                ? {
                    ...draft.parsed,
                    destination,
                    travelMinutes: undefined,
                    route: undefined,
                    notificationEnabled: false,
                    notificationLeadMinutes: undefined,
                }
                : draft.parsed,
        };
    }

    if (field === "date" || field === "time") {
        const previousValue = draft[field];
        const verificationStatus = previousValue === value
            ? "USER_CONFIRMED"
            : "USER_CORRECTED";
        if (previousValue === value) {
            return {
                ...draft,
                badges: nextBadges,
                verification: markQuickScheduleFieldVerified(
                    draft,
                    field,
                    verificationStatus
                ),
            };
        }

        const nextDate = field === "date" ? value : draft.date;
        const nextTime = field === "time" ? value : draft.time;
        const nextStartAt = isValidQuickScheduleDate(nextDate) && isValidQuickScheduleTime(nextTime)
            ? quickScheduleDateFromDraftTime(nextDate, nextTime).toISOString()
            : undefined;
        const previousStartAt = isValidQuickScheduleDate(draft.date)
            && isValidQuickScheduleTime(draft.time)
            ? quickScheduleDateFromDraftTime(draft.date, draft.time).toISOString()
            : undefined;
        const canRebaseRoute = !!nextStartAt
            && !!previousStartAt
            && isQuickScheduleRouteReady(draft);
        const routeUpdate = canRebaseRoute
            ? reconcileScheduleRouteTiming({
                departAt: draft.departAt,
                route: draft.route,
                travelMinutes: draft.travelMinutes,
                plannedArrivalAt: previousStartAt,
                nextArrivalAt: nextStartAt,
            })
            : clearTimeDependentRoute(draft, nextBadges);
        const nextNotificationLeadMinutes = canRebaseRoute
            ? draft.notificationLeadMinutes
            : undefined;

        return {
            ...draft,
            [field]: value,
            travelMinutes: canRebaseRoute ? draft.travelMinutes : undefined,
            route: routeUpdate.route,
            departAt: routeUpdate.departAt,
            notificationLeadMinutes: nextNotificationLeadMinutes,
            badges: nextBadges,
            verification: markQuickScheduleFieldVerified(
                draft,
                field,
                verificationStatus
            ),
            parsed: draft.parsed
                ? {
                    ...draft.parsed,
                    date: nextDate,
                    time: nextTime,
                    startAt: nextStartAt,
                    endAt: nextStartAt
                        ? new Date(
                            new Date(nextStartAt).getTime() + draft.durationMinutes * 60_000
                        ).toISOString()
                        : undefined,
                    travelMinutes: canRebaseRoute ? draft.travelMinutes : undefined,
                    route: routeUpdate.route,
                    notificationEnabled: canRebaseRoute
                        && nextNotificationLeadMinutes !== undefined,
                    notificationLeadMinutes: nextNotificationLeadMinutes,
                }
                : draft.parsed,
        };
    }

    return {
        ...draft,
        [field]: value,
        badges: nextBadges,
    };
}

export function applyQuickScheduleRouteResult(
    draft: QuickSchedulePreviewDraft,
    result: RoutePlannerPayload
): QuickSchedulePreviewDraft {
    const destinationName = displayQuickSchedulePlaceName(result.destination)
        || result.locationName?.split("→").pop()?.trim()
        || draft.location;
    const nextBadges = { ...draft.badges };
    const candidate: QuickSchedulePreviewDraft = {
        ...draft,
        location: destinationName || "장소 미정",
        origin: result.origin,
        destination: result.destination,
        travelMode: result.travelMode,
        travelMinutes: result.travelMinutes,
        route: result.route,
        departAt: result.departureAt,
    };
    const hasRoute = isQuickScheduleRouteReady(candidate);
    const routeInfo = hasRoute ? getQuickSchedulePreviewRouteInfo(candidate) : undefined;
    const nextNotificationLeadMinutes = hasRoute
        ? draft.notificationLeadMinutes
            ?? (draft.parsed?.notificationEnabled
                ? draft.parsed.notificationLeadMinutes ?? 30
                : undefined)
        : undefined;

    if (destinationName && destinationName !== "장소 미정") {
        delete nextBadges.location;
    } else {
        nextBadges.location = "장소 확인 필요";
    }
    nextBadges.notification = hasRoute
        ? nextNotificationLeadMinutes === undefined ? "알림 미설정" : undefined
        : "선택 설정";
    if (nextBadges.notification === undefined) delete nextBadges.notification;

    return {
        ...candidate,
        departAt: hasRoute ? routeInfo?.departureTime ?? result.departureAt : undefined,
        notificationLeadMinutes: nextNotificationLeadMinutes,
        badges: nextBadges,
        parsed: draft.parsed
            ? {
                ...draft.parsed,
                origin: result.origin,
                destination: result.destination,
                travelMode: result.travelMode,
                travelMinutes: result.travelMinutes,
                route: result.route,
            }
            : draft.parsed,
    };
}

export function buildQuickSchedulePayload(
    draft: QuickSchedulePreviewDraft,
    category: ScheduleCategory
): Omit<ScheduleItem, "id"> {
    const startAtDate = quickScheduleDateFromDraftTime(draft.date, draft.time);
    const durationMinutes = Number.isFinite(draft.durationMinutes) && draft.durationMinutes > 0
        ? Math.round(draft.durationMinutes)
        : DEFAULT_DURATION_MINUTES;
    const endAtDate = new Date(startAtDate.getTime() + durationMinutes * 60_000);
    const routeReady = isQuickScheduleRouteReady(draft);
    const routeInfo = routeReady ? getQuickSchedulePreviewRouteInfo(draft) : undefined;
    const destination = draft.destination
        ?? quickSchedulePlaceFromLocation(draft.location)
        ?? draft.parsed?.destination;
    const destinationName = displayQuickSchedulePlaceName(destination);
    const hasNotification = routeReady && draft.notificationLeadMinutes !== undefined;

    return {
        title: draft.title.trim() || "새 일정",
        startAt: startAtDate.toISOString(),
        endAt: endAtDate.toISOString(),
        hasEndTime: draft.hasExplicitEndTime,
        allDay: false,
        category,
        locationName: destinationName || undefined,
        destination,
        origin: routeReady ? draft.origin ?? draft.parsed?.origin : undefined,
        notes: draft.memo.trim() && draft.memo !== "메모 없음"
            ? draft.memo.trim()
            : undefined,
        travelMinutes: routeReady
            ? draft.travelMinutes ?? draft.parsed?.travelMinutes
            : undefined,
        departAt: routeReady ? routeInfo?.departureTime ?? draft.departAt : undefined,
        travelMode: routeReady
            ? draft.travelMode ?? draft.parsed?.travelMode
            : undefined,
        route: routeReady ? draft.route ?? draft.parsed?.route : undefined,
        notificationEnabled: hasNotification,
        notificationLeadMinutes: hasNotification ? draft.notificationLeadMinutes : undefined,
        notificationIntervalMinutes: hasNotification
            ? draft.parsed?.notificationIntervalMinutes ?? 20
            : undefined,
    };
}
