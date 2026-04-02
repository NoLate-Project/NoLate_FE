import React, {createContext, useContext, useMemo, useReducer} from "react";
import type {ScheduleCategory, ScheduleItem} from "./types";
import type {ScheduleState} from "./initialState";

type Action =
    | { type: "SET_SELECTED_DAY"; day: string }
    | { type: "SET_CATEGORIES"; categories: ScheduleCategory[] }
    | { type: "SET_ITEMS"; items: ScheduleItem[] }
    | { type: "SET_LOADING"; loading: boolean }
    | { type: "SET_ERROR"; error: string | null }
    | { type: "ADD_ITEM"; item: ScheduleItem }
    | { type: "UPDATE_ITEM"; item: ScheduleItem }
    | { type: "DELETE_ITEM"; id: string };

function reducer(state: ScheduleState, action: Action): ScheduleState {
    switch (action.type) {
        case "SET_SELECTED_DAY":
            return {...state, selectedDay: action.day};

        case "SET_CATEGORIES":
            return {...state, categories: action.categories};

        case "SET_ITEMS": {
            const itemsById = action.items.reduce<Record<string, ScheduleItem>>((acc, item) => {
                acc[item.id] = item;
                return acc;
            }, {});
            return {...state, itemsById};
        }

        case "SET_LOADING":
            return {...state, loading: action.loading};

        case "SET_ERROR":
            return {...state, error: action.error};

        case "ADD_ITEM":
        case "UPDATE_ITEM": {
            return {
                ...state,
                error: null,
                itemsById: {
                    ...state.itemsById,
                    [action.item.id]: action.item,
                },
            };
        }

        case "DELETE_ITEM": {
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
    dispatch: React.Dispatch<Action>;
} | null>(null);

export function ScheduleProvider({
                                     children,
                                     initialState,
                                 }: {
    children: React.ReactNode;
    initialState: ScheduleState;
}) {
    const [state, dispatch] = useReducer(reducer, initialState);
    const value = useMemo(() => ({state, dispatch}), [state]);
    return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useScheduleStore() {
    const ctx = useContext(ScheduleContext);
    if (!ctx) throw new Error("ScheduleProvider로 감싸야 해");
    return ctx;
}
