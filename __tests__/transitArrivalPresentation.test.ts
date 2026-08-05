import {
    getTransitArrivalAttributeLabels,
    getTransitArrivalInlineMessage,
    getTransitArrivalFreshness,
    getTransitArrivalPresentation,
    getTransitArrivalStatusLabel,
} from "../src/modules/schedule/components/route/transitArrivalPresentation";

describe("transitArrivalPresentation", () => {
    it("실시간 도착 결과가 있으면 도착 카드만 강조한다", () => {
        expect(getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "ready",
            arrivalCount: 2,
        })).toEqual({
            statusLabel: "실시간",
            showArrivalCard: true,
            showLoadingIcon: false,
        });
    });

    it("조회 중 상태는 큰 빈 카드 대신 한 줄 안내를 사용한다", () => {
        expect(getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "loading",
            arrivalCount: 0,
        })).toMatchObject({
            statusLabel: "확인 중",
            showArrivalCard: false,
            showLoadingIcon: true,
        });
    });

    it("미지원·빈 결과·오류 상태를 서로 구분해 축약한다", () => {
        expect(getTransitArrivalPresentation({
            hasRequest: false,
            arrivalCount: 0,
        }).statusLabel).toBe("미지원");
        expect(getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "empty",
            arrivalCount: 0,
        })).toMatchObject({
            statusLabel: "정보 없음",
            inlineMessage: "지금 확인할 수 있는 도착 예정이 없어요.",
        });
        expect(getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "error",
            arrivalCount: 0,
        }).statusLabel).toBe("일시 오류");
    });

    it("최근 갱신 시각과 오래된 마지막 정상값을 구분한다", () => {
        const nowMs = Date.parse("2026-07-14T03:00:00.000Z");
        expect(getTransitArrivalFreshness("2026-07-14T02:59:30.000Z", nowMs)).toEqual({
            label: "방금 갱신",
            stale: false,
        });
        expect(getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "error",
            arrivalCount: 2,
            updatedAt: "2026-07-14T02:58:00.000Z",
            nowMs,
        })).toMatchObject({
            statusLabel: "갱신 지연",
            freshnessLabel: "2분 전 갱신",
            showArrivalCard: true,
        });
    });

    it("급행·저상·막차 속성을 공급자 값이 참일 때만 노출한다", () => {
        expect(getTransitArrivalAttributeLabels({
            express: true,
            lowFloor: true,
            lastTrain: true,
        })).toEqual(["급행", "저상", "막차"]);
        expect(getTransitArrivalAttributeLabels({
            express: false,
            lowFloor: null,
            lastTrain: false,
        })).toEqual([]);
    });

    it("실시간 결과가 없으면 운행 시간표 승차시각을 예정 정보로 유지한다", () => {
        const presentation = getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "empty",
            arrivalCount: 0,
        });
        expect(getTransitArrivalInlineMessage(
            presentation,
            "15:32",
            "운행 시간표"
        )).toBe("운행 시간표 기준 · 15:32 승차 예정");
        expect(getTransitArrivalStatusLabel(presentation, "15:32")).toBe("15:32 예정");
    });

    it("실시간 조회 오류도 운행 시간표가 있으면 오류 배지 대신 예정 시각을 표시한다", () => {
        const presentation = getTransitArrivalPresentation({
            hasRequest: true,
            loadState: "error",
            arrivalCount: 0,
        });
        expect(getTransitArrivalInlineMessage(
            presentation,
            "15:32",
            "운행 시간표"
        )).toBe("운행 시간표 기준 · 15:32 승차 예정");
        expect(getTransitArrivalStatusLabel(presentation, "15:32")).toBe("15:32 예정");
    });
});
