export type ScheduleSessionRequestKind = "schedule" | "search";

export type ScheduleSessionRequestToken = {
    kind: ScheduleSessionRequestKind;
    generation: number;
    sequence: number;
    signal: AbortSignal;
};

export type ScheduleItemPurgeSettlement = {
    searchLoading: false;
    searchError: null;
    scheduleLoading: false;
    scheduleError: null;
};

export function collectScheduleIdsMissingFromFullList(
    authoritativeScheduleIds: ReadonlySet<string>,
    ...scheduleIdSources: ReadonlyArray<Iterable<string>>
): Set<string> {
    const missingScheduleIds = new Set<string>();
    scheduleIdSources.forEach((scheduleIds) => {
        for (const scheduleId of scheduleIds) {
            if (!authoritativeScheduleIds.has(scheduleId)) {
                missingScheduleIds.add(scheduleId);
            }
        }
    });
    return missingScheduleIds;
}

export function filterScheduleItemsBySecurityFence<T extends { id: string }>(
    items: T[],
    removedScheduleIds: ReadonlySet<string>,
    redactedScheduleIds: ReadonlySet<string>,
    authoritativeScheduleIds?: ReadonlySet<string> | null
): T[] {
    return items.filter((item) => (
        !removedScheduleIds.has(item.id)
        && !redactedScheduleIds.has(item.id)
        && (
            authoritativeScheduleIds == null
            || authoritativeScheduleIds.has(item.id)
        )
    ));
}

type RequestChannel = {
    sequence: number;
    controller: AbortController | null;
};

export class ScheduleSessionRequestFence {
    private generation = 0;
    private blocked = false;
    private readonly channels: Record<
        ScheduleSessionRequestKind,
        RequestChannel
    > = {
        schedule: { sequence: 0, controller: null },
        search: { sequence: 0, controller: null },
    };

    isBlocked(): boolean {
        return this.blocked;
    }

    begin(kind: ScheduleSessionRequestKind): ScheduleSessionRequestToken | null {
        if (this.blocked) return null;
        const channel = this.channels[kind];
        channel.controller?.abort();
        channel.sequence += 1;
        channel.controller = new AbortController();
        return {
            kind,
            generation: this.generation,
            sequence: channel.sequence,
            signal: channel.controller.signal,
        };
    }

    isCurrent(token: ScheduleSessionRequestToken): boolean {
        const channel = this.channels[token.kind];
        return (
            !this.blocked
            && !token.signal.aborted
            && token.generation === this.generation
            && token.sequence === channel.sequence
            && token.signal === channel.controller?.signal
        );
    }

    finish(token: ScheduleSessionRequestToken): void {
        const channel = this.channels[token.kind];
        if (token.signal === channel.controller?.signal) {
            channel.controller = null;
        }
    }

    invalidate(kind: ScheduleSessionRequestKind): void {
        const channel = this.channels[kind];
        channel.sequence += 1;
        channel.controller?.abort();
        channel.controller = null;
    }

    invalidateItemPurge(): ScheduleItemPurgeSettlement {
        this.invalidate("search");
        this.invalidate("schedule");
        return {
            searchLoading: false,
            searchError: null,
            scheduleLoading: false,
            scheduleError: null,
        };
    }

    rejectSession(): void {
        if (this.blocked) return;
        this.blocked = true;
        this.generation += 1;
        this.invalidate("schedule");
        this.invalidate("search");
    }

    acceptVerifiedSession(): boolean {
        if (!this.blocked) return false;
        this.blocked = false;
        this.generation += 1;
        this.invalidate("schedule");
        this.invalidate("search");
        return true;
    }
}
