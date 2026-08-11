export {};

const fs = jest.requireActual('fs') as {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: string): string;
};

const read = (relativePath: string) => fs.readFileSync(relativePath, 'utf8');

describe('iOS NoLate custom alarm native contract', () => {
  const scheduler = read(
    'modules/nolate-alarm/ios/NoLateCustomAlarmNotification.swift',
  );
  const coordinator = read(
    'modules/nolate-alarm/ios/NoLateAlarmCoordinator.swift',
  );
  const models = read('modules/nolate-alarm/ios/NoLateAlarmModels.swift');
  const module = read('modules/nolate-alarm/ios/NoLateAlarmModule.swift');
  const foregroundRouter = [
    read('src/modules/notification/foregroundPush.ts'),
    read('src/modules/notification/foregroundPushMessage.ts'),
    read('src/modules/notification/notificationDepartureActions.ts'),
  ].join('\n');
  const xcodeProject = read('ios/NoLateFE.xcodeproj/project.pbxproj');

  it("schedules a time-sensitive notification that opens NoLate's own screen", () => {
    expect(scheduler).toContain('UNNotificationRequest(');
    expect(scheduler).toContain('UNTimeIntervalNotificationTrigger(');
    expect(scheduler).toContain('content.interruptionLevel = .timeSensitive');
    expect(scheduler).toContain(
      'NoLateCustomAlarmNotificationContract.payload(',
    );
    expect(scheduler).not.toContain('import AlarmKit');
    expect(scheduler).not.toContain('AlarmManager');
    expect(module).toContain('AsyncFunction("scheduleCustomAlarmPreview")');
    expect(module).toContain('AsyncFunction("getAlarmSoundPreference")');
    expect(module).toContain('AsyncFunction("setAlarmSoundPreference")');
  });

  it('registers all NoLate-owned categories and their six foreground-only actions natively', () => {
    const identifiers = [
      'openActionIdentifier',
      'confirmDepartureActionIdentifier',
      'previewRouteActionIdentifier',
      'previewDepartureActionIdentifier',
    ].map(name => {
      const match = models.match(
        new RegExp(`${name}\\s*=\\s*\\n?\\s*"([^"]+)"`),
      );
      expect(match).not.toBeNull();
      return match![1];
    });

    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(identifiers).not.toContain('schedule_depart_now_action');
    expect(scheduler).toContain('title: "알람 열기"');
    expect(scheduler).toContain('title: "경로 보기"');
    expect(scheduler).toContain('title: "지금 출발 완료"');
    expect(scheduler.match(/options: \[\.foreground\]/g)?.length).toBe(6);
    expect(models).toContain(
      'legacyCategoryIdentifier = "schedule_depart_now"',
    );
    expect(models).toContain(
      'legacyDepartureActionIdentifier = "schedule_depart_now_action"',
    );
    expect(models).toContain(
      'legacySnoozeActionIdentifier = "schedule_snooze_action"',
    );
    expect(models).toContain('managedCategoryIdentifiers: Set<String>');
    expect(scheduler).toContain('Self.legacyStandardCategory()');
    expect(scheduler).toContain('preservedCategories');
    expect(scheduler).toContain(
      'setNotificationCategories(registeredCategories)',
    );
    const standardCategoryStart = scheduler.indexOf(
      'private nonisolated static func legacyStandardCategory()',
    );
    const standardCategory = scheduler.slice(standardCategoryStart);
    expect(standardCategoryStart).toBeGreaterThanOrEqual(0);
    expect(standardCategory).toContain('title: "출발 완료"');
    expect(standardCategory).not.toContain('title: "지금 출발 완료"');
    expect(foregroundRouter).toContain('buttonTitle: "출발 완료"');

    const categoryWriterStart = foregroundRouter.indexOf(
      'async function ensureDepartNowCategory',
    );
    const categoryWriter = foregroundRouter.slice(categoryWriterStart);
    expect(categoryWriterStart).toBeGreaterThanOrEqual(0);
    expect(categoryWriter).toContain('if (Platform.OS === "ios") return;');
  });

  it('replaces any older preview request instead of accumulating test alarms', () => {
    expect(models).toContain(
      'previewRequestIdentifier = "\\(previewRequestIdentifierPrefix)current"',
    );
    expect(scheduler).toContain('await removeExistingPreviews()');
    expect(scheduler).toContain(
      'removePendingNotificationRequests(withIdentifiers: pending)',
    );
    expect(scheduler).toContain(
      'removeDeliveredNotifications(withIdentifiers: delivered)',
    );
  });

  it('never creates a new AlarmKit reservation', () => {
    expect(coordinator).not.toContain('manager.schedule(');
    expect(coordinator).not.toContain('scheduleAlarmKit(');
    expect(coordinator).not.toContain('manager.requestAuthorization()');

    const scheduleStart = coordinator.indexOf(
      'private func scheduleSystemDeliveryUnlocked(',
    );
    const scheduleEnd = coordinator.indexOf(
      'private func scheduleTimeSensitiveNotification(',
      scheduleStart,
    );
    expect(scheduleStart).toBeGreaterThanOrEqual(0);
    expect(scheduleEnd).toBeGreaterThan(scheduleStart);
    const scheduleBody = coordinator.slice(scheduleStart, scheduleEnd);
    expect(scheduleBody).toContain('scheduleTimeSensitiveNotification(');
    expect(scheduleBody).not.toContain('.alarmKit');
  });

  it('routes every custom action before the legacy direct-mutation action', () => {
    const customRouting = foregroundRouter.indexOf(
      'getNoLateCustomAlarmNavigationTarget(',
    );
    const legacyMutation = foregroundRouter.indexOf(
      'SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER',
      customRouting,
    );
    expect(customRouting).toBeGreaterThanOrEqual(0);
    expect(legacyMutation).toBeGreaterThan(customRouting);
    expect(foregroundRouter.slice(customRouting, legacyMutation)).toContain(
      'openCustomAlarmOnce(customAlarmTarget, "interaction")',
    );
  });

  it('loads simulator local listeners without importing the push-token root index', () => {
    const loaderStart = foregroundRouter.indexOf(
      'async function getLocalNotificationsForCustomAlarm',
    );
    const loaderEnd = foregroundRouter.indexOf(
      'export async function configureForegroundPush',
      loaderStart,
    );
    const loader = foregroundRouter.slice(loaderStart, loaderEnd);

    expect(loaderStart).toBeGreaterThanOrEqual(0);
    expect(loader).toContain('"expo-notifications/build/NotificationsEmitter"');
    expect(loader).not.toContain('import("expo-notifications")');
    expect(loader).not.toContain(
      'requireOptionalNativeModule("ExpoPushTokenManager")',
    );
  });

  it('resolves only bundled long variants for the selected native alarm sound', () => {
    [
      'nolate_departure_alert.wav',
      'nolate_alarm_bell_alert.wav',
      'nolate_alarm_beep_alert.wav',
    ].forEach(fileName => {
      expect(fs.existsSync(`assets/sounds/${fileName}`)).toBe(true);
      expect(xcodeProject).toContain(`${fileName} in Resources`);
    });
    expect(models).toContain('case chime = "CHIME"');
    expect(models).toContain('case bell = "BELL"');
    expect(models).toContain('case beep = "BEEP"');
    expect(models).toContain('return "nolate_departure_alert"');
    expect(models).toContain('return "nolate_alarm_bell_alert"');
    expect(models).toContain('return "nolate_alarm_beep_alert"');
    expect(scheduler).toContain('selectedPreference.notificationResourceName');
    expect(scheduler).toContain('let fileExtension = "wav"');
    expect(scheduler).toContain(
      'bundle.url(forResource: resourceName, withExtension: fileExtension)',
    );
    expect(scheduler).toContain('return .default');
  });

  it('refreshes pending custom alarms without deleting or changing their contract', () => {
    expect(scheduler).toContain('getPendingNotificationRequests');
    expect(scheduler).toContain('request.content.mutableCopy()');
    expect(scheduler).toContain('identifier: request.identifier');
    expect(scheduler).toContain('trigger: request.trigger');
    expect(scheduler).toContain('updatedContent.sound = sound');
    expect(scheduler).not.toContain(
      'removePendingNotificationRequests(withIdentifiers: managedRequests',
    );
    expect(models).toContain('soundManagedCategoryIdentifiers');
    expect(models).toContain('categoryIdentifier');
    expect(models).toContain('previewCategoryIdentifier');
  });
});
