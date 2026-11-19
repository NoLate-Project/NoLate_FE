# 재탐색 응답 장기 유실 후 종료 검증 — 2026-11-19

- 범위: 독립 iOS 27.0 Simulator `180F9626-79FD-40FA-BE80-F8D13EE4EB8D`, 기존에 빌드된 Release 앱, 격리 H2 서버, 실제 저장 ODsay 1711 경로, CoreSimulator 주입 GPS. 운영 서버·DB와 실기기는 사용하지 않았다.
- 조건: 서버가 새 도보·버스 경로를 원자적으로 확정한 뒤 커밋 HTTP 응답을 유실시켰다. 후속 `/current` 응답도 45초간 503으로 바꾸어 native의 30초 확인 제한을 넘겼다.
- 결과: XCUITest `testIsolatedSavedRouteNavigationEntry` 1건 통과. [종료 화면](01-guidance-ended-after-timeout.png)에 `위치 안내가 끝났어요`가 표시되고 활성 종료 버튼이 사라졌다. 서버는 이전 세션의 `/stop`에 200을 반환했으며, 격리 DB에서 그 세션의 **직접 재탐색 자식이 `STOPPED`**인 것을 조회해 `ISOLATED_REROUTE_CHILD_STOPPED_AFTER_OLD_STOP`을 기록했다.
- 원본: `/private/tmp/nolate-reroute-timeout-verified-ui-e2e-20261119/result.xcresult`, `/private/tmp/nolate-reroute-timeout-verified-ui-e2e-20261119/run.log`, `/private/tmp/nolate-reroute-timeout-verified-server-20261119.log`.
- 추가 DB 검사: `AutomaticJourneyPersistenceTest`에서 이전 세션 종료를 두 번 전달해도 직접·후속 재탐색 세션은 종료되고, 같은 일정에서 별도로 준비한 세션은 활성 상태로 남는 것을 확인했다. `AutomaticJourneyMigrationContractTest`도 통과했다. 새 마이그레이션을 폐기 가능한 MySQL 8.4 컨테이너에 실제 적용해 엔티티 스키마 검증·재적용 차단·재시작 후 END를 확인했다. 자동 길안내 BE 패키지 회귀는 **49개 클래스·322개 테스트, 실패 0·오류 0·환경상 skip 4**였다 (`/private/tmp/nolate-reroute-timeout-be-regression-final-20261119.log`).

이 검증은 장기 응답 유실 시 **안내를 안전하게 종료하고 서버 후속 세션을 정리하는 경로**만 증명한다. 연결 복구 뒤 자동으로 새 경로를 다시 안내하는 기능, 실기기 GPS, 실제 차량 연속 관측, 이번 교체 경로의 APNs·음성 전달은 검증하지 않았다. 새 부모 세션 칼럼을 포함한 BE 마이그레이션은 아직 운영에 적용하지 않았다.
