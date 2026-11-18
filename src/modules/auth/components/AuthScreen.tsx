import React, { ReactNode } from "react";
import {
    ActivityIndicator,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleProp,
    StyleSheet,
    Text,
    TextInput,
    TextInputProps,
    TextStyle,
    useWindowDimensions,
    View,
    ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../theme/ThemeContext";
import type { AppColors } from "../../theme/ThemeContext";
import Animated, { Keyframe, ReduceMotion } from "react-native-reanimated";

import { useSystemReduceMotion } from "../../performance/useSystemReduceMotion";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const APP_LOGO = require("../../../../assets/icon.png");


type AuthScreenProps = {
    title?: string;
    subtitle: string;
    children: ReactNode;
    footer?: ReactNode;
    onBack?: () => void;
    backDisabled?: boolean;
    backLabel?: string;
    signupStep?: 1 | 2;
    density?: AuthDensity;
    keyboardRevealRef?: React.RefObject<View | null>;
};

type AuthInputProps = TextInputProps & {
    label: string;
    icon: IconName;
    containerStyle?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
    inputRef?: React.Ref<TextInput>;
    errorMessage?: string;
};

type AuthPrimaryButtonProps = {
    label: string;
    disabled?: boolean;
    loading?: boolean;
    buttonRef?: React.Ref<View>;
    onPress: () => void;
};

type AuthDensity = "regular" | "compact";

const AuthDensityContext = React.createContext<AuthDensity>("regular");
const authStageIn = new Keyframe({
    0: { opacity: 0, transform: [{ translateX: 10 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }] },
}).duration(220).reduceMotion(ReduceMotion.System);

export function AuthScreen({
    title,
    subtitle,
    children,
    footer,
    onBack,
    backDisabled = false,
    backLabel,
    signupStep,
    density = "regular",
    keyboardRevealRef,
}: AuthScreenProps) {
    const insets = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const { mode, colors } = useTheme();
    const { fontScale } = useWindowDimensions();
    const styles = createStyles(colors, mode, density);
    const isCompact = density === "compact";
    const scrollRef = React.useRef<ScrollView>(null);
    const scrollOffset = React.useRef(0);
    const reduceMotion = useSystemReduceMotion();

    React.useEffect(() => {
        if (Platform.OS !== "ios" || !isFocused || !keyboardRevealRef) return;
        let active = true;
        const reveal = (keyboardTop: number) => {
            keyboardRevealRef.current?.measureInWindow((_x, top, _width, height) => {
                if (!active || height <= 0) return;
                const overlap = top + height + 12 - keyboardTop;
                if (overlap > 0) {
                    scrollRef.current?.scrollTo({ y: Math.max(0, scrollOffset.current) + overlap, animated: !reduceMotion });
                }
            });
        };
        const show = Keyboard.addListener("keyboardDidShow", ({ endCoordinates }) => reveal(endCoordinates.screenY));
        const frame = requestAnimationFrame(() => {
            const keyboard = Keyboard.metrics();
            if (keyboard) reveal(keyboard.screenY);
        });
        return () => {
            active = false;
            cancelAnimationFrame(frame);
            show.remove();
        };
    }, [isFocused, keyboardRevealRef, reduceMotion]);

    return (
        <AuthDensityContext.Provider value={density}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                accessibilityElementsHidden={!isFocused}
                importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
                style={styles.root}
            >
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

                <ScrollView
                    ref={scrollRef}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
                    contentContainerStyle={[
                        styles.content,
                        {
                            paddingTop: insets.top + (isCompact ? 8 : 14),
                            paddingBottom: Math.max(insets.bottom, 18) + (isCompact ? 14 : 28),
                        },
                    ]}
                >
                    {onBack ? (
                        <View style={[styles.topBar, backLabel && styles.labeledTopBar]}>
                            <Pressable
                                accessibilityRole="button"
                                onPress={onBack}
                                accessibilityLabel={backLabel ?? "이전 화면으로 돌아가기"}
                                accessibilityState={{ disabled: backDisabled }}
                                disabled={backDisabled}
                                style={({ pressed }) => [
                                    backLabel ? styles.labeledBackButton : styles.backButton,
                                    (pressed || backDisabled) && styles.pressed,
                                ]}
                            >
                                <Ionicons name="chevron-back-outline" size={20} color={colors.textPrimary} />
                                {backLabel ? <Text style={styles.backLabel}>{backLabel}</Text> : null}
                            </Pressable>
                        </View>
                    ) : null}

                    <Animated.View
                        key={signupStep ?? "auth"}
                        entering={authStageIn}
                        style={styles.body}
                    >
                        {signupStep ? (
                            <View style={styles.signupHeader}>
                                <View accessible accessibilityLabel={`가입 ${signupStep}/2단계, ${signupStep === 1 ? "계정 정보" : "필수 약관"}`} style={styles.signupProgress}>
                                    <Text style={styles.signupProgressText}>가입 {signupStep}/2 · {signupStep === 1 ? "계정 정보" : "필수 약관"}</Text>
                                    <View style={styles.signupProgressTrack}>
                                        <View style={[styles.signupProgressSegment, styles.signupProgressActive]} />
                                        <View style={[styles.signupProgressSegment, signupStep === 2 && styles.signupProgressActive]} />
                                    </View>
                                </View>
                                {title ? <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={styles.signupTitle}>{title}</Text> : null}
                                <Text style={styles.signupSubtitle}>{subtitle}</Text>
                            </View>
                        ) : (
                            <View style={styles.hero}>
                                <View style={styles.heroBrand}>
                                    <View style={styles.heroLogoWrap}>
                                        <Image source={APP_LOGO} resizeMode="cover" style={[styles.heroLogo, !title && fontScale <= 1.35 && styles.quietHeroLogo]} />
                                    </View>
                                    <Text style={styles.heroBrandText}>NoLate</Text>
                                </View>
                                {title ? <Text accessibilityRole="header" style={styles.title}>{title}</Text> : null}
                                <Text style={styles.subtitle}>{subtitle}</Text>
                            </View>
                        )}

                        <View style={styles.formPanel}>
                            {children}
                        </View>
                    </Animated.View>

                    {footer}
                </ScrollView>
            </KeyboardAvoidingView>
        </AuthDensityContext.Provider>
    );
}

export function AuthInput({
    label,
    icon,
    containerStyle,
    inputStyle,
    inputRef,
    errorMessage,
    placeholder,
    placeholderTextColor,
    accessibilityLabel,
    allowFontScaling = true,
    maxFontSizeMultiplier,
    secureTextEntry,
    onFocus,
    onBlur,
    ...inputProps
}: AuthInputProps) {
    const { colors, mode } = useTheme();
    const density = React.useContext(AuthDensityContext);
    const { fontScale } = useWindowDimensions();
    const styles = createStyles(colors, mode, density);
    const [passwordVisible, setPasswordVisible] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const isPasswordField = secureTextEntry === true;
    const errorColor = mode === "dark" ? "#FF9C96" : "#B42318";
    const inputFontScale = allowFontScaling
        ? Math.min(fontScale, maxFontSizeMultiplier || Infinity)
        : 1;
    const inputLineHeight = Math.ceil((density === "compact" ? 21 : 22) * inputFontScale);
    // UIKit can clip secure placeholders at standard sizes and other placeholders at larger sizes.
    const useTextPlaceholder = Platform.OS === "ios" && (isPasswordField || inputFontScale > 1.35);
    const labelAbove = fontScale <= 1.35;
    // iOS can miss repainting the secure glyphs after a visibility toggle and blur.
    const showPasswordMask = Platform.OS === "ios" && labelAbove && isPasswordField
        && !passwordVisible && !focused && !!inputProps.value;
    const placeholderColor = placeholderTextColor ?? colors.inputPlaceholder;
    const fieldLabel = <Text accessible={labelAbove ? false : undefined} style={[styles.fieldLabel, focused && { color: colors.textPrimary }]}>{label}</Text>;
    const fieldError = errorMessage ? (
        <Text accessibilityRole="alert" style={[styles.fieldError, !labelAbove && styles.fieldErrorInside, { color: errorColor }]}>
            {errorMessage}
        </Text>
    ) : null;
    const field = (
        <View
            style={[
                styles.field,
                labelAbove && styles.fieldWithLabelAbove,
                focused && { borderColor: colors.textSecondary, backgroundColor: colors.surface },
                errorMessage && { borderColor: errorColor, ...(labelAbove && { backgroundColor: mode === "dark" ? "#2A1D22" : "#FDF2F2" }) },
                containerStyle,
            ]}
        >
            <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.fieldIcon}
            >
                <Ionicons name={icon} size={19} color={colors.textSecondary} />
            </View>
            <View style={styles.fieldBody}>
                {!labelAbove && fieldLabel}
                <View>
                    <TextInput
                        {...inputProps}
                        ref={inputRef}
                        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
                        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
                        accessibilityLabel={accessibilityLabel ?? label}
                        accessibilityHint={errorMessage ?? inputProps.accessibilityHint}
                        allowFontScaling={allowFontScaling}
                        maxFontSizeMultiplier={maxFontSizeMultiplier}
                        placeholder={useTextPlaceholder ? undefined : placeholder}
                        placeholderTextColor={placeholderColor}
                        secureTextEntry={isPasswordField && !passwordVisible}
                        style={[styles.fieldInput, { color: colors.textPrimary, minHeight: inputLineHeight + 8 }, inputStyle,
                            showPasswordMask && styles.hiddenInputText]}
                    />
                    {showPasswordMask && (
                        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fieldPlaceholder}>
                            <Text style={[styles.fieldInput, { color: colors.textPrimary }, inputStyle]} numberOfLines={1}>
                                {"•".repeat(Math.min(inputProps.value?.length ?? 0, 32))}
                            </Text>
                        </View>
                    )}
                    {useTextPlaceholder && placeholder && !focused && !inputProps.value && (
                        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fieldPlaceholder}>
                            <Text style={[styles.fieldInput, { color: placeholderColor }, inputStyle]}
                                allowFontScaling={allowFontScaling} maxFontSizeMultiplier={maxFontSizeMultiplier} numberOfLines={1}>
                                {placeholder}
                            </Text>
                        </View>
                    )}
                </View>
                {!labelAbove && fieldError}
            </View>
            {isPasswordField ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={passwordVisible ? `${label} 숨기기` : `${label} 표시하기`}
                    accessibilityState={{ expanded: passwordVisible }}
                    hitSlop={6}
                    onPress={() => setPasswordVisible((visible) => !visible)}
                    style={({ pressed }) => [styles.fieldAction, pressed && styles.pressed]}
                >
                    <Ionicons
                        name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                        size={19}
                        color={colors.textSecondary}
                    />
                </Pressable>
            ) : null}
        </View>
    );
    return labelAbove ? (
        <View style={styles.labeledField}>
            {fieldLabel}
            {field}
            {fieldError}
        </View>
    ) : field;
}

