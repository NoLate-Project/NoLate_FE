import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getIntercityCities, getIntercityServices, getIntercityStops, type IntercityCity, type IntercityKind, type IntercityStop, type TimetablePage } from "../../../../api/intercityTimetable";
import { ticketRideService, type ImportedTrainTicket, type IntercityRideService } from '../../importedTicket';
import type { IntercitySelection } from "../../intercityJourney";
import { isServiceDate, koreaServiceDate, serviceTime, timetableStatusMessage } from "../../intercityTimetableModel";
import TrainBookingAction from './TrainBookingAction';
import BusBookingAction from './BusBookingAction';

const KINDS: { kind: IntercityKind; label: string }[] = [{ kind: "TRAIN", label: "기차" }, { kind: "EXPRESS_BUS", label: "고속버스" }, { kind: "INTERCITY_BUS", label: "시외버스" }];
type Props = { importedTicket?: ImportedTrainTicket; kind?: IntercityKind; departureName?: string; arrivalName?: string; date: Date; dark: boolean; onClose: () => void; onSelect?: (selection: IntercitySelection, isCurrent: () => boolean) => Promise<void> };

/** Lookup is read-only until the user confirms station mapping and applies a service. */
export default function IntercityTimetableSheet(props: Props) {
    const insets = useSafeAreaInsets();
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
    const epoch = useRef(0);
    useEffect(() => () => { epoch.current++; }, []);
    const palette = props.dark ? { bg: "#15181D", card: "#252A32", text: "#F6F7FA", sub: "#B1B8C4" } : { bg: "#FFFFFF", card: "#F1F4F8", text: "#172033", sub: "#536176" };
    const textStyle = { color: palette.text };
    const invalidate = () => { epoch.current++; setLoading(false); setError(""); };
    const load = async (task: () => Promise<void>) => {
        const request = epoch.current;
        setError(""); setLoading(true);
        try { await task(); } catch { if (request === epoch.current) setError("정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
        finally { if (request === epoch.current) setLoading(false); }
    };
    const button = (label: string, onPress: () => void, active = false, disabled = false, availableWhileLoading = false) => {
        const backgroundColor = active ? "#2457C5" : palette.card;
        const color = active ? "#FFFFFF" : palette.text;
        const unavailable = disabled || (loading && !availableWhileLoading);
        const opacity = unavailable ? .5 : 1;
        return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={unavailable} onPress={onPress}
            style={[s.button, { backgroundColor, opacity }]}>
            <Text style={[s.buttonText, { color }]}>{label}</Text>
        </Pressable>
        );
    };
    const openPicker = (next: "departure" | "arrival") => {
        if (!kind) return;
        invalidate(); setTarget(next); setStops(undefined);
        setQuery((next === "departure" ? departure?.name ?? props.departureName : arrival?.name ?? props.arrivalName) ?? "");
        if (kind === "TRAIN" && !cities.length) {
            const request = epoch.current;
            load(async () => {
                const result = await getIntercityCities(kind);
                if (request !== epoch.current) return;
                setCities(result.items);
                if (result.status !== "AVAILABLE") setError(timetableStatusMessage(result.status, result.message));
            });
        }
    };
    const findStops = (page = 1) => {
        if (!kind || loading) return;
        const request = epoch.current;
        load(async () => {
            const result = await getIntercityStops({ kind, cityCode: city?.code, query, page });
            if (request !== epoch.current) return;
            setStops(previous => ({ ...result, items: page > 1 ? [...previous?.items ?? [], ...result.items] : result.items }));
            if (result.status !== "AVAILABLE" && result.status !== "NO_SERVICES") setError(timetableStatusMessage(result.status, result.message));
        });
    };
    const findServices = (page = 1) => {
        if (!kind || !departure || !arrival || !isServiceDate(date)) return;
        const request = epoch.current;
        load(async () => {
            const result = await getIntercityServices({ kind, departureId: departure.id, arrivalId: arrival.id, date, page });
            if (request !== epoch.current) return;
            setServices(previous => ({ ...result, items: page > 1 ? [...previous?.items ?? [], ...result.items] : result.items }));
        });
    };
    return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
        <View style={[s.screen, { backgroundColor: palette.bg, paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.header}><Text accessibilityRole="header" style={[s.title, textStyle]}>운행 시간표</Text>
                {button("시간표 닫기", props.onClose, false, false, true)}</View>
            <ScrollView testID="intercity-timetable-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
                <Text style={[s.note, { color: palette.sub }]}>공공 운행 시간표 · 예매 미확인{"\n"}좌석·탑승홈은 예매처에서 확인해 주세요. 운행편을 적용하기 전까지 현재 경로는 유지됩니다.</Text>
                {kind === 'TRAIN' ? <TrainBookingAction dark={props.dark} /> : <BusBookingAction kind={kind ?? "INTERCITY_BUS"} dark={props.dark} />}
                {props.importedTicket && <>
                    <Text style={[s.subtitle, textStyle]}>가져온 {props.importedTicket.kind === 'TRAIN' ? '기차' : '버스'} 승차권</Text>
                    <Text style={textStyle}>{props.importedTicket.departureName} → {props.importedTicket.arrivalName} · {props.importedTicket.departureAt.slice(0, 10)} {serviceTime(props.importedTicket.departureAt)} → {serviceTime(props.importedTicket.arrivalAt)} · {props.importedTicket.trainNumber ? `${props.importedTicket.trainNumber}편` : props.importedTicket.grade}</Text>
                    <Text style={[s.note, { color: palette.sub }]}>사용자가 확인한 입력 정보입니다. 예매 상태는 검증되지 않았으며, 실제 승차권은 예매처에서 제시하세요. 하차역이 최종 목적지이면 하차 후 여유를 0분으로 설정할 수 있습니다.</Text>
                    {!selected && button("가져온 승차권으로 연결", () => { invalidate(); setSelected(ticketRideService(props.importedTicket!)); setConfirmed(false); }, true, Date.parse(props.importedTicket.departureAt) <= Date.now())}
                </>}
                {selected ? <>
                    <Text accessibilityRole="header" style={[s.subtitle, textStyle]}>운행편 연결 확인</Text>
                    <Text style={textStyle}>{selected.serviceDate} {serviceTime(selected.departureAt)} → {serviceTime(selected.arrivalAt)} · {selected.grade} {selected.trainNumber}</Text>
                    <Text style={textStyle}>현재 경로: {props.departureName} → {props.arrivalName}</Text>
                    <Text style={textStyle}>{selected.timingBasis === "TICKET" ? "승차권 입력" : "선택 시간표"}: {selected.departureName} → {selected.arrivalName}</Text>
                    <Text style={[s.note, { color: palette.sub }]}>선택한 역·터미널이 현재 경로의 승하차 지점과 같은 장소인지 확인하세요. 다른 장소라면 경로부터 다시 선택해 주세요. 탑승홈·역 내부 이동은 확인되지 않았습니다.</Text>
                    {button(confirmed ? "같은 승하차 장소 확인됨" : "같은 승하차 장소입니다", () => setConfirmed(value => !value), confirmed)}
                    <Text style={textStyle}>탑승 준비시간 (5~120분)</Text>
                    <TextInput accessibilityLabel="탑승 준비시간" keyboardType="number-pad" value={boardingBuffer} editable={!loading} onChangeText={setBoardingBuffer} style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                    <Text style={textStyle}>하차 후 여유 (0~120분)</Text>
                    <TextInput accessibilityLabel="하차 후 여유" keyboardType="number-pad" value={alightingBuffer} editable={!loading} onChangeText={setAlightingBuffer} style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                    <Text style={[s.note, { color: palette.sub }]}>앞뒤 이동을 다시 조회합니다. 선택 편의 시각은 유지되며, 좌석 예매를 의미하지 않습니다.</Text>
                    {button("이 운행편으로 경로 연결", () => {
                        const request = epoch.current;
                        load(async () => {
                            try {
                                await props.onSelect?.({ service: selected, fetchedAt: selected.timingBasis === "TICKET" ? props.importedTicket?.confirmedAt ?? "" : services?.fetchedAt ?? "", boardingBufferMinutes: Number(boardingBuffer), alightingBufferMinutes: Number(alightingBuffer), mappingConfirmed: confirmed }, () => request === epoch.current);
                                if (request === epoch.current) props.onClose();
                            } catch (cause) {
                                if (request === epoch.current) setError(cause instanceof Error ? cause.message : "연결 경로를 확인하지 못했습니다.");
                            }
                        });
                    }, true, !confirmed || !/^\d+$/.test(boardingBuffer) || !/^\d+$/.test(alightingBuffer))}
                    {button("운행편 선택 취소", () => { invalidate(); setSelected(undefined); setConfirmed(false); }, false, false, true)}
                </> : !target ? <>
                    <View style={s.row}>{KINDS.map(item => <View key={item.kind}>{button(item.label, () => {
                        invalidate(); setKind(item.kind); setDeparture(undefined); setArrival(undefined); setServices(undefined); setCity(undefined); setCities([]);
                    }, kind === item.kind)}</View>)}</View>
                    {!kind && <Text style={textStyle}>장거리 버스의 종류를 선택해 주세요.</Text>}
                    {button(`출발 ${departure?.name ?? "역·터미널 선택"}`, () => openPicker("departure"), false, !kind)}
                    {departure && <Text style={[s.note, { color: palette.sub }]}>{departure.cityName} {departure.id}</Text>}
                    {button(`도착 ${arrival?.name ?? "역·터미널 선택"}`, () => openPicker("arrival"), false, !kind)}
                    {arrival && <Text style={[s.note, { color: palette.sub }]}>{arrival.cityName} {arrival.id}</Text>}
                    <Text style={textStyle}>운행일 (한국 시간)</Text>
                    <TextInput accessibilityLabel="운행일" value={date} editable={!loading} placeholder="YYYY-MM-DD" placeholderTextColor={palette.sub} autoCorrect={false}
                        onChangeText={value => { invalidate(); setDate(value); setServices(undefined); }} style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                    {!isServiceDate(date) && <Text style={textStyle}>날짜를 YYYY-MM-DD로 입력해 주세요.</Text>}
                    {kind === "INTERCITY_BUS" && <Text style={[s.note, { color: palette.sub }]}>시외버스 공공 시간표는 당일 배차만 제공합니다.</Text>}
                    {button("운행편 조회", () => findServices(), true, !departure || !arrival || departure.id === arrival.id || !isServiceDate(date))}
                    {services && <>
                        {services.status !== "AVAILABLE" && <Text accessibilityRole="alert" style={textStyle}>{timetableStatusMessage(services.status, services.message)}</Text>}
                        {services.status === "AVAILABLE" && <Text accessibilityLabel={`운행편 ${services.items.length}개`} style={[s.subtitle, textStyle]}>조회된 운행편 {services.items.length}개</Text>}
                        {services.items.map(item => <View key={item.id} style={[s.service, { backgroundColor: palette.card }]}>
                            <Text style={[s.subtitle, textStyle]}>{serviceTime(item.departureAt)} → {item.arrivalAt.slice(0, 10) !== item.serviceDate ? `${item.arrivalAt.slice(5, 10)} ` : ""}{serviceTime(item.arrivalAt)}</Text>
                            <Text style={textStyle}>{item.departureName} → {item.arrivalName}</Text>
                            <Text style={textStyle}>{[item.grade, item.trainNumber && `${item.trainNumber}편`, item.fare && `${item.fare.toLocaleString()}원`].filter(Boolean).join(" · ")}</Text>
                            {Date.parse(item.departureAt) < Date.now() && <Text style={[s.note, { color: palette.sub }]}>예정 출발 시각 지남</Text>}
                            <Text style={[s.note, { color: palette.sub }]}>시간표 · 예매 미확인</Text>
                            {props.onSelect && button(`${serviceTime(item.departureAt)} ${item.trainNumber ?? item.grade ?? ""} 운행편 선택`, () => { invalidate(); setSelected(item); setConfirmed(false); }, false, Date.parse(item.departureAt) <= Date.now())}
                        </View>)}
                        {services.hasMore && button("다음 운행편 보기", () => findServices(services.page + 1))}
                        {services.fetchedAt && <Text style={[s.note, { color: palette.sub }]}>국토교통부 TAGO · {koreaServiceDate(new Date(services.fetchedAt))} 조회</Text>}
                    </>}
                </> : <>
                    <Text style={[s.subtitle, textStyle]}>{target === "departure" ? "출발" : "도착"} 역·터미널 선택</Text>
                    {kind === "TRAIN" && <>
                        <Text style={textStyle}>시·도 선택{city ? `: ${city.name}` : ""}</Text>
                        <ScrollView testID="intercity-city-list" style={s.cities} nestedScrollEnabled>{cities.map(item => <View key={item.code}>
                            {button(item.name, () => { invalidate(); setCity(item); setStops(undefined); }, city?.code === item.code)}
                        </View>)}</ScrollView>
                    </>}
                    <TextInput accessibilityLabel="역 터미널 검색어" value={query} editable={!loading} placeholder="역 또는 터미널 이름" placeholderTextColor={palette.sub}
                        onChangeText={value => { invalidate(); setQuery(value); setStops(undefined); }} style={[s.input, textStyle, { backgroundColor: palette.card }]} />
                    {button("역 터미널 검색", () => findStops(), true, kind === "TRAIN" ? !city : query.trim().length < 2)}
                    <Text style={[s.note, { color: palette.sub }]}>같은 이름의 역·터미널은 지역과 식별 번호를 확인해 선택하세요.</Text>
                    {stops?.items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name} ${item.id}`} disabled={loading}
                        style={[s.service, { backgroundColor: palette.card }]} onPress={() => {
                            invalidate(); if (target === "departure") setDeparture(item); else setArrival(item); setTarget(undefined); setServices(undefined);
                        }}>
                        <Text style={[s.subtitle, textStyle]}>{item.name}</Text><Text style={[s.note, { color: palette.sub }]}>{item.cityName} {item.id}</Text>
                    </Pressable>)}
                    {stops && ["AVAILABLE", "NO_SERVICES"].includes(stops.status) && !stops.items.length && <Text style={textStyle}>일치하는 역·터미널이 없습니다.{stops.hasMore ? " 다음 목록도 확인해 주세요." : ""}</Text>}
                    {stops?.hasMore && button("다음 역 터미널 보기", () => findStops(stops.page + 1))}
                    {button("역 터미널 선택 취소", () => { invalidate(); setTarget(undefined); }, false, false, true)}
                </>}
                {loading && <ActivityIndicator accessibilityLabel="시간표 조회 중" color="#2457C5" />}
                {!!error && <Text accessibilityRole="alert" style={[s.note, textStyle]}>{error}</Text>}
            </ScrollView>
        </View>
    </Modal>;
}

const s = StyleSheet.create({
    screen: { flex: 1, paddingHorizontal: 20 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 23, fontWeight: "700" }, subtitle: { fontSize: 17, fontWeight: "600" }, content: { gap: 12, paddingVertical: 16, paddingBottom: 40 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, button: { paddingHorizontal: 12, paddingVertical: 13, borderRadius: 12 },
    buttonText: { fontSize: 15, fontWeight: "600" }, input: { borderRadius: 12, padding: 14, fontSize: 16 },
    note: { fontSize: 13, lineHeight: 20 }, service: { borderRadius: 12, padding: 14, gap: 5 }, cities: { maxHeight: 180 },
});
