import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getIntercityCities, getIntercityServices, getIntercityStops, type IntercityCity, type IntercityKind, type IntercityStop, type TimetablePage } from "../../../../api/intercityTimetable";
import { ticketRideService, type ImportedTrainTicket, type IntercityRideService } from '../../importedTicket';
import type { IntercitySelection } from "../../intercityJourney";
import { isIntercityBufferMinutes, isServiceDate, koreaServiceDate, serviceTime, timetableStatusMessage } from "../../intercityTimetableModel";
import TrainBookingAction from './TrainBookingAction';
import BusBookingAction from './BusBookingAction';
import BrandedLoader from '../../../../ui/BrandedLoader';
import { useTimetablePanelMotion } from './useTimetablePanelMotion';

const KINDS: { kind: IntercityKind; label: string }[] = [{ kind: "TRAIN", label: "기차" }, { kind: "EXPRESS_BUS", label: "고속버스" }, { kind: "INTERCITY_BUS", label: "시외버스" }];
type Props = { importedTicket?: ImportedTrainTicket; kind?: IntercityKind; departureName?: string; arrivalName?: string; date: Date; dark: boolean; onClose: () => void; onSelect?: (selection: IntercitySelection, isCurrent: () => boolean) => Promise<void> };

/** Lookup is read-only until the user confirms station mapping and applies a service. */
export default function IntercityTimetableSheet(props: Props) {
    const insets = useSafeAreaInsets();
    const { fontScale } = useWindowDimensions();
    const [kind, setKind] = useState<IntercityKind | undefined>(props.kind);
    const [date, setDate] = useState(props.importedTicket?.departureAt.slice(0, 10) ?? koreaServiceDate(props.date));
    const [departure, setDeparture] = useState<IntercityStop>();
    const [arrival, setArrival] = useState<IntercityStop>();
    const [target, setTarget] = useState<"departure" | "arrival">();
    const [query, setQuery] = useState("");
    const [cities, setCities] = useState<IntercityCity[]>([]);
    const [city, setCity] = useState<IntercityCity>();
    const [stops, setStops] = useState<TimetablePage<IntercityStop>>();
    const [services, setServices] = useState<TimetablePage<IntercityRideService>>();
    const [selected, setSelected] = useState<IntercityRideService>();
    const [confirmed, setConfirmed] = useState(false);
    const [boardingBuffer, setBoardingBuffer] = useState("15");
    const [alightingBuffer, setAlightingBuffer] = useState(props.importedTicket ? "0" : "5");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const panel = selected ? "confirm" : target ? "picker" : "lookup";
    const { reduceMotionEnabled, panelAnimatedStyle } = useTimetablePanelMotion(panel);
    const scroll = useRef<ScrollView>(null);
    const currentOffset = useRef(0);
    const lookupOffset = useRef(0);
    const lookupFocus = useRef<string | null>(null);
    const returnButton = useRef<React.ElementRef<typeof Pressable>>(null);
    const boardingMinutes = Number(boardingBuffer);
    const alightingMinutes = Number(alightingBuffer);
    const boardingValid = /^\d+$/.test(boardingBuffer) && isIntercityBufferMinutes(boardingMinutes, 5);
    const alightingValid = /^\d+$/.test(alightingBuffer) && isIntercityBufferMinutes(alightingMinutes, 0);
    const canConnect = !!props.onSelect && confirmed && boardingValid && alightingValid;
    const epoch = useRef(0);
    useLayoutEffect(() => {
        const frame = requestAnimationFrame(() => {
            scroll.current?.scrollTo({ y: panel === "lookup" ? lookupOffset.current : 0, animated: false });
            const button = panel === "lookup" ? returnButton.current : null;
            if (button && lookupFocus.current) AccessibilityInfo.sendAccessibilityEvent?.(button, "focus");
            if (panel === "lookup") lookupFocus.current = null;
        });
        return () => cancelAnimationFrame(frame);
    }, [panel]);
    useEffect(() => () => { epoch.current++; }, []);
    const palette = props.dark ? { bg: "#15181D", card: "#252A32", text: "#F6F7FA", sub: "#B1B8C4", error: "#FF9D9B" } : { bg: "#FFFFFF", card: "#F1F4F8", text: "#172033", sub: "#536176", error: "#AE3036" };
    const textStyle = { color: palette.text };
    const selectService = (service: IntercityRideService) => {
        lookupOffset.current = currentOffset.current;
        lookupFocus.current = service.id;
        invalidate();
        setSelected(service);
        setConfirmed(false);
    };
    const close = () => {
        epoch.current++;
        props.onClose();
    };
    const invalidate = (preserveError = false) => { epoch.current++; setLoading(false); if (!preserveError) setError(""); };
    const load = async (task: () => Promise<void>) => {
        const request = epoch.current;
        setError(""); setLoading(true);
        try { await task(); } catch { if (request === epoch.current) setError("정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
        finally { if (request === epoch.current) setLoading(false); }
    };
    const button = (label: string, onPress: () => void, active = false, disabled = false, focusKey?: string) => {
        const isKind = KINDS.some(item => item.label === label);
        const backgroundColor = isKind
            ? active ? props.dark ? "#343B46" : "#FFFFFF" : "transparent"
            : active ? "#2457C5" : palette.card;
        const color = isKind && active ? props.dark ? "#9FC8FF" : "#185ACC" : active && !isKind ? "#FFFFFF" : palette.text;
        const unavailable = disabled || loading;
        const opacity = unavailable ? .5 : 1;
        return (
        <Pressable ref={focusKey && lookupFocus.current === focusKey ? returnButton : undefined}
            accessibilityRole="button" accessibilityLabel={label} disabled={unavailable} onPress={onPress}
            accessibilityState={{ disabled: unavailable, ...(KINDS.some(item => item.label === label) ? { selected: active } : {}) }}
            style={({ pressed }) => [s.button, isKind && s.kindButton, active && !isKind && s.primaryButton, { backgroundColor, opacity: pressed && !unavailable ? 0.65 : opacity }]}>
            <Text style={[s.buttonText, isKind && s.kindButtonText, { color }]}>{label}</Text>
        </Pressable>
        );
    };
    const openPicker = (next: "departure" | "arrival") => {
        if (!kind) return;
        lookupOffset.current = currentOffset.current;
        invalidate(); setTarget(next); setStops(undefined);
        setQuery((next === "departure" ? departure?.name ?? props.departureName : arrival?.name ?? props.arrivalName) ?? "");
        if (kind === "TRAIN" && !cities.length) loadCities();
    };
    const loadCities = () => {
        if (kind !== "TRAIN") return;
        const request = ++epoch.current;
        load(async () => {
            const result = await getIntercityCities(kind);
            if (request !== epoch.current) return;
            setCities(result.items);
            if (result.status !== "AVAILABLE") setError(timetableStatusMessage(result.status, result.message));
        });
    };
    const pointField = (which: "departure" | "arrival", stop?: IntercityStop) => {
        const label = which === "departure" ? "출발" : "도착";
        const disabled = !kind || loading;
        return <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${stop?.name ?? "역·터미널 선택"}`}
            accessibilityState={{ disabled }} disabled={disabled} onPress={() => openPicker(which)}
            style={({ pressed }) => [s.pointField, which === "arrival" && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: props.dark ? "#343B46" : "#D8DEE8" }, { opacity: disabled ? 0.5 : pressed ? 0.65 : 1 }]}>
            <Text style={[s.fieldLabel, { color: palette.sub }]}>{label}</Text>
            <View style={s.pointValue}>
                <Text numberOfLines={2} style={[s.body, { color: stop ? palette.text : palette.sub }]}>{stop?.name ?? "역·터미널 선택"}</Text>
                {stop && <Text style={[s.note, { color: palette.sub }]}>{stop.cityName} {stop.id}</Text>}
            </View>
            <Ionicons name="chevron-forward-outline" size={18} color={palette.sub} />
        </Pressable>;
    };
    const findStops = (page = 1) => {
        if (!kind || loading) return;
        Keyboard.dismiss();
        const request = ++epoch.current;
        load(async () => {
            const result = await getIntercityStops({ kind, cityCode: city?.code, query, page });
            if (request !== epoch.current) return;
            setStops(previous => ({ ...result, items: page > 1 ? [...previous?.items ?? [], ...result.items] : result.items }));
            if (result.status !== "AVAILABLE" && result.status !== "NO_SERVICES") setError(timetableStatusMessage(result.status, result.message));
        });
    };
    const findServices = (page = 1) => {
        if (!kind || !departure || !arrival || !isServiceDate(date)) return;
        const request = ++epoch.current;
        load(async () => {
            const result = await getIntercityServices({ kind, departureId: departure.id, arrivalId: arrival.id, date, page });
            if (request !== epoch.current) return;
            setServices(previous => ({ ...result, items: page > 1 ? [...previous?.items ?? [], ...result.items] : result.items }));
        });
    };
    const connect = () => {
        if (!selected || !canConnect || loading) return;
        Keyboard.dismiss();
        const request = ++epoch.current;
        load(async () => {
            try {
                await props.onSelect?.({
                    service: selected,
                    fetchedAt: selected.timingBasis === "TICKET" ? props.importedTicket?.confirmedAt ?? "" : services?.fetchedAt ?? "",
                    boardingBufferMinutes: boardingMinutes,
                    alightingBufferMinutes: alightingMinutes,
                    mappingConfirmed: confirmed,
                }, () => request === epoch.current);
                if (request === epoch.current) close();
            } catch (cause) {
                if (request === epoch.current) setError(cause instanceof Error ? cause.message : "연결 경로를 확인하지 못했습니다.");
            }
        });
    };
    const returnToLookup = () => {
        Keyboard.dismiss();
        invalidate();
        setTarget(undefined);
        setSelected(undefined);
        setConfirmed(false);
    };
    const title = selected ? "운행편 연결 확인" : target ? `${target === "departure" ? "출발" : "도착"} 역·터미널 선택` : "운행 시간표";
    const showLookup = !selected && !target;
    const lookupDisabled = !departure || !arrival || departure.id === arrival.id || !isServiceDate(date);
    const dividerColor = props.dark ? "#343B46" : "#D8DEE8";
    return <Modal visible animationType={reduceMotionEnabled ? "none" : "slide"} presentationStyle="pageSheet" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[s.screen, { backgroundColor: palette.bg }]}>
          <View style={[s.sheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.header}>
                {!showLookup && (
                    <Pressable accessibilityRole="button"
                        accessibilityLabel={selected ? "운행편 선택 취소" : "역 터미널 선택 취소"}
                        onPress={returnToLookup} style={s.navigationButton}>
                        <Ionicons accessible={false} name="chevron-back-outline" size={22} color={palette.text} />
                    </Pressable>
                )}
                <View style={s.heading}>
                    <Text accessibilityRole="header" style={[s.title, textStyle]}>{title}</Text>
                    <Text style={[s.note, { color: palette.sub }]}>
                        {selected ? "장소와 여유 시간을 확인한 뒤 경로에 연결합니다." : "공공 운행 시간표 · 예매 미확인"}
                    </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="시간표 닫기" onPress={close}
                    style={[s.navigationButton, { backgroundColor: palette.card }]}>
                    <Ionicons accessible={false} name="close-outline" size={22} color={palette.text} />
                </Pressable>
            </View>
            <ScrollView ref={scroll} testID="intercity-timetable-scroll" keyboardShouldPersistTaps="handled"
                style={s.scroll} contentContainerStyle={s.content} scrollEventThrottle={16}
                onScroll={event => { currentOffset.current = event.nativeEvent.contentOffset.y; }}>
                {showLookup && props.importedTicket && <>
                    <Text style={[s.subtitle, textStyle]}>가져온 {props.importedTicket.kind === 'TRAIN' ? '기차' : '버스'} 승차권</Text>
                    <Text style={[s.body, textStyle]}>{props.importedTicket.departureName} → {props.importedTicket.arrivalName} · {props.importedTicket.departureAt.slice(0, 10)} {serviceTime(props.importedTicket.departureAt)} → {serviceTime(props.importedTicket.arrivalAt)} · {props.importedTicket.trainNumber ? `${props.importedTicket.trainNumber}편` : props.importedTicket.grade}</Text>
                    <Text style={[s.note, { color: palette.sub }]}>사용자가 확인한 입력 정보입니다. 예매 상태는 검증되지 않았으며, 실제 승차권은 예매처에서 제시하세요. 하차역이 최종 목적지이면 하차 후 여유를 0분으로 설정할 수 있습니다.</Text>
                    {button("가져온 승차권으로 연결", () => selectService(ticketRideService(props.importedTicket!)), true, Date.parse(props.importedTicket.departureAt) <= Date.now(), props.importedTicket.id)}
                </>}
                <Animated.View style={[s.panel, panelAnimatedStyle]}>
                {selected ? <>
                    <View style={[s.service, { backgroundColor: palette.card }]}>
                        <Text style={[s.subtitle, textStyle]}>{serviceTime(selected.departureAt)} → {serviceTime(selected.arrivalAt)}</Text>
                        <Text style={[s.body, textStyle]}>{selected.departureName} → {selected.arrivalName} · {[selected.grade, selected.trainNumber].filter(Boolean).join(" ")}</Text>
                        <Text style={[s.note, { color: palette.sub }]}>{selected.serviceDate} · {selected.timingBasis === "TICKET" ? "가져온 승차권" : "공공 시간표"} · 예매 미확인</Text>
                    </View>
                    <Text style={[s.body, textStyle]}>현재 경로: {props.departureName} → {props.arrivalName}</Text>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: loading }}
                        accessibilityLabel={confirmed ? "같은 승하차 장소 확인됨" : "같은 승하차 장소입니다"}
                        disabled={loading} onPress={() => setConfirmed(value => !value)} style={s.confirmPoint}>
                        <Ionicons accessible={false} name={confirmed ? "checkbox-outline" : "square-outline"} size={20} color={palette.text} />
                        <Text style={[s.body, s.heading, textStyle]}>같은 승하차 장소입니다</Text>
                    </Pressable>
                    <View style={[s.buffers, fontScale > 1.35 && s.stackedBuffers]}>
                        {([
                            { label: "탑승 준비시간", range: "5~120분", value: boardingBuffer, valid: boardingValid, update: setBoardingBuffer },
                            { label: "하차 후 여유", range: "0~120분", value: alightingBuffer, valid: alightingValid, update: setAlightingBuffer },
                        ] as const).map(({ label, range, value, valid, update }) => (
                            <View key={label} style={s.heading}>
                                <Text style={[s.fieldLabel, { color: palette.sub }]}>{label} ({range})</Text>
                                <TextInput accessibilityLabel={label} keyboardType="number-pad" value={value}
                                    editable={!loading} onChangeText={update}
                                    style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                                {!valid && <Text accessibilityRole="alert" style={[s.note, { color: palette.error }]}>{range}으로 입력해 주세요.</Text>}
                            </View>
                        ))}
                    </View>
                    <Text style={[s.note, { color: palette.sub }]}>운행편 시각은 유지하고 역·터미널까지 오가는 경로를 다시 조회합니다. 예매는 예매처에서 확인해 주세요.</Text>
                </> : !target ? <>
                    <View style={[s.row, { backgroundColor: palette.card }]}>{KINDS.map(item => <View key={item.kind} style={s.kindOption}>{button(item.label, () => {
                        invalidate(); setKind(item.kind); setDeparture(undefined); setArrival(undefined); setServices(undefined); setCity(undefined); setCities([]);
                    }, kind === item.kind)}</View>)}</View>
                    {!kind && <Text style={[s.body, textStyle]}>장거리 버스의 종류를 선택해 주세요.</Text>}
                    <View style={[s.pointGroup, { backgroundColor: palette.card }]}>
                        {pointField("departure", departure)}
                        {pointField("arrival", arrival)}
                    </View>
                    <Text style={[s.fieldLabel, { color: palette.sub }]}>운행일 (한국 시간)</Text>
                    <TextInput accessibilityLabel="운행일" value={date} editable={!loading} placeholder="YYYY-MM-DD" placeholderTextColor={palette.sub} autoCorrect={false}
                        onChangeText={value => { invalidate(); setDate(value); setServices(undefined); }} style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                    {!isServiceDate(date) && <Text style={[s.body, textStyle]}>날짜를 YYYY-MM-DD로 입력해 주세요.</Text>}
                    {kind === "INTERCITY_BUS" && <Text style={[s.note, { color: palette.sub }]}>시외버스 공공 시간표는 당일 배차만 제공합니다.</Text>}
                    {services && <>
                        {services.status !== "AVAILABLE" && <Text accessibilityRole="alert" style={[s.body, textStyle]}>{timetableStatusMessage(services.status, services.message)}</Text>}
                        {services.status === "AVAILABLE" && <Text accessibilityLabel={`운행편 ${services.items.length}개`} style={[s.subtitle, textStyle]}>조회된 운행편 {services.items.length}개</Text>}
                        {services.items.map(item => {
                            const label = `${serviceTime(item.departureAt)} ${item.trainNumber ?? item.grade ?? ""} 운행편 선택`;
                            return <View key={item.id} style={[s.service, { backgroundColor: palette.card }]}>
                                <Text style={[s.subtitle, textStyle]}>{serviceTime(item.departureAt)} → {item.arrivalAt.slice(0, 10) !== item.serviceDate ? `${item.arrivalAt.slice(5, 10)} ` : ""}{serviceTime(item.arrivalAt)}</Text>
                                <Text style={[s.body, textStyle]}>{item.departureName} → {item.arrivalName}</Text>
                                <Text style={[s.body, textStyle]}>{[item.grade, item.trainNumber && `${item.trainNumber}편`, item.fare && `${item.fare.toLocaleString()}원`].filter(Boolean).join(" · ")}</Text>
                                {Date.parse(item.departureAt) < Date.now() && <Text style={[s.note, { color: palette.sub }]}>예정 출발 시각 지남</Text>}
                                <Text style={[s.note, { color: palette.sub }]}>시간표 · 예매 미확인</Text>
                                {props.onSelect && button(label, () => selectService(item), false, Date.parse(item.departureAt) <= Date.now(), item.id)}
                            </View>;
                        })}
                        {services.hasMore && button("다음 운행편 보기", () => findServices(services.page + 1))}
                        {services.fetchedAt && <Text style={[s.note, { color: palette.sub }]}>국토교통부 TAGO · {koreaServiceDate(new Date(services.fetchedAt))} 조회</Text>}
                    </>}
                </> : <>
                    {kind === "TRAIN" && <>
                        <Text style={[s.body, textStyle]}>시·도 선택{city ? `: ${city.name}` : ""}</Text>
                        <ScrollView testID="intercity-city-list" style={s.cities} nestedScrollEnabled>{cities.map(item => <View key={item.code}>
                            {button(item.name, () => { invalidate(); setCity(item); setStops(undefined); }, city?.code === item.code)}
                        </View>)}</ScrollView>
                    </>}
                    <TextInput accessibilityLabel="역 터미널 검색어" value={query} editable={!loading} placeholder="역 또는 터미널 이름" placeholderTextColor={palette.sub}
                        onChangeText={value => { invalidate(kind === "TRAIN" && !cities.length); setQuery(value); setStops(undefined); }} style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                    {button("역 터미널 검색", () => findStops(), true, kind === "TRAIN" ? !city : query.trim().length < 2)}
                    {!!error && <View style={s.errorRow}>
                        <Text accessibilityRole="alert" style={[s.note, { color: palette.error }]}>{error}</Text>
                        {button(kind === "TRAIN" && !cities.length ? "역 지역 목록 다시 불러오기" : "역 터미널 검색 다시 시도",
                            () => { invalidate(); if (kind === "TRAIN" && !cities.length) loadCities(); else findStops(); })}
                    </View>}
                    <Text style={[s.note, { color: palette.sub }]}>같은 이름의 역·터미널은 지역과 식별 번호를 확인해 선택하세요.</Text>
                    {stops?.items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name} ${item.id}`} disabled={loading}
                        style={[s.service, { backgroundColor: palette.card }]} onPress={() => {
                            invalidate(); if (target === "departure") setDeparture(item); else setArrival(item); setTarget(undefined); setServices(undefined);
                        }}>
                        <Text style={[s.subtitle, textStyle]}>{item.name}</Text><Text style={[s.note, { color: palette.sub }]}>{item.cityName} {item.id}</Text>
                    </Pressable>)}
                    {stops && ["AVAILABLE", "NO_SERVICES"].includes(stops.status) && !stops.items.length && <Text style={[s.body, textStyle]}>일치하는 역·터미널이 없습니다.{stops.hasMore ? " 다음 목록도 확인해 주세요." : ""}</Text>}
                    {stops?.hasMore && button("다음 역 터미널 보기", () => findStops(stops.page + 1))}
                </>}
                </Animated.View>
                {loading && <BrandedLoader size="button" variant="route" accessibilityLabel="시간표 조회 중" />}
                {!target && !!error && <Text accessibilityRole="alert" style={[s.note, { color: palette.error }]}>{error}</Text>}
                {showLookup && <View style={[s.booking, { borderTopColor: dividerColor }]}>
                    {kind === "TRAIN" ? <TrainBookingAction dark={props.dark} /> : <BusBookingAction kind={kind ?? "INTERCITY_BUS"} dark={props.dark} />}
                </View>}
            </ScrollView>
            {!target && <View style={[s.footer, { borderTopColor: dividerColor }]}>
                {selected
                    ? button("이 운행편으로 경로 연결", connect, true, !canConnect)
                    : button("운행편 조회", () => { Keyboard.dismiss(); findServices(); }, true, lookupDisabled)}
            </View>}
          </View>
        </KeyboardAvoidingView>
    </Modal>;
}

