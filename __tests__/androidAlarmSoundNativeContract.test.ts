export {};

const fs = jest.requireActual("fs") as {
    existsSync(filePath: string): boolean;
    readFileSync(filePath: string, encoding: string): string;
};

const nativeRoot = "modules/nolate-alarm/android/src/main";
const kotlinRoot = `${nativeRoot}/java/expo/modules/nolatealarm`;
const read = (fileName: string) => fs.readFileSync(`${kotlinRoot}/${fileName}`, "utf8");

describe("Android alarm sound native contract", () => {
    const preference = read("AlarmSoundPreference.kt");
    const nativeModule = read("NoLateAlarmModule.kt");
    const service = read("DepartureAlarmService.kt");

    it("keeps the sound preference readable during direct boot and durably commits it", () => {
        expect(preference).toContain("createDeviceProtectedStorageContext()");
        expect(preference).toContain(".commit()");
        expect(preference).toContain('CHIME("CHIME", "nolate_departure_chime")');
        expect(preference).toContain('BELL("BELL", "nolate_alarm_bell")');
        expect(preference).toContain('BEEP("BEEP", "nolate_alarm_beep")');
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

    it.each([
        "nolate_departure_chime.wav",
        "nolate_alarm_bell.wav",
        "nolate_alarm_beep.wav",
    ])("packages %s in the alarm module raw resources", fileName => {
        expect(fs.existsSync(`${nativeRoot}/res/raw/${fileName}`)).toBe(true);
    });
});
