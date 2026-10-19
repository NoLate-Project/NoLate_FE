# 운영 late_project 길안내 스키마 적용 — 2026-10-13

## 실제 적용 결과

사용자가 지정·승인한 운영 `late_project`(MySQL 8.0.46)에 마이그레이션 5개를
**실제로 적용했고 별도 읽기 전용 재조회까지 통과했다.** 이전 격리 MySQL 리허설과 다른 작업이다.
아래 문서의 과거 “공유 DB 미적용/중지 대기” 기록은 당시 상태이며 현재 상태가 아니다.

| 적용 이력 | 결과 |
| --- | --- |
| 2026-10-03-journey-guidance-sessions-v1 | APPLIED |
| 2026-10-04-automatic-journey-preparations-v1 | APPLIED |
| 2026-10-06-journey-activity-lanes-v1 | APPLIED |
| 2026-10-12-journey-walking-snapshots-v1 | APPLIED |
| 2026-10-12-mixed-walking-binding-v1 | APPLIED |

추가 테이블과 최종 열 수: `journey_guidance_sessions` 24,
`automatic_journey_preparations` 22, `journey_activity_lanes` 25,
`journey_walking_snapshots` 7. 마지막 이력은 준비 테이블에 nullable `walking_snapshot_id`를 추가한다.
각 SQL의 열/인덱스 사후 조건, 이력 5개, 기존 이력 유지, 기존 테이블별 행 수 불변을 검증했다.
행 수 비교는 모든 기존 행 내용의 바이트 단위 동일성을 증명하는 검사는 아니다.

## 중지·안전 조건

- 로컬 NoLate_BE 작업 디렉터리의 Java PID 11552/5522 listener를 확인 후 SIGTERM으로 정상 종료했다.
  이후 5522 listener가 없고 DB 연결이 13개에서 3개로 감소했다. 다른 프로세스는 강제 종료하지 않았다.
- 남은 3개는 `Sleep`. 사용자가 이를 허용하는 제한 적용 방식에 명시적으로 동의했다.
- 실행 도구 기본값은 연결 0개다. 이번에는 `--allow-idle-connections`를 명시했고,
  최대 3개 Sleep만 허용하며 active/새 연결 초과/잘못된 검사 결과는 거절한다. 단계마다 재검사했다.
- 트랜잭션/metadata lock 상세 조회는 실패해 미완료 트랜잭션 부재를 주장하지 않는다.
  각 SQL 접속에서 `lock_wait_timeout=5`, `innodb_lock_wait_timeout=5`를 설정했다.
- TLS REQUIRED로 암호화했다. 서버 인증서 identity 검증까지 수행한 것은 아니다.
- 기존 테이블 DROP/데이터 backfill/자동 rollback/연결 KILL은 하지 않았다.
  실패 시 부분 DDL을 보존하고 재실행을 차단하는 정책은 유지한다.

## 운영 백업 및 복원 검증

전체 mysqldump에는 데이터·trigger·routine·event가 포함된다. 운영 백업을 네트워크 none,
포트/호스트 마운트 없는 일회용 MySQL 8.4에 복원하고 기존 테이블 행 수·스키마 이력을 비교했다.
복원 검증용 컨테이너는 종료·제거 확인 후에만 운영 DDL을 시작했다.

- 영구 보관: `/Users/mac/Library/Application Support/NoLate/Backups/journey-before-20261013-CxNy8w/`
- 백업 파일: `before.sql`, 17,871,626 bytes, 권한 0600. 폴더 권한 0700.
- SHA-256: `0add44b238e3515e35efafeb041a931d237288fc282d0a39ca02a40709d61d53`
- 동봉 `manifest.json`: 복원 검사·적용 결과·기존 테이블 행 수·최종 이력/열 수 기록, 권한 0600.
- 임시 원본 `/private/tmp/nolate-journey-db-backup-CxNy8w/`도 보존했다.
- 실행 로그: `/private/tmp/nolate-production-journey-migration-final-20261013.log`

처음 두 실행은 mysqldump가 지원하지 않는 `--connect-timeout=5` 옵션 때문에 **DDL 전** 실패했다.
옵션은 mysql 클라이언트에 유지하고 mysqldump에서만 제외해 수정했다. 실패한 임시 백업도 보존했다.
최종 실행 exit 0/PASS와 독립 DB 재조회로 실제 성공을 확인했다. 도구 안전/회귀 검사는 6건 PASS다.

## 이번에 하지 않은 일

백엔드는 중지 상태로 유지했다. 신규 애플리케이션 배포·운영 기능 ON·`.env` 수정·API/APNs 전송·
실기기 시험은 하지 않았다. 스키마 적용 성공을 실제 길안내/R6 전체 완료나 E2E 성공으로 계산하지 않는다.
백엔드 재기동·애플리케이션 schema validate/health 검증은 별도 후속이다.
