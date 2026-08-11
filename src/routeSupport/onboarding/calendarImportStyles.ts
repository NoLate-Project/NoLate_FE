import type { AppColors } from '../../modules/theme/ThemeContext';
import { createCalendarImportStylesPart1 } from './calendarImportStylesPart1';
import { createCalendarImportStylesPart2 } from './calendarImportStylesPart2';
import { createCalendarImportStylesPart3 } from './calendarImportStylesPart3';

/** 테마에 맞는 캘린더 가져오기 화면 스타일 조각을 하나의 스타일 맵으로 결합합니다. */
export function createCalendarImportStyles(
  colors: AppColors,
  mode: 'dark' | 'light',
) {
  const isDark = mode === 'dark';
  const brandTint = isDark ? 'rgba(36,107,254,0.18)' : 'rgba(36,107,254,0.08)';

  return {
    ...createCalendarImportStylesPart1(colors, isDark, brandTint),
    ...createCalendarImportStylesPart2(colors, isDark, brandTint),
    ...createCalendarImportStylesPart3(colors, isDark, brandTint),
  };
}
