const LEGACY_CALENDAR_IMPORT_SUFFIX = /(?:^|\n{2,})((?:Apple 캘린더|Android 캘린더|Google Calendar)에서 가져온 일정\n{2,}원본 캘린더:\s*[^\r\n]+)\s*$/u;

type CalendarImportNotesParts = {
    userNotes?: string;
    legacyMetadata?: string;
};

export function splitCalendarImportNotes(notes: string | null | undefined): CalendarImportNotesParts {
    const normalized = notes?.trim();
    if (!normalized) return {};

    const match = LEGACY_CALENDAR_IMPORT_SUFFIX.exec(normalized);
    if (!match || match.index === undefined) {
        return { userNotes: normalized };
    }

    return {
        userNotes: normalized.slice(0, match.index).trim() || undefined,
        legacyMetadata: match[1].trim(),
    };
}

export function getUserVisibleScheduleNotes(notes: string | null | undefined): string | undefined {
    return splitCalendarImportNotes(notes).userNotes;
}

export function preserveLegacyCalendarImportMetadata(
    originalNotes: string | null | undefined,
    editedUserNotes: string | null | undefined,
): string | undefined {
    const edited = editedUserNotes?.trim();
    const { legacyMetadata } = splitCalendarImportNotes(originalNotes);
    const combined = [edited, legacyMetadata].filter(Boolean).join("\n\n");
    return combined || undefined;
}
