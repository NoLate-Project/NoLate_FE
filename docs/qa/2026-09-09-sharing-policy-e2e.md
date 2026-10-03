# 일정·카테고리·캘린더 공유 정책 E2E 결과

- 실행일: 2026-09-09 (Asia/Seoul)
- 실행 태그: `LOCAL-0909-2145`
- 결과: **PASS**
- 기능 신뢰도: **94%**

## 검증 환경

- 송신자: iOS Simulator `NoLate App Review QA 20260909` (`A20E8DC9-7ADF-42AE-9FC8-DE870E2061B7`)
- 수신자: iOS Simulator `NoLate Calendar UX Audit 20260806` (`2E095B1A-E5E0-416C-8F61-7AD9D32EF583`)
- 앱: 최신 로컬 Debug 빌드, 두 개의 독립 테스트 계정
- API: `http://127.0.0.1:5522`
- Metro: `EXPO_PUBLIC_LOCAL_API_BASE_URL=http://127.0.0.1:5522`
- 백엔드 통합 환경: MySQL 8.4 Testcontainers/Docker

> 최초 증빙 01~11은 Metro가 운영 API를 바라보는 환경 불일치를 발견하기 위한 진단 실행이다. 최신 로컬 코드 검증 결과에는 포함하지 않았다. 최종 판정은 로컬 API로 다시 수행한 12~29 증빙만 사용했다.

## 실제 두 계정 E2E 결과

| 영역 | 시나리오 | 결과 | 증빙 |
| --- | --- | --- | --- |
| 캘린더 직접 공유 | 소유자가 수신자를 보기 권한으로 공유 | PASS | [12](./2026-09-09-sharing-policy-e2e/12-local-owner-viewer-direct-share.png), [13](./2026-09-09-sharing-policy-e2e/13-local-receiver-calendar-inbox-viewer.png) |
| 캘린더 보기 권한 | 수신자의 일정 생성 차단 | PASS | [14](./2026-09-09-sharing-policy-e2e/14-local-viewer-create-denied.png) |
| 캘린더 편집 권한 | 소유자가 편집자로 변경하고 수신자가 일정·카테고리 생성 | PASS | [15](./2026-09-09-sharing-policy-e2e/15-local-owner-promoted-editor.png), [16](./2026-09-09-sharing-policy-e2e/16-local-editor-created-schedule.png), [17](./2026-09-09-sharing-policy-e2e/17-local-editor-category-boundary.png) |
| 편집자 경계 | 캘린더 편집자는 일정·카테고리 내용 편집 가능, 공유·이동 등 소유자 기능은 미노출 | PASS | [17](./2026-09-09-sharing-policy-e2e/17-local-editor-category-boundary.png) |
| 카테고리 이동 | 소유자가 공유 캘린더 A에서 B로 카테고리와 일정을 이동 | PASS | [18](./2026-09-09-sharing-policy-e2e/18-local-shared-to-shared-move-success.png), [19](./2026-09-09-sharing-policy-e2e/19-local-moved-category-present.png) |
| 이동 영향 | 직접 공유 권한 보존과 캘린더 접근 상실 인원 안내 | PASS | [18](./2026-09-09-sharing-policy-e2e/18-local-shared-to-shared-move-success.png) |
| 카테고리 직접 공유 | 이동된 카테고리를 편집 권한으로 받은 사용자가 일정 생성 | PASS | [27](./2026-09-09-sharing-policy-e2e/27-local-category-editor-boundary-fixed.png), [28](./2026-09-09-sharing-policy-e2e/28-local-category-editor-created-schedule-after-move.png) |
| 카테고리 권한 경계 | 직접 공유 편집자는 일정 편집만 가능하고 카테고리 이름·색상·삭제·재공유·이동은 미노출 | PASS | [27](./2026-09-09-sharing-policy-e2e/27-local-category-editor-boundary-fixed.png) |
| 일정 직접 공유 | 보기 권한에서 상세 편집·재공유 차단 | PASS | [23](./2026-09-09-sharing-policy-e2e/23-local-schedule-viewer-boundary.png) |
| 일정 직접 공유 | 편집 권한으로 변경 후 수신자가 제목 수정 | PASS | [24](./2026-09-09-sharing-policy-e2e/24-local-schedule-editor-updated.png) |
| 링크 초대 | 링크 생성, 수신자 앱 딥링크 열기, 수락 | PASS | [25](./2026-09-09-sharing-policy-e2e/25-local-link-invite-ready.png), [26](./2026-09-09-sharing-policy-e2e/26-local-link-invite-accepted.png) |
| 링크 수락 후 이동 | 방금 수락한 캘린더를 선택한 상태로 관리 화면 열기 | PASS | [29](./2026-09-09-sharing-policy-e2e/29-local-invite-target-fixed.png) |
| 웹 링크 폴백 | `/share/{token}`이 JSON이 아닌 200 HTML과 `NoLate 앱에서 열기` CTA 제공 | PASS | 로컬 HTTP 응답 확인 |
| 공유 알림 | 수신자의 앱 내 알림·공유함 배지 증가 및 공유 항목 노출 | PASS | [13](./2026-09-09-sharing-policy-e2e/13-local-receiver-calendar-inbox-viewer.png) |

## E2E에서 발견하고 수정한 문제

1. 공유 캘린더 권한을 조회하는 동안 `권한 없음` 화면이 잠깐 노출됨
   - 권한 조회가 끝날 때까지 로더를 유지하도록 수정했다.
2. 카테고리를 다른 공유 캘린더로 이동한 뒤 이전 캘린더의 편집자 권한이 UI에 남음
   - 카테고리가 현재 속한 캘린더의 역할을 최종 권한 경계로 사용하도록 수정했다.
   - 서버가 금지 요청을 거절하는 것뿐 아니라, 클라이언트에서도 이름·색상·삭제·재공유·이동 동작을 숨긴다.
3. 링크 수락 후 `수락한 공유 항목 열기`가 오래된 캐시의 첫 캘린더를 선택함
   - 초대 라우트의 캘린더 ID를 캐시보다 우선하도록 수정했다.
   - 새 링크와 새 캘린더로 재현부터 수정 후 통과까지 다시 검증했다.
4. 최초 실행의 Metro가 운영 API를 참조함
   - 로컬 API 주소를 명시해 Metro를 재시작하고 전체 시나리오를 처음부터 다시 실행했다.

## 자동화 회귀 검증

- 프런트엔드 Jest: **251/251 suites, 1,854/1,854 tests PASS**
- TypeScript: `tsc --noEmit` PASS
- 프런트엔드 `git diff --check`: PASS
- 백엔드 전체 회귀: **1,646 tests PASS** (MySQL 8.4 Testcontainers/Docker 포함)
- 카테고리 이동·권한 관련 추가 회귀: **2 classes, 13 tests PASS**
- 백엔드 `git diff --check`: PASS

## 남은 실기기 검증

- 앱 내부 알림 목록과 배지는 두 시뮬레이터에서 검증했다.
- 실제 APNs 원격 푸시 수신은 인증서·프로비저닝·운영 APNs가 연결된 iOS 실기기 검증이 필요하다.
- Android 실기기 검증은 별도 후속 항목으로 남긴다.

실기기 푸시 두 항목을 제외한 일정·카테고리·캘린더 공유 정책과 주요 권한 경계는 실제 두 계정 E2E 및 자동화 회귀 테스트를 통과했다.
