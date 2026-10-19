/** Permission metadata is not evidence that a notice was delivered or heard. */
export function journeyNoticeAvailability(mode?: string, permission?: string): string | null {
    if (mode !== 'NOTIFICATIONS' && mode !== 'VOICE_AND_NOTIFICATIONS') return null;
    if (permission === 'AUTHORIZED_LOCK_ON_ALERT_ON') return '잠금 화면 알림 허용됨 · 집중 모드와 시스템 설정에 따라 표시되지 않을 수 있어요.';
    if (permission?.startsWith('DENIED_')) return '알림 권한이 꺼져 있어요. 잠금 화면 안내를 받을 수 없어요.';
    if (permission?.startsWith('NOT_DETERMINED_')) return '알림 권한을 아직 허용하지 않았어요. 잠금 화면 안내를 받을 수 없어요.';
    if (permission?.startsWith('AUTHORIZED_LOCK_OFF_')) return '잠금 화면 알림이 꺼져 있어요. 앱의 시스템 알림 설정을 확인해 주세요.';
    return '잠금 화면 알림 사용 가능 여부를 확인해 주세요. 안내 채널 선택만으로 알림 권한이 허용되지는 않아요.';
}
