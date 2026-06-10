export type CalendarViewMode = "compact" | "stack" | "detail" | "list";

export const CALENDAR_VIEW_OPTIONS: Array<{
    value: CalendarViewMode;
    label: string;
    icon: "reorder-three-outline" | "layers-outline" | "reader-outline" | "list-outline";
}> = [
    { value: "compact", label: "축소형", icon: "reorder-three-outline" },
    { value: "stack", label: "스택형", icon: "layers-outline" },
    { value: "detail", label: "상세형", icon: "reader-outline" },
    { value: "list", label: "목록형", icon: "list-outline" },
];
