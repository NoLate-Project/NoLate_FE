export {};

const fs = jest.requireActual("fs") as {
    existsSync(filePath: string): boolean;
    readFileSync(filePath: string, encoding: string): string;
};

const nativeRoot = "modules/nolate-alarm/android/src/main";
const kotlinRoot = `${nativeRoot}/java/expo/modules/nolatealarm`;
const read = (fileName: string) => fs.readFileSync(`${kotlinRoot}/${fileName}`, "utf8");

const expectedSoundMappings = [
    ["CHIME", "nolate_departure_chime"],
    ["BELL", "nolate_alarm_bell"],
    ["BEEP", "nolate_alarm_beep"],
    ["DIGITAL", "nolate_alarm_digital"],
    ["CRYSTAL", "nolate_alarm_crystal"],
    ["KNOCK", "nolate_alarm_knock"],
    ["TRIPLE", "nolate_alarm_triple"],
    ["SWEEP", "nolate_alarm_sweep"],
    ["SIREN", "nolate_alarm_siren"],
    ["KLAXON", "nolate_alarm_klaxon"],
] as const;

describe("Android alarm sound native contract", () => {
    const preference = read("AlarmSoundPreference.kt");
    const nativeModule = read("NoLateAlarmModule.kt");
    const service = read("DepartureAlarmService.kt");
    const manifest = fs.readFileSync(`${nativeRoot}/AndroidManifest.xml`, "utf8");

    it("keeps the sound preference readable during direct boot and durably commits it", () => {
        expect(preference).toContain("createDeviceProtectedStorageContext()");
        expect(preference).toContain(".commit()");
    });

    it("maps every supported bridge id to one distinct bundled raw resource", () => {
        const enumStart = preference.indexOf("internal enum class NoLateAlarmSound");
        const enumEnd = preference.indexOf("companion object", enumStart);
        const enumDeclaration = preference.slice(enumStart, enumEnd);
        const actualMappings = Array.from(
            enumDeclaration.matchAll(/\b[A-Z][A-Z0-9_]*\("([A-Z][A-Z0-9_]*)", "([a-z0-9_]+)"\)/g),
            match => [match[1], match[2]],
        );

        expect(enumStart).toBeGreaterThanOrEqual(0);
        expect(enumEnd).toBeGreaterThan(enumStart);
        expect(actualMappings).toEqual(expectedSoundMappings);
        expect(new Set(actualMappings.map(([id]) => id)).size).toBe(10);
        expect(new Set(actualMappings.map(([, resourceName]) => resourceName)).size).toBe(10);
    });

    it("exposes whitelist-backed native get and set bridges", () => {
        expect(nativeModule).toContain('AsyncFunction("getAlarmSoundPreference")');
        expect(nativeModule).toContain('AsyncFunction("setAlarmSoundPreference")');
        expect(nativeModule).toContain("AlarmSoundPreferenceStore(requireContext()).set(soundId)");
    });

    it("plays the selected bundled loop before falling back to system ringtones", () => {
        const bundledCandidate = service.indexOf("selectedBundledAlarmSoundUri(),");
        const systemCandidate = service.indexOf("RingtoneManager.getActualDefaultRingtoneUri");

        expect(bundledCandidate).toBeGreaterThanOrEqual(0);
        expect(systemCandidate).toBeGreaterThan(bundledCandidate);
        expect(service).toContain("isLooping = true");
        expect(service).toContain('"android.resource://$packageName/$resourceId"');
    });

    it("uses sound plus alarm-attributed vibration in sound mode and vibration only otherwise", () => {
        expect(manifest).toContain('android.permission.VIBRATE');
        expect(service).toContain("AlarmOutputModePolicy.shouldPlaySound(manager.ringerMode)");
        expect(service).toContain("AudioManager.RINGER_MODE_CHANGED_ACTION");
        expect(service).toContain("VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)");
        expect(service).toContain("vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), ALARM_AUDIO_ATTRIBUTES)");
        expect(service).toContain("vibrator.vibrate(pattern, 0, ALARM_AUDIO_ATTRIBUTES)");
        expect(service).toContain("vibrator.hasVibrator()");
        expect(service).toContain("cancelVibration()");
    });

    it.each(expectedSoundMappings.map(([, resourceName]) => `${resourceName}.wav`))(
      "packages %s in the alarm module raw resources",
      fileName => {
        expect(fs.existsSync(`${nativeRoot}/res/raw/${fileName}`)).toBe(true);
      },
    );
});
