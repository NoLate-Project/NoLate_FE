import {journeyNoticeAvailability} from '../src/modules/journey/journeyNoticeAvailability';

test.each(['OFF',undefined,'PRIVATE'])('inactive or unknown mode does not claim delivery: %s',mode=>{
    expect(journeyNoticeAvailability(mode,'AUTHORIZED_LOCK_ON_ALERT_ON')).toBeNull();
});
test.each(['NOTIFICATIONS','VOICE_AND_NOTIFICATIONS'])('channel selection is not permission: %s',mode=>{
    expect(journeyNoticeAvailability(mode,'NOT_DETERMINED_LOCK_UNSUPPORTED_ALERT_UNSUPPORTED')).toContain('아직');
    expect(journeyNoticeAvailability(mode,'DENIED_LOCK_OFF_ALERT_OFF')).toContain('받을 수 없어요');
    expect(journeyNoticeAvailability(mode,'AUTHORIZED_LOCK_OFF_ALERT_ON')).toContain('잠금 화면 알림이 꺼져');
    expect(journeyNoticeAvailability(mode,'AUTHORIZED_LOCK_ON_ALERT_ON')).toContain('표시되지 않을 수');
});
test.each([undefined,'NOT_CHECKED','PROVISIONAL_LOCK_ON_ALERT_ON','EPHEMERAL_LOCK_ON_ALERT_ON','PRIVATE secret'])('unconfirmed metadata stays conservative and redacted: %s',permission=>{
    const message=journeyNoticeAvailability('VOICE_AND_NOTIFICATIONS',permission);
    expect(message).toContain('확인해 주세요');expect(message).not.toContain('PRIVATE');
});