export function AuthPrimaryButton({
    label,
    disabled,
    loading = false,
    buttonRef,
    onPress,
}: AuthPrimaryButtonProps) {
    const { colors, mode } = useTheme();
    const reduceMotion = useSystemReduceMotion();
    const density = React.useContext(AuthDensityContext);
    const styles = createStyles(colors, mode, density);

    return (
        <Pressable
            ref={buttonRef}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: Boolean(disabled || loading), busy: loading }}
            disabled={disabled || loading}
            onPress={onPress}
            style={({ pressed }) => [
                styles.primaryButton,
                {
                    backgroundColor: colors.selectedDayBg,
                    opacity: disabled || loading ? 0.58 : pressed ? 0.82 : 1,
                    transform: [{ scale: pressed && !disabled && !loading && !reduceMotion ? 0.99 : 1 }],
                },
            ]}
        >
            <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                {label}
            </Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.primaryAccessory}>
                {loading
                    ? reduceMotion ? null : <ActivityIndicator size="small" color={colors.selectedDayText} />
                    : <Ionicons name="arrow-forward-outline" size={18} color={colors.selectedDayText} />}
            </View>
        </Pressable>
    );
}

function createStyles(colors: AppColors, mode: "dark" | "light", density: AuthDensity = "regular") {
    const isDark = mode === "dark";
    const isCompact = density === "compact";

    return StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: isDark ? "#0F1115" : "#F8F9FB",
        },
        content: {
            flexGrow: 1,
            paddingHorizontal: 20,
        },
        topBar: {
            minHeight: isCompact ? 38 : 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
        },
        body: {
            flexGrow: 1,
        },
        labeledTopBar: { justifyContent: "flex-start", minHeight: 44 },
        labeledBackButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            minHeight: 44,
        },
        backLabel: { color: isDark ? "#9BBEFF" : "#205CC4", fontSize: 14, fontWeight: "600" },
        signupHeader: {
            paddingTop: 12,
            paddingBottom: 20,
            gap: 7,
        },
        signupProgress: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 },
        signupProgressText: { flexShrink: 1, color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
        signupProgressTrack: { flexDirection: "row", gap: 5 },
        signupProgressSegment: { width: 22, height: 4, borderRadius: 2, backgroundColor: colors.border },
        signupProgressActive: { backgroundColor: isDark ? "#9BBEFF" : "#205CC4" },
        signupTitle: { color: colors.textPrimary, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
        signupSubtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
        primaryAccessory: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
        brandWrap: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
        },
        brandLogo: {
            width: 28,
            height: 28,
            borderRadius: 8,
        },
        brandText: {
            color: colors.textPrimary,
            fontSize: 18,
            fontWeight: "700",
        },
        backButton: {
            position: "absolute",
            left: 0,
            width: 42,
            height: 42,
            borderRadius: 21,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
            backgroundColor: isDark ? "#1B1D22" : "rgba(255,255,255,0.96)",
            alignItems: "center",
            justifyContent: "center",
        },
        hero: {
            alignItems: "center",
            paddingTop: isCompact ? 14 : 18,
            paddingBottom: isCompact ? 16 : 22,
        },
        heroBrand: {
            alignItems: "center",
            gap: 7,
            marginBottom: 12,
        },
        heroLogoWrap: {
            width: 64,
            height: 64,
            borderRadius: 18,
            shadowColor: "#173465",
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: isDark ? 0.26 : 0.14,
            shadowRadius: 12,
        },
        heroLogo: {
            position: "relative",
            width: 64,
            height: 64,
            borderRadius: 18,
            zIndex: 10,
            elevation: 10,
            shadowColor: "#0077FF",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isDark ? 0.54 : 0.34,
            shadowRadius: isCompact ? 25 : 30,
        },
        quietHeroLogo: { shadowOpacity: 0, elevation: 0 },
        heroBrandText: {
            color: colors.textPrimary,
            fontSize: isCompact ? 17 : 18,
            lineHeight: isCompact ? 21 : 22,
            fontWeight: "700",
            textAlign: "center",
            zIndex: 2,
        },
        title: {
            color: colors.textPrimary,
            fontSize: 30,
            lineHeight: 36,
            fontWeight: "700",
            textAlign: "center",
        },
        subtitle: {
            color: colors.textSecondary,
            marginTop: isCompact ? 7 : 8,
            maxWidth: 270,
            fontSize: 13,
            lineHeight: 20,
            fontWeight: "400",
            textAlign: "center",
        },
        formPanel: {
            padding: 0,
            gap: isCompact ? 10 : 12,
        },
        field: {
            minHeight: isCompact ? 60 : 68,
            borderRadius: 14,
            borderWidth: 1,
            backgroundColor: colors.surface,
            borderColor: colors.inputBorder,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: isCompact ? 12 : 14,
            gap: isCompact ? 10 : 12,
        },
        labeledField: { gap: 4 },
        fieldWithLabelAbove: {
            minHeight: isCompact ? 48 : 54,
            backgroundColor: colors.inputBackground,
        },
        fieldIcon: {
            width: 30,
            alignItems: "center",
        },
        fieldBody: {
            flex: 1,
            minWidth: 0,
            paddingVertical: isCompact ? 7 : 9,
        },
        fieldAction: {
            width: 44,
            height: 44,
            marginRight: -5,
            alignItems: "center",
            justifyContent: "center",
        },
        fieldLabel: {
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "500",
            marginBottom: 3,
        },
        fieldError: { fontSize: 13 },
        fieldErrorInside: { marginTop: 4 },
        fieldInput: {
            paddingVertical: 0,
            fontSize: isCompact ? 15 : 16,
            fontWeight: "500",
        },
        hiddenInputText: { color: "transparent" },
        fieldPlaceholder: {
            ...StyleSheet.absoluteFillObject,
            justifyContent: "center",
        },
        primaryButton: {
            minHeight: isCompact ? 52 : 56,
            borderRadius: isCompact ? 17 : 18,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 4,
        },
        primaryButtonText: {
            fontSize: 16,
            fontWeight: "600",
        },
        pressed: {
            opacity: 0.58,
        },
    });
}
