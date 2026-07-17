import React, {createContext, useContext, useEffect, useMemo, useReducer} from "react";
import type {ScheduleCategory, ScheduleItem} from "./types";
import type {ScheduleState} from "./initialState";
import { subscribeAuthInvalidation } from "../auth/authStorage";

type Action =
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
    | { type: "DELETE_ITEM"; id: string };

function reducer(state: ScheduleState, action: Action): ScheduleState {
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
    useEffect(() => subscribeAuthInvalidation(() => {
        dispatch({ type: "RESET", state: initialState });
    }), [initialState]);
    const value = useMemo(() => ({state, dispatch}), [state]);
    return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useScheduleStore() {
    const ctx = useContext(ScheduleContext);
    if (!ctx) throw new Error("ScheduleProvider로 감싸야 해");
    return ctx;
}
