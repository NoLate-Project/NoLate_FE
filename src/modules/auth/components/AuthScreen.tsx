import React, { ReactNode } from "react";
import {
    Image,
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
    View,
    ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../theme/ThemeContext";
import type { AppColors } from "../../theme/ThemeContext";
import BrandedLoader from "../../../ui/BrandedLoader";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const APP_LOGO = require("../../../../assets/icon.png");
const APP_LOGO_GLOW = require("../../../../assets/auth-logo-glow.png");

type AuthScreenProps = {
    title?: string;
    subtitle: string;
    children: ReactNode;
    footer?: ReactNode;
    onBack?: () => void;
    backDisabled?: boolean;
    density?: AuthDensity;
};

type AuthInputProps = TextInputProps & {
    label: string;
    icon: IconName;
    containerStyle?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
};

type AuthPrimaryButtonProps = {
    label: string;
    disabled?: boolean;
    loading?: boolean;
    onPress: () => void;
};

type AuthDensity = "regular" | "compact";

const AuthDensityContext = React.createContext<AuthDensity>("regular");

export function AuthScreen({
    title,
    subtitle,
    children,
    footer,
    onBack,
    backDisabled = false,
    density = "regular",
}: AuthScreenProps) {
    const insets = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const { mode, colors } = useTheme();
    const styles = createStyles(colors, mode, density);
    const isCompact = density === "compact";

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
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[
                        styles.content,
                        {
                            paddingTop: insets.top + (isCompact ? 8 : 14),
                            paddingBottom: Math.max(insets.bottom, 18) + (isCompact ? 14 : 28),
                        },
                    ]}
                >
                    {onBack ? (
                        <View style={styles.topBar}>
                            <Pressable
                                accessibilityRole="button"
                                onPress={onBack}
                                accessibilityLabel="이전 화면으로 돌아가기"
                                accessibilityState={{ disabled: backDisabled }}
                                disabled={backDisabled}
                                style={({ pressed }) => [
                                    styles.backButton,
                                    (pressed || backDisabled) && styles.pressed,
                                ]}
                            >
                                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                            </Pressable>
                        </View>
                    ) : null}

                    <View style={styles.hero}>
                        <View style={styles.heroBrand}>
                            <View style={styles.heroLogoWrap}>
                                <Image source={APP_LOGO_GLOW} resizeMode="contain" style={styles.heroLogoAura} />
                                <Image source={APP_LOGO_GLOW} resizeMode="contain" style={styles.heroLogoAuraCore} />
                                <Image source={APP_LOGO} resizeMode="cover" style={styles.heroLogo} />
                            </View>
                            <Text style={styles.heroBrandText}>NoLate</Text>
                        </View>
                        {title ? <Text style={styles.title}>{title}</Text> : null}
                        <Text style={styles.subtitle}>{subtitle}</Text>
                    </View>

                    <View
                        style={styles.formPanel}
                    >
                        {children}
                    </View>

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
    placeholderTextColor,
    accessibilityLabel,
    secureTextEntry,
    ...inputProps
}: AuthInputProps) {
    const { colors, mode } = useTheme();
    const density = React.useContext(AuthDensityContext);
    const styles = createStyles(colors, mode, density);
    const [passwordVisible, setPasswordVisible] = React.useState(false);
    const isPasswordField = secureTextEntry === true;

    return (
        <View
            style={[
                styles.field,
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
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                    {...inputProps}
                    accessibilityLabel={accessibilityLabel ?? label}
                    placeholderTextColor={
                        placeholderTextColor ?? colors.inputPlaceholder
                    }
                    secureTextEntry={isPasswordField && !passwordVisible}
                    style={[styles.fieldInput, { color: colors.textPrimary }, inputStyle]}
                />
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
}

export function AuthPrimaryButton({
    label,
    disabled,
    loading = false,
    onPress,
}: AuthPrimaryButtonProps) {
    const { colors, mode } = useTheme();
    const density = React.useContext(AuthDensityContext);
    const styles = createStyles(colors, mode, density);

    return (
        <Pressable
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
                    transform: [{ scale: pressed && !disabled && !loading ? 0.99 : 1 }],
                },
            ]}
        >
            <Text style={[styles.primaryButtonText, { color: colors.selectedDayText }]}>
                {label}
            </Text>
            {loading ? (
                <BrandedLoader
                    size="button"
                    variant="auth"
                    accessibilityLabel={label}
                />
            ) : (
                <Ionicons name="arrow-forward" size={18} color={colors.selectedDayText} />
            )}
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
            fontWeight: "900",
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
            justifyContent: "center",
            flexGrow: isCompact ? 0 : 1,
            minHeight: isCompact ? 176 : 220,
            paddingTop: isCompact ? 14 : 28,
            paddingBottom: isCompact ? 16 : 28,
        },
        heroBrand: {
            alignItems: "center",
            gap: 2,
            marginBottom: isCompact ? 9 : 14,
        },
        heroLogoWrap: {
            position: "relative",
            width: isCompact ? 100 : 108,
            height: isCompact ? 100 : 108,
            alignItems: "center",
            justifyContent: "center",
            overflow: "visible",
        },
        heroLogoAura: {
            position: "absolute",
            zIndex: 0,
            width: isCompact ? 252 : 272,
            height: isCompact ? 198 : 214,
            opacity: isDark ? 0.82 : 0.5,
            transform: [{ translateY: isCompact ? -5 : -6 }],
        },
        heroLogoAuraCore: {
            position: "absolute",
            zIndex: 1,
            width: isCompact ? 176 : 190,
            height: isCompact ? 138 : 150,
            opacity: isDark ? 0.72 : 0.42,
            transform: [{ translateY: isCompact ? -2 : -3 }],
        },
        heroLogo: {
            position: "relative",
            width: isCompact ? 76 : 82,
            height: isCompact ? 76 : 82,
            borderRadius: isCompact ? 22 : 24,
            zIndex: 10,
            elevation: 10,
            shadowColor: "#0077FF",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isDark ? 0.54 : 0.34,
            shadowRadius: isCompact ? 25 : 30,
        },
        heroBrandText: {
            color: colors.textPrimary,
            fontSize: isCompact ? 17 : 18,
            lineHeight: isCompact ? 21 : 22,
            fontWeight: "900",
            textAlign: "center",
            zIndex: 2,
        },
        title: {
            color: colors.textPrimary,
            fontSize: 30,
            lineHeight: 36,
            fontWeight: "900",
            textAlign: "center",
        },
        subtitle: {
            color: colors.textSecondary,
            marginTop: isCompact ? 7 : 8,
            maxWidth: 270,
            fontSize: 13,
            lineHeight: 20,
            fontWeight: "700",
            textAlign: "center",
        },
        formPanel: {
            padding: 0,
            gap: isCompact ? 10 : 12,
        },
        field: {
            minHeight: isCompact ? 60 : 68,
            borderRadius: isCompact ? 16 : 18,
            borderWidth: 1,
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: isCompact ? 12 : 14,
            gap: isCompact ? 10 : 12,
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
            width: 38,
            height: 44,
            marginRight: -5,
            alignItems: "center",
            justifyContent: "center",
        },
        fieldLabel: {
            color: colors.textSecondary,
            fontSize: 11,
            fontWeight: "900",
            marginBottom: 3,
        },
        fieldInput: {
            minHeight: isCompact ? 27 : 30,
            paddingVertical: 0,
            fontSize: isCompact ? 15 : 16,
            fontWeight: "800",
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
            fontWeight: "900",
        },
        pressed: {
            opacity: 0.58,
        },
    });
}
