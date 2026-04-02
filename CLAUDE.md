# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start dev server
npm start              # React Native bundler (metro)
npx expo start         # Expo dev server (recommended)

# Run on device/emulator
npm run android        # expo run:android
npm run ios            # expo run:ios

# Code quality
npm run lint           # ESLint
npm test               # Jest
```

## Architecture

### Routing (Expo Router)
File-based routing under `app/`. Route map:
- `/` → redirects to `/auth/login`
- `/auth/login` → login screen (API auth is TODO, currently bypasses)
- `/schedule` → main calendar + list view
- `/schedule/[id]` → schedule detail/edit (dynamic route, `useLocalSearchParams()`)

Stack config is in `app/_layout.tsx`, which also wraps the app in `ScheduleProvider`.

### State Management (Context + useReducer)
All state lives in `src/modules/schedule/store.tsx`:
- `ScheduleProvider` wraps the entire app
- `useScheduleStore()` hook returns `{ state, dispatch }`
- Actions: `SET_SELECTED_DAY`, `SET_CATEGORIES`, `ADD_ITEM`, `UPDATE_ITEM`, `DELETE_ITEM`
- State shape: `{ selectedDay: string (YYYY-MM-DD), categories: ScheduleCategory[], itemsById: Record<string, ScheduleItem> }` — normalized by ID for O(1) lookups

Initial state (3 sample events, 3 categories) is created by `createScheduleInitialState()` in `src/modules/schedule/initialState.ts`.

### Data Model (`src/modules/schedule/types.ts`)
- `ScheduleItem`: `id`, `title`, `startAt`/`endAt` (ISO 8601), optional `allDay`, `travelMinutes`, `departAt`, `origin`/`destination` (Place), `category`, `notes`
- `ScheduleCategory`: `id`, `title`, `color`
- `Place`: `name`, `address`, `lat`, `lng` (reserved for future map integration)

### Calendar & Multi-day Events
`app/schedule/components/calendar/ScheduleCalendar.tsx` uses `react-native-calendars`:
- Multi-day events → **period bars** (with rounded start/end corners via `CustomDay.tsx`)
- Single-day events → **dots**
- Color-coded by category
- `lib/util/data.tsx` provides: `toYmd`, `fromISO`, `formatHHmm`, `isOverlappingDay`, `enumerateDaysBetween`

### Component Organization
```
app/schedule/components/
├── calendar/    # ScheduleCalendar, CustomDay, MultiDayEventBar, CalendarWrapper
├── list/        # ScheduleList, ScheduleItemList (FlatList), ScheduleItemCard
├── form/        # ScheduleAddModal, CategorySelectBox, LocationInputRow
└── shared/      # FloatingButton, TimePickerRow
common/component/ # Card, CardPress (shared UI primitives)
```

### API Layer
`src/api/api.ts` is currently an empty placeholder. `axios` and `@tanstack/react-query` are installed and ready. `expo-secure-store` is available for token storage.

### Platform-specific Patterns
`DateTimePicker` (@react-native-community/datetimepicker) uses different display modes:
- iOS: `spinner` mode, always visible
- Android: dialog mode, launched on press; handle `dismissed` action to cancel

### Date Handling Conventions
- Store dates as ISO 8601 strings (UTC)
- Display/edit in local time using `formatHHmm()` and `toYmd()`
- Combine date + time: `isoAt(ymd, hhmm)` from `initialState.ts`
- Validate that `endAt > startAt`; auto-add 30 min if invalid
