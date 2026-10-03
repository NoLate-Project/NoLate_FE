import styles from "../../src/routeSupport/schedule/categories.styles";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    ActionSheetIOS,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    Text,
    TextInput,
    View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createScheduleCategoryToApi,
    deleteScheduleCategoryFromApi,
    getScheduleCategoryMovePreviewFromApi,
    getScheduleCategoriesFromApi,
    moveScheduleCategoryToApi,
    type ScheduleCategoryItem,
    type ScheduleCategoryMovePreview,
    updateScheduleCategoryToApi,
} from "../../src/api/scheduleCategories";
import {
    getScheduleCalendars,
    type ScheduleCalendar,
} from "../../src/api/scheduleCalendars";
import { measurePerformanceInteraction } from "../../src/modules/performance/interactionPerformance";
import { runAfterScreenTransition } from "../../src/modules/performance/runAfterScreenTransition";
import { useScreenContentReadyPerformance } from "../../src/modules/performance/useScreenContentReadyPerformance";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import CategoryLoadErrorBanner from "../../src/modules/schedule/components/form/CategoryLoadErrorBanner";
import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { getCategorySharePermissionLabel } from "../../src/modules/share/sharePermissionPresentation";
import {
    canManageScheduleCategoryMetadata,
    countOwnedScheduleCategories,
} from "../../src/modules/schedule/categoryPermissions";
import { getCategoryMoveDestinationCalendars } from "../../src/modules/schedule/calendarPermissions";
import { canManageScheduleCategoryAudience } from "../../src/modules/schedule/categoryMove";
import {
    getPersonalCategoryActionAtIndex,
    PERSONAL_CATEGORY_ACTION_CANCEL_INDEX,
    PERSONAL_CATEGORY_ACTION_DELETE_INDEX,
    PERSONAL_CATEGORY_ACTION_SHEET_OPTIONS,
    type PersonalCategoryManagementAction,
} from "../../src/modules/schedule/categoryManagementActions";
import BrandedLoader from "../../src/ui/BrandedLoader";
import CategoryMoveSheet, { type CategoryMoveDestinationId } from "./CategoryMoveSheet";

