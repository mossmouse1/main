# 우리 공원 생명 도감 (모바일 웹)

동탄호수공원에서 아이와 함께 온 가족이 산책하며 생물 관찰을 사진과 함께 남기고, 팀이 그 기록을 검토해 Darwin Core CSV로 내보내는 모바일 웹입니다. 기획은 [prd.md](prd.md)(v0.2)를 따릅니다.

> 이 저장소는 비공개입니다. 실제 키, 프로젝트 주소, 사용자 데이터는 절대 올리지 않습니다([보안 수칙](#7-보안-수칙) 참고).

## 1. 현재 상태

### 구현된 것

| 기능 | 상태 | 위치 |
| --- | --- | --- |
| F01 바로 시작(안내, 동의, 사람 수, 익명 계정) | 구현 | `FE/src/screens/Welcome.tsx` |
| F02 공원 지도(그림 지도, 구역·생물 핀, 내 위치, 공원 밖 안내) | 구현(지도는 임시) | `FE/src/components/ParkMap.tsx`, `FE/src/screens/MapHome.tsx` |
| F03 오늘 찾을 종 · F04 생물 카드 | 구현(월별 자료는 연결 전) | `FE/src/screens/SpeciesCard.tsx` |
| F05 사진(카메라/앨범, 1~3장, 원본 + 1280px 사본, HEIC, EXIF 시각) | 구현 | `FE/src/platform.ts`, `FE/src/lib/photo.ts` |
| F06 후보 3개 / 목록에 없어요 / 잘 모르겠어요 | 구현 | `FE/src/screens/Record.tsx` |
| 사진으로 종 후보 3개 추천(서버에서 OpenAI 호출, 버튼을 눌렀을 때만) | 구현, Supabase 모드에서만 | `BE/supabase/functions/identify-species`, `FE/src/screens/Record.tsx` |
| F07 생물 위치(지도 탭, 반경, 내 근처) | 구현 | `FE/src/screens/Record.tsx` |
| 위치로 구역·비오톱 자동 판정 | 구현(비오톱 데이터는 샘플) | `BE/supabase/migrations`, `FE/src/lib/geo.ts` |
| F08 자동 기록 · F09 오프라인 저장(IndexedDB 대기열, 재시도, 서버 확인 뒤 원본 삭제) | 구현 | `FE/src/data/observations.ts`, `FE/src/data/sync.ts` |
| F10 가족 도감 | 구현 | `FE/src/screens/Dex.tsx` |
| F11 산책(탐험) 시작·끝, 자동 종료, 조사 노력, 요약 | 구현 | `FE/src/data/walks.ts`, `FE/src/screens/WalkSummary.tsx` |
| F12 팀 검토(동정 상태·이력, 중복 묶기, 숨기기) | 구현 | `FE/src/admin/Review.tsx` |
| F13 CSV 내보내기(Darwin Core) | 코드만 있음, 서버에 배포 안 됨 | `BE/supabase/functions/export-csv` |
| F14 기록 지키기(이메일 연결, 삭제 요청) | 일부(Supabase 모드에서만, 새 기기 로그인 화면 없음) | `FE/src/screens/Settings.tsx` |
| F15 구역 상세 | 구현 | `FE/src/screens/ZoneDetail.tsx` |
| F16 콘텐츠 편집 화면 | 미구현(읽기만, 편집은 JSON) | `FE/src/admin/ContentAdmin.tsx` |
| F17 품질 지표 | 일부 | `FE/src/admin/ContentAdmin.tsx` |

PRD는 "AI 종 판별 모델"을 이번 범위 밖으로 적고 있지만, 종 추천 기능은 그 뒤에 추가된 것입니다. 추천은 후보를 보여 줄 뿐이고 최종 이름은 가족이 고르며, 선택한 경우 `pick_source`가 `photo_ai`로 기록됩니다.

### 알려진 한계

- 카메라 두 손가락 핀치 줌이 폰에서 아직 해결되지 않았습니다(1x/2x 버튼은 동작). 확인 필요: 마지막 수정이 아이폰에서 통과했는지.
- 지도는 임시 SVG입니다. 구역 경계(Z1~Z6)와 시설 위치도 임시 도형입니다.
- 비오톱 데이터는 샘플 1개(호수)뿐입니다.
- `export-csv` Edge Function은 아직 배포하지 않았습니다. 팀 화면의 CSV 내보내기는 배포 전까지 동작하지 않습니다.
- 앱의 일부 문구(단서 문구, 동의 문구, 일부 헷갈리는 종 설명)는 초안입니다.
- 월별 기록 막대와 이름 검색 자료(`species_catalog.json`)는 연결 전입니다.
- 실기기(안드로이드·아이폰 × 브라우저·웹뷰) 점검은 완료되지 않았습니다. 확인 필요.

## 2. 아키텍처

```
  브라우저 (FE: React + Vite, PWA)
   |  IndexedDB(Dexie): 기록·사진 대기열 / 오프라인 저장
   |
   |  supabase-js
   v
  Supabase
   +-- Auth ............ 익명 로그인 (가족 = 익명 계정 1개)
   +-- Data API ........ 읽기: 테이블 SELECT (RLS로 본인 기록만)
   |                     쓰기: DB 함수(rpc)로만 (멱등 저장, 구역 판정, 검증)
   +-- Storage ......... photos 버킷(비공개), 본인 폴더에만 업로드
   +-- Edge Functions
        +-- identify-species ... 사진 -> OpenAI(서버에서만 키 사용) -> 종 후보 3개
        +-- export-csv ......... 검토자 전용 Darwin Core CSV (미배포)
```

- 테이블에 직접 쓰지 않고 DB 함수로만 씁니다. 함수가 동의 여부, 소유자, 입력 값을 검사하고 같은 기록을 다시 보내도 한 번만 저장합니다.
- 읽기는 RLS가 걸려 있어 가족은 자기 기록만, 검토자(`app_metadata.role = reviewer`)는 전체를 봅니다.
- `identify-species`는 사용자 JWT로 호출되고, 함수 안에서 사용자를 확인한 뒤 호출 한도(`consume_identify_quota`)를 소진하고 OpenAI Responses API를 부릅니다. OpenAI 키는 브라우저로 나가지 않습니다. 모델은 환경변수 `OPENAI_MODEL`, 기본값은 `gpt-5.4-mini`입니다.
- `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`가 없으면 서버 대신 브라우저 안의 가짜 서버(로컬 모드)로 동작합니다. 로컬 모드에서는 종 추천 버튼이 보이지 않습니다.

## 3. 폴더 구조

```
FE/                          웹앱(Vite + React + TypeScript)
  src/screens/               가족 화면
  src/admin/                 팀 화면 (/admin)
  src/backend/               서버 연결: local.ts(가짜 서버) / supabase.ts
  src/data/                  기기 DB(Dexie), 기록, 산책, 전송 대기열
  src/lib/                   사진 처리, 지도 계산, 줌 계산 등
  src/platform.ts            카메라·위치는 여기서만 부름
  public/content/v1.json     콘텐츠(구역·종 카드·계절 세트)
  public/map/park-map.svg    임시 그림 지도
  scripts/                   콘텐츠·지도·시드 생성 스크립트 (gen-seed.mjs 등)
  .env.example               환경변수 견본(값은 비어 있음)
  vercel.json
BE/supabase/
  migrations/                테이블·RLS·DB 함수·저장소 정책 (SQL)
  functions/identify-species/  사진 종 추천
  functions/export-csv/        CSV 내보내기
  functions/_shared/           웹과 함수가 같이 쓰는 코드(dwc.ts, identify.ts)와 테스트
  seed.sql                   콘텐츠 시드 (FE에서 npm run seed:sql로 생성)
  config.toml
prd.md                       기획서
```

## 4. 시작하기

### 요구사항과 실행

- Node.js 20 이상(정확한 최소 버전은 확인 필요), npm
- 서버 설정에는 Supabase CLI(3.x 기준)가 필요합니다.

```bash
cd FE
npm install
npm run dev      # http://localhost:5173 (가족 화면), /admin (팀 화면)
```

| 스크립트 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 배포용 빌드(`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | 타입 검사만 |
| `npm run test` | 단위 테스트(vitest) |
| `npm run seed:sql` | `public/content/v1.json`에서 `BE/supabase/seed.sql` 생성 |

휴대폰에서 카메라·위치를 시험하려면 HTTPS가 필요합니다. Vercel 미리보기 배포나 HTTPS 터널을 쓰세요.

### 환경변수

`FE/.env.example`을 `FE/.env.local`로 복사해 채웁니다(`.env.local`은 커밋하지 않습니다).

| 변수 | 설명 | 예 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase 프로젝트 기본 주소 | `https://<프로젝트ID>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 공개용 키(publishable 또는 anon) | 대시보드의 공개용 키 |

주의:

- URL은 `https://<프로젝트ID>.supabase.co` 기본 주소만 씁니다. `/rest/v1` 같은 경로를 붙이면 로그인 요청이 404가 납니다.
- 키는 공개용(publishable/anon)만 넣습니다. 서비스 키(secret/service_role)는 넣지 않습니다.
- 두 변수를 비우면 로컬 모드(브라우저 안 가짜 서버)로 동작합니다.

### Supabase 서버 설정

1. Supabase 프로젝트를 만듭니다.
2. Authentication에서 **Anonymous sign-ins**를 켭니다(필수). 봇 방지용 CAPTCHA를 권장하고, URL Configuration에 배포 주소를 넣습니다(이메일 연결 링크용).
3. 확장 `postgis`, `pg_cron`: 첫·두 번째 마이그레이션이 `create extension`을 실행합니다. 권한 오류가 나면 대시보드 Database > Extensions에서 직접 켭니다. 확인 필요: 새 프로젝트에서 자동으로 켜지는지.
4. 스키마와 시드를 올립니다. 새 CLI(3.x)에서는 `db push`에 `--remote`가 필요합니다.

```bash
cd FE && npm run seed:sql && cd ..     # seed.sql 갱신(콘텐츠를 고칠 때마다)
cd BE
supabase link --project-ref <프로젝트ID>
supabase db push --remote --include-seed
```

5. 검토자 계정: Authentication에서 사용자를 만든 뒤 SQL 편집기에서 역할을 줍니다.

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"reviewer"}'
where email = '<검토자 이메일>';
```

### Edge Function 배포

```bash
cd BE
supabase functions deploy identify-species    # Docker 오류가 나면 --use-api 추가
```

OpenAI 키는 서버에만 등록합니다. 터미널 기록에 남지 않게 입력하세요.

```bash
read -s OPENAI_API_KEY && supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY"; unset OPENAI_API_KEY
# 선택: supabase secrets set OPENAI_MODEL=<모델 이름>
```

`export-csv`는 아직 배포하지 않았습니다. 배포하려면 `supabase functions deploy export-csv`(확인 필요: 배포 후 동작 점검 전).

### Vercel 배포

1. Vercel에서 이 저장소를 가져옵니다.
2. Project Settings > General에서 **Root Directory**를 `FE`로 지정합니다.
3. 같은 화면에서 **Include source files outside of the Root Directory**를 켭니다(`FE`가 `BE/supabase/functions/_shared`를 참조하기 때문).
4. Environment Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 **빌드 전에** 입력합니다. 값은 빌드할 때 번들에 들어가므로, 나중에 바꾸면 다시 배포해야 합니다.
5. `main`에 푸시하면 자동 배포됩니다. 배포 주소: `https://<배포주소>`

## 5. 진단 모드

주소 끝에 `?debug=1`을 붙이면(예: `https://<배포주소>/?debug=1`) 오른쪽 위에 작은 진단 패널이 보입니다. 일반 사용자에게는 보이지 않으며, 그 탭에서만 유지됩니다. 숫자와 상태값만 표시하고 사진 내용·위치·키는 표시하지 않습니다.

- 사진: 크기·타입, 저장 형태, 이미지 로드 오류와 재시도 단계(폰에서 사진이 깨질 때)
- 줌: 줌 모드(하드웨어/디지털), 핀치 리스너 부착 여부, 핀치 이벤트·`pointercancel` 수
- 업로드: 대기 중인 사진 수와 마지막 오류(사진이 서버에 안 올라갈 때)

## 6. 보안 수칙

키 종류:

| 종류 | 어디에 | 비고 |
| --- | --- | --- |
| 공개용 키(publishable/anon) | `FE/.env.local`, Vercel 환경변수 | 브라우저에 노출되는 값입니다. 접근 제어는 RLS가 맡습니다. |
| 서버 전용 키(secret/service_role) | 어디에도 넣지 않습니다 | 이 앱은 필요하지 않습니다. 쓰면 RLS를 우회합니다. |
| OpenAI 키 | `supabase secrets set`(서버)에만 | 코드, `.env`, 로그, 채팅에 붙이지 않습니다. |

절대 커밋하지 않는 것:

- `.env`, `.env.local` 등 `.env*`(단 `.env.example`은 빈 값만)
- 서비스 키, DB 비밀번호, 토큰, 접근 키
- 실제 사용자 사진, 기록 CSV, 내보낸 데이터
- 용량 큰 원본 데이터(새로 받은 대용량 파일). 참고: `FE/scripts/data/`의 지도·종 자료(약 3MB)는 이미 저장소에 있습니다.

그 밖에:

- 종 추천 호출 한도: 가족당 분당 5회, 하루 40회, 전체 가족 합산 하루 1500회(`consume_identify_quota`). 한도 숫자는 `BE/supabase/migrations/20261103000200_identify_quota.sql` 맨 위 상수입니다.
- 사진 버킷(`photos`)은 비공개이고, 서명 URL로만 올리고 봅니다. 사진에는 위치 정보(GPS)가 들어갈 수 있으니 다루는 데 주의하세요.
- 키가 저장소에 올라갔다면 파일을 지우는 것으로는 부족합니다(기록에 남습니다). 해당 키를 즉시 재발급(폐기)하세요.

## 7. 테스트

```bash
cd FE
npm run typecheck
npm run test
npm run build
```

테스트는 조사 노력, 구역 판정, 후보, 도감, Darwin Core CSV, 종 추천 응답 검증, 줌 계산, 사진 바이트 저장 등을 다룹니다. 실제 Supabase·OpenAI 호출과 실기기 동작은 자동 테스트가 없습니다.

## 8. 협업 방법

- `main`에 직접 커밋하지 않고, 브랜치를 만들어 작업한 뒤 PR로 합칩니다(예: `feature/...`, `fix/...`, `docs/...`).
- 팀원 검토 후 머지하고, `main`에 합쳐지면 Vercel이 자동 배포합니다.
- DB 스키마 변경은 콘솔에서 직접 고치지 않고 `BE/supabase/migrations/`에 SQL 파일(타임스탬프 이름)로 남겨 `supabase db push --remote`로 적용합니다. 이미 적용된 마이그레이션 파일은 수정하지 않고 새 파일을 추가합니다.
- 콘텐츠(`FE/public/content/v1.json`)를 고치면 `npm run seed:sql`로 시드를 다시 만듭니다.

## 아직 임시인 것 (교체 필요)

`FE/public/content/v1.json`의 `placeholders`에도 같은 목록이 있고, `/admin/content`에서 볼 수 있습니다.

- 그림 지도(임시 SVG), 구역 경계 Z1~Z6와 시설 위치(임시 도형)
- 비오톱(호수 1개 샘플)
- 월별 기록 막대, 이름 검색 자료
- 헷갈리는 종, 단서 문구, 가을·겨울 세트 편성, 동의 문구(초안, 팀 검토 필요)
- 자료 이용 조건(`DATA_LICENSE`)