const s = StyleSheet.create({
    screen: { flex: 1 },
    sheetContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
    header: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 18, lineHeight: 24, fontWeight: "700" }, subtitle: { fontSize: 17, lineHeight: 24, fontWeight: "600" }, body: { fontSize: 15, lineHeight: 22, fontWeight: "400" }, content: { gap: 12, paddingVertical: 16, paddingBottom: 40 },
    row: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14 },
    kindButton: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
    kindButtonText: { fontSize: 14, lineHeight: 20 },
    panel: { gap: 12 },
    pointGroup: { borderRadius: 12, overflow: "hidden" },
    pointField: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    pointValue: { flex: 1, minWidth: 0 },
    fieldLabel: { fontSize: 12, lineHeight: 18, fontWeight: "500" }, kindOption: { flex: 1 }, button: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 13, borderRadius: 12 },
    primaryButton: { alignItems: "center" },
    buttonText: { fontSize: 15, lineHeight: 22, fontWeight: "600" }, input: { minHeight: 52, borderRadius: 12, padding: 14, fontSize: 16, lineHeight: 24 },
    navigationButton: { width: 44, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    scroll: { flex: 1 },
    heading: { flex: 1, minWidth: 0 },
    buffers: { flexDirection: "row", gap: 12 },
    stackedBuffers: { flexDirection: "column" },
    confirmPoint: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
    errorRow: { gap: 8 },
    footer: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
    booking: { marginTop: 8, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth },
    note: { fontSize: 13, lineHeight: 20 }, service: { borderRadius: 12, padding: 14, gap: 5 }, cities: { maxHeight: 180 },
});
