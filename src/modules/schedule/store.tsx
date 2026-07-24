import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import type {ScheduleCategory, ScheduleItem} from "./types";
import type {ScheduleState} from "./initialState";
import {
    getAuthSessionEpoch,
    isAuthSessionActive,
    isAuthSessionEpochCurrent,
    subscribeAuthSessionEpoch,
} from "../auth/authSessionEpoch";
import {
    clearCalendarScheduleCache,
    releaseCalendarScheduleCacheSecurityBlock,
    resetCalendarScheduleCacheSecurityFence,
    setCalendarScheduleCacheSecurityFence,
} from "./calendarScheduleCache";
import { subscribeScheduleDepartureMutation } from "./scheduleDepartureMutationEvents";

export type ScheduleAction =
    | { type: "SET_SELECTED_DAY"; day: string }
    | { type: "SET_CATEGORIES"; categories: ScheduleCategory[] }
    | { type: "ADD_CATEGORY"; category: ScheduleCategory }
    | { type: "UPSERT_CATEGORY"; category: ScheduleCategory }
    | { type: "REMOVE_CATEGORY"; id: string }
    | { type: "SET_ITEMS"; items: ScheduleItem[] }
    | { type: "SET_LOADING"; loading: boolean }
    | { type: "SET_ERROR"; error: string | null }
    | { type: "RESET"; state: ScheduleState }
    | { type: "ADD_ITEM"; item: ScheduleItem }
    | { type: "UPDATE_ITEM"; item: ScheduleItem }
    | { type: "DELETE_ITEM"; id: string }
    | { type: "REDACT_ITEM"; id: string }
    | { type: "RESTORE_ITEM"; item: ScheduleItem };

function reducer(state: ScheduleState, action: ScheduleAction): ScheduleState {
    switch (action.type) {
        case "RESET":
            return action.state;
        case "SET_SELECTED_DAY":
            return {...state, selectedDay: action.day};

        case "SET_CATEGORIES":
            return {...state, categories: action.categories};

        case "ADD_CATEGORY":
            if (state.categories.some((category) => category.id === action.category.id)) {
                return state;
            }
            return {...state, categories: [...state.categories, action.category]};

        case "UPSERT_CATEGORY": {
            const exists = state.categories.some((category) => category.id === action.category.id);
            return {
                ...state,
                categories: exists
                    ? state.categories.map((category) =>
                        category.id === action.category.id ? action.category : category
                    )
                    : [...state.categories, action.category],
            };
        }

        case "REMOVE_CATEGORY":
            return {
                ...state,
                categories: state.categories.filter((category) => category.id !== action.id),
            };

        case "SET_ITEMS": {
            const itemsById = action.items.reduce<Record<string, ScheduleItem>>((acc, item) => {
                acc[item.id] = item;
                return acc;
            }, {});
            const currentIds = Object.keys(state.itemsById);
            const nextIds = Object.keys(itemsById);
            if (
                currentIds.length === nextIds.length &&
                nextIds.every((id) => state.itemsById[id] === itemsById[id])
            ) {
                return state;
            }
            return {...state, itemsById};
        }

        case "SET_LOADING":
            if (state.loading === action.loading) return state;
            return {...state, loading: action.loading};

        case "SET_ERROR":
            if (state.error === action.error) return state;
            return {...state, error: action.error};

        case "ADD_ITEM":
        case "UPDATE_ITEM":
        case "RESTORE_ITEM": {
            return {
                ...state,
                error: null,
                itemsById: {
                    ...state.itemsById,
                    [action.item.id]: action.item,
                },
            };
        }

        case "DELETE_ITEM":
        case "REDACT_ITEM": {
            const next = {...state.itemsById};
            delete next[action.id];
            return {...state, error: null, itemsById: next};
        }

        default:
            return state;
    }
}

const ScheduleContext = createContext<{
    state: ScheduleState;
    dispatch: React.Dispatch<ScheduleAction>;
    removedItemIds: ReadonlySet<string>;
    redactedItemIds: ReadonlySet<string>;
} | null>(null);

export function ScheduleProvider({
                                     children,
                                     initialState,
                                 }: {
    children: React.ReactNode;
    initialState: ScheduleState;
}) {
    const initialAuthEpochRef = useRef(getAuthSessionEpoch());
    const [authEpoch, setAuthEpoch] = useState(initialAuthEpochRef.current);
    const authEpochRef = useRef(authEpoch);

    useEffect(() => {
        const moveToAuthEpoch = (nextAuthEpoch: number) => {
            if (authEpochRef.current === nextAuthEpoch) return;
            // Remove the old account's provider-local security state and cache
            // synchronously before React can mount the next session subtree.
            resetCalendarScheduleCacheSecurityFence();
            clearCalendarScheduleCache();
            authEpochRef.current = nextAuthEpoch;
            setAuthEpoch(nextAuthEpoch);
        };
        const unsubscribe = subscribeAuthSessionEpoch(moveToAuthEpoch);
        moveToAuthEpoch(getAuthSessionEpoch());
        return unsubscribe;
    }, []);

    return (
        <ScheduleSessionProvider
            key={authEpoch}
            authEpoch={authEpoch}
            initialState={initialState}
        >
            {children}
        </ScheduleSessionProvider>
    );
}