const CATEGORY_COLORS = [
    "#ff3b30",
    "#ff9500",
    "#34c759",
    "#007aff",
    "#5856d6",
    "#af52de",
    "#ff2d55",
];
const CATEGORY_COLOR_LABELS = ["빨강", "주황", "초록", "파랑", "남색", "보라", "분홍"];

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleCategoriesScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ calendarId?: string; calendarTitle?: string }>();
    const calendarId = useMemo(() => {
        const raw = Array.isArray(params.calendarId) ? params.calendarId[0] : params.calendarId;
        const parsed = raw ? Number(raw) : NaN;
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }, [params.calendarId]);
    const calendarTitle = Array.isArray(params.calendarTitle)
        ? params.calendarTitle[0]
        : params.calendarTitle;
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const hasCategorySnapshotRef = useRef(state.categories.length > 0);
    // A category can move while this screen still holds a cached row from its old calendar.
    // Keep cached capabilities non-interactive until both server snapshots are refreshed.
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newColor, setNewColor] = useState(CATEGORY_COLORS[0]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingColor, setEditingColor] = useState(CATEGORY_COLORS[0]);
    const [sharingCategory, setSharingCategory] = useState<ScheduleCategoryItem | null>(null);
    const [movingCategory, setMovingCategory] = useState<ScheduleCategoryItem | null>(null);
    const [calendarMemberships, setCalendarMemberships] = useState<ScheduleCalendar[]>([]);
    const [calendarMembershipsLoaded, setCalendarMembershipsLoaded] = useState(false);
    const [moveCalendars, setMoveCalendars] = useState<ScheduleCalendar[]>([]);
    const [moveCalendarsLoading, setMoveCalendarsLoading] = useState(false);
    const [moveCalendarError, setMoveCalendarError] = useState<string | null>(null);
    const [moveDestinationId, setMoveDestinationId] = useState<CategoryMoveDestinationId | null>(null);
    const [movePreview, setMovePreview] = useState<ScheduleCategoryMovePreview | null>(null);
    const [movePreviewLoading, setMovePreviewLoading] = useState(false);
    const [movePreviewError, setMovePreviewError] = useState<string | null>(null);
    const [moving, setMoving] = useState(false);
    const loadSequenceRef = useRef(0);
    const loadPendingRef = useRef(false);
    const mutationPendingRef = useRef(false);
    const moveCalendarLoadPendingRef = useRef(false);
    const movePreviewSequenceRef = useRef(0);
    const calendarAccessLoading = calendarId !== null && !calendarMembershipsLoaded;
    const controlsBusy = loading || calendarAccessLoading || saving || moving || movePreviewLoading;

    useScreenContentReadyPerformance(
        "category.settings_content_ready",
        "/schedule/categories",
        !loading && !calendarAccessLoading,
    );

    const calendarRoleById = useMemo(
        () => new Map(calendarMemberships.map((calendar) => [calendar.id, calendar.myRole])),
        [calendarMemberships],
    );
    const currentCalendarRole = calendarId == null ? null : calendarRoleById.get(calendarId);
    const canCreateCategory = calendarId === null || (
        calendarMembershipsLoaded
        && (currentCalendarRole === "OWNER" || currentCalendarRole === "EDITOR")
    );
    const categoryList = useMemo(() => {
        const joinedCalendarIds = new Set(calendarMemberships.map((calendar) => calendar.id));
        return [...state.categories].filter((category) => {
            if (!category.id) return false;
            if (calendarId !== null) return category.calendarId === calendarId;
            if ((category.calendarId ?? null) === null) return true;
            // A direct category grant remains visible after its owner moves the category.
            // Calendar members manage it inside that calendar; direct-only recipients keep
            // finding it alongside their personal/received categories.
            return calendarMembershipsLoaded
                && category.shared === true
                && !joinedCalendarIds.has(category.calendarId!);
        }) as ScheduleCategoryItem[];
    }, [calendarId, calendarMemberships, calendarMembershipsLoaded, state.categories]);
    const categoryCapabilitiesReady = !loading && loadError === null && calendarMembershipsLoaded;
    const ownedCategoryCount = useMemo(
        () => calendarId === null ? countOwnedScheduleCategories(categoryList) : categoryList.length,
        [calendarId, categoryList]
    );

    const loadCategories = useCallback(async () => {
        if (loadPendingRef.current || mutationPendingRef.current) return;
        const sequence = loadSequenceRef.current + 1;
        loadSequenceRef.current = sequence;
        loadPendingRef.current = true;
        setLoading(true);
        setLoadError(null);
        try {
            const categories = await measurePerformanceInteraction(
                "category.list_load",
                "/schedule/categories",
                getScheduleCategoriesFromApi,
                "NETWORK",
            );
            if (loadSequenceRef.current !== sequence) return;
            hasCategorySnapshotRef.current = true;
            dispatch({ type: "SET_CATEGORIES", categories });
        } catch (error) {
            if (loadSequenceRef.current !== sequence) return;
            setLoadError(getErrorMessage(error));
        } finally {
            if (loadSequenceRef.current === sequence) {
                loadPendingRef.current = false;
                setLoading(false);
            }
        }
    }, [dispatch]);

    const loadCalendarMemberships = useCallback(async () => {
        try {
            setCalendarMemberships(await getScheduleCalendars());
        } catch {
            // Capability checks fail closed when memberships cannot be verified.
            setCalendarMemberships([]);
        } finally {
            setCalendarMembershipsLoaded(true);
        }
    }, []);

    useEffect(() => {
        const task = runAfterScreenTransition(() => {
            loadCategories();
            loadCalendarMemberships().catch(() => undefined);
        });
        return () => {
            task.cancel();
            loadSequenceRef.current += 1;
            loadPendingRef.current = false;
        };
    }, [loadCalendarMemberships, loadCategories]);

    const beginCategoryMutation = useCallback(() => {
        if (mutationPendingRef.current) return false;
        // A background refresh may have started from the cached category snapshot.
        // Invalidate that response before mutating so it cannot restore pre-mutation data.
        loadSequenceRef.current += 1;
        loadPendingRef.current = false;
        setLoading(false);
        mutationPendingRef.current = true;
        return true;
    }, []);

    const loadMoveCalendars = useCallback(async (sourceCalendarId?: number | null) => {
        if (moveCalendarLoadPendingRef.current) return;
        moveCalendarLoadPendingRef.current = true;
        setMoveCalendarsLoading(true);
        setMoveCalendarError(null);
        try {
            const calendars = await getScheduleCalendars();
            setCalendarMemberships(calendars);
            setCalendarMembershipsLoaded(true);
            setMoveCalendars(getCategoryMoveDestinationCalendars(calendars, sourceCalendarId));
        } catch (error) {
            setMoveCalendarError(getErrorMessage(error));
        } finally {
            moveCalendarLoadPendingRef.current = false;
            setMoveCalendarsLoading(false);
        }
    }, []);

    const closeMoveSheet = useCallback(() => {
        if (moving) return;
        movePreviewSequenceRef.current += 1;
        setMovePreviewLoading(false);
        setMovingCategory(null);
        setMoveDestinationId(null);
        setMovePreview(null);
        setMovePreviewError(null);
    }, [moving]);

    const openMoveSheet = useCallback((category: ScheduleCategoryItem) => {
        if (
            controlsBusy
            || mutationPendingRef.current
            || !canManageScheduleCategoryAudience(
                category,
                category.calendarId == null ? null : calendarRoleById.get(category.calendarId),
            )
        ) return;
        setMovingCategory(category);
        setMoveDestinationId(null);
        setMovePreview(null);
        setMovePreviewError(null);
        // Permissions and calendar lifecycle can change on the management screen,
        // so refresh destinations every time this sheet opens.
        loadMoveCalendars(category.calendarId).catch(() => undefined);
    }, [calendarRoleById, controlsBusy, loadMoveCalendars]);

    const loadMovePreview = useCallback(async (
        category: ScheduleCategoryItem,
        destinationId: CategoryMoveDestinationId,
    ) => {
        const sequence = movePreviewSequenceRef.current + 1;
        movePreviewSequenceRef.current = sequence;
        setMoveDestinationId(destinationId);
        setMovePreview(null);
        setMovePreviewError(null);
        setMovePreviewLoading(true);
        try {
            const preview = await getScheduleCategoryMovePreviewFromApi(
                category.id,
                destinationId,
            );
            if (movePreviewSequenceRef.current !== sequence) return;
            setMovePreview(preview);
        } catch (error) {
            if (movePreviewSequenceRef.current !== sequence) return;
            setMovePreviewError(getErrorMessage(error));
        } finally {
            if (movePreviewSequenceRef.current === sequence) {
                setMovePreviewLoading(false);
            }
        }
    }, []);

    const selectMoveDestination = useCallback((destinationId: CategoryMoveDestinationId) => {
        if (!movingCategory || moving || movePreviewLoading) return;
        loadMovePreview(movingCategory, destinationId).catch(() => undefined);
    }, [loadMovePreview, movePreviewLoading, moving, movingCategory]);

    const retryMovePreview = useCallback(() => {
        if (!movingCategory || moveDestinationId === null || moving || movePreviewLoading) return;
        loadMovePreview(movingCategory, moveDestinationId).catch(() => undefined);
    }, [loadMovePreview, moveDestinationId, movePreviewLoading, moving, movingCategory]);

    const moveCategory = useCallback(async () => {
        if (
            !movingCategory
            || moveDestinationId === null
            || !movePreview
            || moving
            || mutationPendingRef.current
        ) return;
        const destination = moveCalendars.find((calendar) => calendar.id === moveDestinationId);
        if (!destination) return;

        if (!beginCategoryMutation()) return;
        setMoving(true);
        try {
            const result = await moveScheduleCategoryToApi(movingCategory.id, {
                calendarId: moveDestinationId,
            });
            dispatch({ type: "REMOVE_CATEGORY", id: result.sourceCategoryId });
            dispatch({ type: "UPSERT_CATEGORY", category: result.category });
            dispatch({
                type: "MOVE_CATEGORY_ITEMS",
                sourceCategoryId: result.sourceCategoryId,
                calendarId: moveDestinationId,
                category: result.category,
            });
            // Moving the final personal category may make the backend create a
            // replacement default category. Reconcile with the server so that
            // fallback is immediately selectable without reopening the app.
            const refreshedCategories = await getScheduleCategoriesFromApi().catch(() => null);
            if (refreshedCategories) {
                hasCategorySnapshotRef.current = true;
                dispatch({ type: "SET_CATEGORIES", categories: refreshedCategories });
            }
            movePreviewSequenceRef.current += 1;
            setMovingCategory(null);
            setMoveDestinationId(null);
            setMovePreview(null);
            setMovePreviewError(null);
            Alert.alert(
                "카테고리 이동 완료",
                `“${movingCategory.title}”의 일정 ${result.movedScheduleCount}개를 “${destination.title}”으로 이동했습니다. 기존 직접 공유 권한은 유지됩니다.`,
            );
        } catch (error) {
            Alert.alert("카테고리 이동 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setMoving(false);
        }
    }, [
        dispatch,
        moveDestinationId,
        moveCalendars,
        movePreview,
        moving,
        movingCategory,
        beginCategoryMutation,
    ]);

    const createCategory = async () => {
        const title = newTitle.trim();
        if (!canCreateCategory || !title || controlsBusy || mutationPendingRef.current) return;

        if (!beginCategoryMutation()) return;
        setSaving(true);
        try {
            const category = await createScheduleCategoryToApi(title, newColor, undefined, calendarId);
            dispatch({ type: "UPSERT_CATEGORY", category });
            setNewTitle("");
            setNewColor(CATEGORY_COLORS[categoryList.length % CATEGORY_COLORS.length]);
        } catch (error) {
            Alert.alert("카테고리 추가 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
        }
    };

    const startEditing = (category: { id: string; title: string; color: string }) => {
        setEditingId(category.id);
        setEditingTitle(category.title);
        setEditingColor(category.color);
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditingTitle("");
        setEditingColor(CATEGORY_COLORS[0]);
    };

    const saveEditing = async () => {
        if (!editingId || !editingTitle.trim() || controlsBusy || mutationPendingRef.current) return;

        if (!beginCategoryMutation()) return;
        setSaving(true);
        try {
            const category = await updateScheduleCategoryToApi(editingId, {
                title: editingTitle.trim(),
                color: editingColor,
            });
            dispatch({ type: "UPSERT_CATEGORY", category });
            cancelEditing();
        } catch (error) {
            Alert.alert("카테고리 수정 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
        }
    };

    const confirmDelete = (categoryId: string) => {
        if (controlsBusy || mutationPendingRef.current) return;
        if (ownedCategoryCount <= 1) {
            Alert.alert("카테고리 삭제", "카테고리는 최소 1개 이상 필요합니다.");
            return;
        }

        Alert.alert("카테고리 삭제", "이 카테고리를 삭제할까요? 기존 일정의 표시 정보는 유지됩니다.", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: () => {
                    deleteCategory(categoryId).catch(() => undefined);
                },
            },
        ]);
    };

    const deleteCategory = async (categoryId: string) => {
        if (controlsBusy || mutationPendingRef.current) return;
        if (!beginCategoryMutation()) return;
        setSaving(true);
        try {
            await deleteScheduleCategoryFromApi(categoryId);
            dispatch({ type: "REMOVE_CATEGORY", id: categoryId });
            if (editingId === categoryId) cancelEditing();
        } catch (error) {
            Alert.alert("카테고리 삭제 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setSaving(false);
        }
    };

    const runPersonalCategoryAction = (
        action: PersonalCategoryManagementAction,
        category: ScheduleCategoryItem,
        metadataWritable: boolean,
        canManageAudience: boolean,
    ) => {
        if (controlsBusy || mutationPendingRef.current) return;
        if ((action === "EDIT" || action === "DELETE") && !metadataWritable) return;
        if ((action === "SHARE" || action === "MOVE") && !canManageAudience) return;

        switch (action) {
            case "SHARE":
                setSharingCategory(category);
                return;
            case "MOVE":
                openMoveSheet(category);
                return;
            case "EDIT":
                startEditing(category);
                return;
            case "DELETE":
                confirmDelete(category.id);
                return;
        }
    };

    const showAndroidEditDeleteActions = (
        category: ScheduleCategoryItem,
        metadataWritable: boolean,
        canManageAudience: boolean,
    ) => {
        Alert.alert(
            `${category.title} 카테고리 수정·삭제`,
            metadataWritable ? "원하는 작업을 선택해 주세요." : "이 카테고리를 수정하거나 삭제할 권한이 없습니다.",
            metadataWritable
                ? [
                    { text: "취소", style: "cancel" },
                    {
                        text: "카테고리 삭제",
                        style: "destructive",
                        onPress: () => runPersonalCategoryAction("DELETE", category, metadataWritable, canManageAudience),
                    },
                    {
                        text: "카테고리 수정",
                        onPress: () => runPersonalCategoryAction("EDIT", category, metadataWritable, canManageAudience),
                    },
                ]
                : [{ text: "확인", style: "cancel" }],
        );
    };

    const showPersonalCategoryActions = (
        category: ScheduleCategoryItem,
        metadataWritable: boolean,
        canManageAudience: boolean,
    ) => {
        if (controlsBusy || mutationPendingRef.current) return;

        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: `${category.title} 카테고리`,
                    message: "원하는 작업을 선택해 주세요.",
                    options: [...PERSONAL_CATEGORY_ACTION_SHEET_OPTIONS],
                    cancelButtonIndex: PERSONAL_CATEGORY_ACTION_CANCEL_INDEX,
                    destructiveButtonIndex: PERSONAL_CATEGORY_ACTION_DELETE_INDEX,
                    disabledButtonIndices: metadataWritable ? undefined : [2, 3],
                },
                (buttonIndex) => {
                    const action = getPersonalCategoryActionAtIndex(buttonIndex);
                    if (action) runPersonalCategoryAction(action, category, metadataWritable, canManageAudience);
                },
            );
            return;
        }

        // Android's native Alert supports at most three buttons. Keep the two
        // primary category-transfer actions at the first level and group the
        // destructive/editing choices behind a clearly labelled third button.
        Alert.alert(
            `${category.title} 카테고리 작업`,
            "원하는 작업을 선택해 주세요.",
            [
                {
                    text: "카테고리 공유",
                    onPress: () => runPersonalCategoryAction("SHARE", category, metadataWritable, canManageAudience),
                },
                {
                    text: "다른 캘린더로 이동",
                    onPress: () => runPersonalCategoryAction("MOVE", category, metadataWritable, canManageAudience),
                },
                {
                    text: "카테고리 수정 또는 삭제",
                    onPress: () => showAndroidEditDeleteActions(category, metadataWritable, canManageAudience),
                },
            ],
            { cancelable: true },
        );
    };

    const goBack = () => {
        if (loadPendingRef.current || mutationPendingRef.current) {
            Alert.alert("처리 중이에요", "카테고리 작업이 끝난 뒤 돌아가 주세요.");
            return;
        }
        if (router.canGoBack()) router.back();
        else router.replace("/schedule");
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}
        >
            <StatusBar
                barStyle={mode === "dark" ? "light-content" : "dark-content"}
                backgroundColor={colors.background}
            />
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    onPress={goBack}
                    accessibilityLabel="뒤로 가기"
                    accessibilityState={{ busy: controlsBusy }}
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons accessible={false} name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.textPrimary }]}>
                    {calendarId === null ? "개인 카테고리" : `${calendarTitle || "공유 캘린더"} 카테고리`}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 캘린더 관리"
                    onPress={() => router.push("/schedule/calendars")}
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons accessible={false} name="people-outline" size={21} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 16) + 20 },
                ]}
            >
                {canCreateCategory ? (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>새 카테고리</Text>
                        <TextInput
                            accessibilityLabel="새 카테고리 이름"
                            textContentType="none"
                            autoComplete="off"
                            secureTextEntry={false}
                            value={newTitle}
                            editable={!controlsBusy}
                            onChangeText={setNewTitle}
                            onSubmitEditing={createCategory}
                            maxLength={80}
                            placeholder="카테고리 이름"
                            placeholderTextColor={colors.inputPlaceholder}
                            style={[
                                styles.input,
                                {
                                    backgroundColor: colors.inputBackground,
                                    borderColor: colors.inputBorder,
                                    color: colors.textPrimary,
                                },
                            ]}
                        />
                        <ColorPicker value={newColor} onChange={setNewColor} disabled={controlsBusy} />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="카테고리 추가"
                            accessibilityState={{ disabled: !newTitle.trim() || controlsBusy, busy: saving }}
                            disabled={!newTitle.trim() || controlsBusy}
                            onPress={createCategory}
                            style={({ pressed }) => [
                                styles.primaryButton,
                                {
                                    backgroundColor: colors.selectedDayBg,
                                    opacity: !newTitle.trim() || controlsBusy ? 0.4 : pressed ? 0.75 : 1,
                                },
                            ]}
                        >
                            {saving ? (
                                <BrandedLoader
                                    size="button"
                                    variant="schedule"
                                    accessibilityLabel="카테고리를 추가하고 있어요"
                                />
                            ) : (
                                <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                                    추가
                                </Text>
                            )}
                        </Pressable>
                    </View>
                ) : null}

                <View style={styles.listHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>카테고리 목록</Text>
                    {loading || calendarAccessLoading ? (
                        <BrandedLoader
                            size="button"
                            variant="schedule"
                            accessibilityLabel="카테고리를 불러오고 있어요"
                        />
                    ) : null}
                </View>

                {loadError ? (
                    <CategoryLoadErrorBanner
                        retrying={controlsBusy}
                        onRetry={() => {
                            if (!saving) loadCategories();
                        }}
                    />
                ) : null}

                {categoryList.map((category) => {
                    const editing = editingId === category.id;
                    const calendarRole = category.calendarId == null
                        ? null
                        : calendarRoleById.get(category.calendarId);
                    const isCalendarCategory = category.calendarId != null && calendarRole != null;
                    const isReceivedDirectShare = category.shared === true && calendarRole == null;
                    const metadataWritable = categoryCapabilitiesReady
                        && canManageScheduleCategoryMetadata(category, calendarRole);
                    const canManageAudience = categoryCapabilitiesReady
                        && canManageScheduleCategoryAudience(category, calendarRole);
                    return (
                        <View
                            key={category.id}
                            style={[
                                styles.categoryCard,
                                { backgroundColor: colors.surface, borderColor: colors.border },
                            ]}
                        >
                            {editing ? (
                                <View style={styles.editBody}>
                                    <TextInput
                                        autoFocus
                                        accessibilityLabel={`${category.title} 카테고리 이름 수정`}
                                        textContentType="none"
                                        autoComplete="off"
                                        secureTextEntry={false}
                                        value={editingTitle}
                                        editable={!controlsBusy}
                                        onChangeText={setEditingTitle}
                                        onSubmitEditing={saveEditing}
                                        maxLength={80}
                                        placeholder="카테고리 이름"
                                        placeholderTextColor={colors.inputPlaceholder}
                                        style={[
                                            styles.input,
                                            {
                                                backgroundColor: colors.inputBackground,
                                                borderColor: colors.inputBorder,
                                                color: colors.textPrimary,
                                            },
                                        ]}
                                    />
                                    <ColorPicker value={editingColor} onChange={setEditingColor} disabled={controlsBusy} />
                                    <View style={styles.editActions}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="카테고리 수정 취소"
                                            accessibilityState={{ disabled: controlsBusy }}
                                            disabled={controlsBusy}
                                            onPress={cancelEditing}
                                            style={[
                                                styles.secondaryButton,
                                                { borderColor: colors.border },
                                                controlsBusy && styles.disabledControl,
                                            ]}
                                        >
                                            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
                                                취소
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="카테고리 수정 저장"
                                            accessibilityState={{ disabled: !editingTitle.trim() || controlsBusy, busy: saving }}
                                            disabled={!editingTitle.trim() || controlsBusy}
                                            onPress={saveEditing}
                                            style={({ pressed }) => [
                                                styles.editSaveButton,
                                                {
                                                    backgroundColor: colors.selectedDayBg,
                                                    opacity: !editingTitle.trim() || controlsBusy ? 0.4 : pressed ? 0.75 : 1,
                                                },
                                            ]}
                                        >
                                            <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                                                저장
                                            </Text>
                                        </Pressable>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.categoryRow}>
                                    <View style={styles.categoryInfo}>
                                        <View style={[styles.categoryDot, { backgroundColor: category.color }]} />
                                        <View style={styles.categoryTitleWrap}>
                                            <View style={styles.categoryTitleRow}>
                                                <Text style={[styles.categoryTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                                                    {category.title}
                                                </Text>
                                                {isCalendarCategory && (
                                                    <View style={[styles.sharedBadge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                                                        <Ionicons accessible={false} name="calendar-outline" size={13} color={colors.textSecondary} />
                                                        <Text style={[styles.sharedBadgeText, { color: colors.textSecondary }]}>캘린더 소속</Text>
                                                    </View>
                                                )}
                                                {isReceivedDirectShare && (
                                                    <View style={[styles.sharedBadge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                                                        <Ionicons accessible={false} name="people-outline" size={13} color={colors.textSecondary} />
                                                        <Text style={[styles.sharedBadgeText, { color: colors.textSecondary }]}>
                                                            공유됨
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                            {isReceivedDirectShare && (
                                                <Text style={[styles.categoryAssist, { color: colors.textSecondary }]} numberOfLines={1}>
                                                    받은 카테고리 · {getCategorySharePermissionLabel(category.sharePermission)}
                                                </Text>
                                            )}
                                        </View>
                                    </View>
                                    <View style={styles.rowActions}>
                                        {canManageAudience ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={() => showPersonalCategoryActions(
                                                    category,
                                                    metadataWritable,
                                                    canManageAudience,
                                                )}
                                                accessibilityLabel={`${category.title} 카테고리 작업 메뉴`}
                                                accessibilityHint="공유와 권한 관리, 다른 캘린더로 이동, 수정 또는 삭제 작업을 엽니다"
                                                accessibilityState={{ disabled: controlsBusy }}
                                                disabled={controlsBusy}
                                                style={({ pressed }) => [
                                                    styles.iconAction,
                                                    { opacity: controlsBusy ? 0.32 : pressed ? 0.55 : 1 },
                                                ]}
                                            >
                                                <Ionicons accessible={false} name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
                                            </Pressable>
                                        ) : metadataWritable ? (
                                            <>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${category.title} 수정`}
                                                    accessibilityState={{ disabled: controlsBusy }}
                                                    onPress={() => startEditing(category)}
                                                    disabled={controlsBusy}
                                                    style={({ pressed }) => [
                                                        styles.iconAction,
                                                        { opacity: controlsBusy ? 0.32 : pressed ? 0.55 : 1 },
                                                    ]}
                                                >
                                                    <Ionicons accessible={false} name="create-outline" size={20} color={colors.textPrimary} />
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${category.title} 삭제`}
                                                    accessibilityState={{ disabled: controlsBusy }}
                                                    onPress={() => confirmDelete(category.id)}
                                                    disabled={controlsBusy}
                                                    style={({ pressed }) => [
                                                        styles.iconAction,
                                                        { opacity: controlsBusy ? 0.32 : pressed ? 0.55 : 1 },
                                                    ]}
                                                >
                                                    <Ionicons
                                                        accessible={false}
                                                        name="trash-outline"
                                                        size={20}
                                                        color={mode === "dark" ? "#ff6961" : "#d70015"}
                                                    />
                                                </Pressable>
                                            </>
                                        ) : null}
                                    </View>
                                </View>
                            )}
                        </View>
                    );
                })}
                {!loading && !calendarAccessLoading && !loadError && categoryList.length === 0 ? (
                    <View
                        style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                        <Ionicons accessible={false} name="folder-open-outline" size={28} color={colors.textSecondary} />
                        <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>카테고리가 없어요</Text>
                        <Text style={[styles.emptyCaption, { color: colors.textSecondary }]}>
                            {canCreateCategory
                                ? "위에서 첫 카테고리를 추가해 주세요."
                                : "이 캘린더의 카테고리를 관리할 권한이 없어요."}
                        </Text>
                    </View>
                ) : null}
            </ScrollView>
            <ShareInvitationSheet
                visible={!!sharingCategory}
                resourceType="category"
                resourceId={sharingCategory?.id}
                title={sharingCategory?.title ?? "카테고리"}
                subtitle="현재와 앞으로 추가되는 일정에 보기 또는 편집 권한을 부여합니다"
                onClose={() => setSharingCategory(null)}
            />
            <CategoryMoveSheet
                visible={!!movingCategory}
                category={movingCategory}
                calendars={moveCalendars}
                selectedDestinationId={moveDestinationId}
                preview={movePreview}
                loadingCalendars={moveCalendarsLoading}
                calendarError={moveCalendarError}
                loadingPreview={movePreviewLoading}
                previewError={movePreviewError}
                moving={moving}
                onClose={closeMoveSheet}
                onSelectDestination={selectMoveDestination}
                onRetryCalendars={() => {
                    loadMoveCalendars(movingCategory?.calendarId).catch(() => undefined);
                }}
                onRetryPreview={retryMovePreview}
                onConfirm={() => {
                    moveCategory().catch(() => undefined);
                }}
                onManageCalendars={() => {
                    setMoveCalendars([]);
                    setMoveCalendarError(null);
                    closeMoveSheet();
                    router.push("/schedule/calendars");
                }}
            />
        </KeyboardAvoidingView>
    );
}

function ColorPicker({
    value,
    onChange,
    disabled = false,
}: {
    value: string;
    onChange: (color: string) => void;
    disabled?: boolean;
}) {
    const { colors } = useTheme();

    return (
        <View style={styles.colorRow}>
            {CATEGORY_COLORS.map((color, index) => {
                const selected = color === value;
                const selectionBorder = {
                    borderColor: selected ? colors.textPrimary : "transparent",
                };
                return (
                    <Pressable
                        key={color}
                        accessibilityRole="radio"
                        accessibilityLabel={`${CATEGORY_COLOR_LABELS[index]} 색상`}
                        accessibilityState={{ selected, disabled }}
                        disabled={disabled}
                        onPress={() => onChange(color)}
                        style={[
                            styles.colorButton,
                            disabled && styles.disabledControl,
                            selectionBorder,
                        ]}
                    >
                        <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                    </Pressable>
                );
            })}
        </View>
    );
}
