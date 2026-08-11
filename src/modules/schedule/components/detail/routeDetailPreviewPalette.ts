/** 경로 상세 디자인 미리보기에서 재사용하는 지도·시트 색상 계약입니다. */
export type PreviewPalette = {
  background: string;
  sheet: string;
  sheetMuted: string;
  border: string;
  text: string;
  secondary: string;
  tertiary: string;
  blue: string;
  blueSoft: string;
  map: string;
  mapRoad: string;
  mapRoadEdge: string;
  green: string;
  greenSoft: string;
};

const BLUE = '#2878F0';
export const LINE_2 = '#2FA857';
export const LINE_4 = '#3D78D8';

/**
 * 테마 모드에 맞는 경로 상세 미리보기의 배경·텍스트·강조 색상 묶음을 생성합니다.
 * 반환 객체는 미리보기 전용이며 전역 테마나 입력값을 변경하지 않습니다.
 */
export function buildPalette(isDark: boolean): PreviewPalette {
  if (isDark) {
    return {
      background: '#0D1015',
      sheet: '#171A20',
      sheetMuted: '#20242C',
      border: 'rgba(255,255,255,0.10)',
      text: '#F6F7F9',
      secondary: '#A8AFBA',
      tertiary: '#707987',
      blue: '#4B9DFF',
      blueSoft: 'rgba(75,157,255,0.16)',
      map: '#1D232B',
      mapRoad: '#313945',
      mapRoadEdge: '#171C23',
      green: '#43C875',
      greenSoft: 'rgba(67,200,117,0.16)',
    };
  }

  return {
    background: '#F6F7F9',
    sheet: '#FFFFFF',
    sheetMuted: '#F4F6F8',
    border: '#E7E9ED',
    text: '#111318',
    secondary: '#656C78',
    tertiary: '#9AA1AC',
    blue: BLUE,
    blueSoft: '#EAF2FF',
    map: '#E9EDF0',
    mapRoad: '#FFFFFF',
    mapRoadEdge: '#DDE2E6',
    green: LINE_2,
    greenSoft: '#EAF7EF',
  };
}