function ScheduleSessionProvider({
    authEpoch,
    children,
    initialState,
}: {
    authEpoch: number;
    children: React.ReactNode;
    initialState: ScheduleState;
}) {
    const [state, baseDispatch] = useReducer(reducer, initialState);
    const removedItemIdsRef = useRef<ReadonlySet<string>>(new Set());
    const [removedItemIds, setRemovedItemIds] = useState<ReadonlySet<string>>(
        removedItemIdsRef.current
    );
    const redactedItemIdsRef = useRef<ReadonlySet<string>>(new Set());
    const [redactedItemIds, setRedactedItemIds] = useState<ReadonlySet<string>>(
        redactedItemIdsRef.current
    );
    const updateRemovedItemIds = useCallback((next: ReadonlySet<string>) => {
        removedItemIdsRef.current = next;
        setCalendarScheduleCacheSecurityFence(
            next,
            redactedItemIdsRef.current
        );
        setRemovedItemIds(next);
    }, []);
    const updateRedactedItemIds = useCallback((next: ReadonlySet<string>) => {
        redactedItemIdsRef.current = next;
        setCalendarScheduleCacheSecurityFence(
            removedItemIdsRef.current,
            next
        );
        setRedactedItemIds(next);
    }, []);
    const dispatch = useCallback((action: ScheduleAction) => {
        // A component from an unmounted account subtree can still finish a
        // promise and retain this closure. Refuse it before any reducer or
        // global cache/tombstone side effect.
        if (
            !isAuthSessionEpochCurrent(authEpoch)
            || !isAuthSessionActive(authEpoch)
        ) {
            return;
        }
        if (action.type === "RESET") {
            resetCalendarScheduleCacheSecurityFence();
            updateRemovedItemIds(new Set());
            updateRedactedItemIds(new Set());
            baseDispatch(action);
            return;
        }
        if (action.type === "DELETE_ITEM") {
            const next = new Set(removedItemIdsRef.current);
            next.add(action.id);
            updateRemovedItemIds(next);
            baseDispatch(action);
            return;
        }
        if (action.type === "REDACT_ITEM") {
            if (!redactedItemIdsRef.current.has(action.id)) {
                const next = new Set(redactedItemIdsRef.current);
                next.add(action.id);
                updateRedactedItemIds(next);
            }
            baseDispatch(action);
            return;
        }
        if (action.type === "RESTORE_ITEM") {
            if (removedItemIdsRef.current.has(action.item.id)) return;
            if (redactedItemIdsRef.current.has(action.item.id)) {
                const next = new Set(redactedItemIdsRef.current);
                next.delete(action.item.id);
                updateRedactedItemIds(next);
            }
            releaseCalendarScheduleCacheSecurityBlock(action.item.id);
            baseDispatch(action);
            return;
        }
        if (action.type === "SET_ITEMS") {
            baseDispatch({
                ...action,
                items: action.items.filter(
                    (item) => (
                        !removedItemIdsRef.current.has(item.id)
                        && !redactedItemIdsRef.current.has(item.id)
                    )
                ),
            });
            return;
        }
        if (
            action.type === "UPDATE_ITEM"
            && (
                removedItemIdsRef.current.has(action.item.id)
                || redactedItemIdsRef.current.has(action.item.id)
            )
        ) {
            return;
        }
        if (action.type === "ADD_ITEM") {
            if (removedItemIdsRef.current.has(action.item.id)) {
                const next = new Set(removedItemIdsRef.current);
                next.delete(action.item.id);
                updateRemovedItemIds(next);
            }
            if (redactedItemIdsRef.current.has(action.item.id)) {
                const next = new Set(redactedItemIdsRef.current);
                next.delete(action.item.id);
                updateRedactedItemIds(next);
            }
            releaseCalendarScheduleCacheSecurityBlock(action.item.id);
        }
        baseDispatch(action);
    }, [authEpoch, updateRedactedItemIds, updateRemovedItemIds]);
    useEffect(() => subscribeScheduleDepartureMutation((event) => {
        if (
            event.authEpoch === authEpoch
            && isAuthSessionActive(authEpoch)
            && event.item
        ) {
            dispatch({ type: "UPDATE_ITEM", item: event.item });
        }
    }), [authEpoch, dispatch]);
    const value = useMemo(
        () => ({ state, dispatch, removedItemIds, redactedItemIds }),
        [dispatch, redactedItemIds, removedItemIds, state]
    );
    return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useScheduleStore() {
    const ctx = useContext(ScheduleContext);
    if (!ctx) throw new Error("ScheduleProvider로 감싸야 해");
    return ctx;
}
