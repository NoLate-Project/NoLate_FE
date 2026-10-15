import { LocaleConfig } from 'react-native-calendars';

// Calendar pickers follow the same Korean labels as the surrounding schedule UI.
if (LocaleConfig?.locales) {
  const months = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
  LocaleConfig.locales['nolate-ko'] = {
    monthNames: months,
    monthNamesShort: months,
    dayNames: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
    dayNamesShort: ['일', '월', '화', '수', '목', '금', '토'],
    today: '오늘',
  };
  LocaleConfig.defaultLocale = 'nolate-ko';
}
