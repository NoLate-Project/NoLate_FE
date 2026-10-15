export {};

const fs = jest.requireActual('fs') as {
  readFileSync(path: string, encoding: string): string;
};
const source = fs.readFileSync(
  'modules/nolate-alarm/ios/NoLateAlarmCoordinator.swift', 'utf8',
);
const cleanup = source.split('func clearAllAlarms() async throws -> Bool {')[1]
  .split('func restoreAndReconcile(')[0];

describe('iOS first-launch account alarm cleanup', () => {
  it('does not wait for notification enumeration just to count removed items', () => {
    expect(cleanup).not.toContain('pendingNotificationRequests()');
    expect(cleanup).not.toContain('deliveredNotifications()');
    expect(cleanup).toContain('return true');
  });

  it('still purges every notification and all persisted privacy journals', () => {
    for (const store of ['store', 'fireJournal', 'actionJournal', 'navigationJournal']) {
      expect(cleanup).toContain(`try ${store}.reset()`);
    }
    expect(cleanup).toContain('notificationCenter.removeAllPendingNotificationRequests()');
    expect(cleanup).toContain('notificationCenter.removeAllDeliveredNotifications()');
    expect(cleanup.indexOf('removeAllDeliveredNotifications()'))
      .toBeLessThan(cleanup.indexOf('AlarmManager.shared.alarms'));
    expect(cleanup).toContain('try AlarmManager.shared.cancel(id: alarm.id)');
    expect(cleanup).toContain('throw cancellationError');
  });

  it('releases the native mutation mutex on both success and failure', () => {
    expect(cleanup).toContain('await systemMutex.acquire()');
    expect(cleanup.match(/await systemMutex.release\(\)/g)).toHaveLength(2);
    expect(cleanup).toMatch(/catch\s*\{\s*await systemMutex.release\(\)\s*throw error/);
  });
});
