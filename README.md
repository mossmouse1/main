# 우리 공원 생명 도감 (모바일 웹)

동탄호수공원에서 아이와 함께 온 가족이 산책하며 생물 관찰을 사진과 함께 남기고, 팀이 그 기록을 검토해 Darwin Core CSV로 내보내는 모바일 웹입니다. 기획은 [prd.md](prd.md)(v0.2)를 따릅니다.

> 이 저장소는 공개입니다. 실제 키, 프로젝트 주소, 사용자 데이터(사진·기록 CSV)는 절대 올리지 않습니다([보안 수칙](#6-보안-수칙) 참고).

## 1. 현재 상태

### 구현된 것

| 기능 | 상태 | 위치 |
| --- | --- | --- |
| F01 바로 시작(처음 안내 화면 없이 지도 홈 코치마크 5단계, 동의·사람 수는 첫 기록 때 한 번) | 구현 | `FE/src/screens/MapHome.tsx`(COACH), `FE/src/components/Tour.tsx`, `FE/src/screens/Welcome.tsx` |
| F02 공원 지도 홈(쿼터뷰 블록 지도 전체 화면, 지도 위 빈 칸 → 사진 딱지, 오늘의 6종 칸, 지금 걷는 곳·걸어온 길, 산책로 따라 길 안내) | 구현 | `FE/src/screens/MapHome.tsx`, `FE/src/components/ParkMap.tsx`, `FE/src/lib/trail.ts` |
| F03 오늘 찾을 종 · F04 생물 카드 | 구현(월별 자료는 연결 전) | `FE/src/screens/SpeciesCard.tsx` |
| F05 사진(카메라/앨범, 1~3장, 원본 + 1280px 사본, HEIC, EXIF 시각) | 구현 | `FE/src/platform.ts`, `FE/src/lib/photo.ts` |
| F06 후보 3개 / 목록에 없어요 / 잘 모르겠어요 | 구현 | `FE/src/screens/Record.tsx` |
| 사진으로 종 후보 3개 추천(서버에서 OpenAI 호출, 버튼을 눌렀을 때만). PRD 범위 밖에서 추가한 실험 기능 | 구현, Supabase 모드에서만 | `BE/supabase/functions/identify-species`, `FE/src/screens/Record.tsx` |
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

종 추천은 후보를 보여 줄 뿐이고 최종 이름은 가족이 고르며, 선택한 경우 `pick_source`가 `photo_ai`로 기록됩니다.

### 화면 구성(홈을 단순하게)

- 아래쪽 버튼은 3개입니다: 지도 · 촬영(가장 큼) · 도감(채운 칸 수). 내 기록·설정은 도감 화면 머리글에서 엽니다(PRD 4장의 탭 4개와 다름).
- 지도 홈 위쪽에는 ‘다음에 찾을 생물’ 한 장만 둡니다(오늘의 6종 중 못 찾은 것, 위치가 있으면 가장 가까운 것과 걸어서 몇 분). 생물 가까이 가면 같은 자리가 노란 알림으로 바뀝니다. 아래에는 오늘의 6종 칸과 내 위치 버튼뿐입니다. 근처 생물 알림, 고른 생물 카드, 탐험 중 표시는 그때만 나옵니다.
- 지도에는 오늘의 6종만 띄웁니다. 못 찾은 생물은 지점마다 점선 ‘빈 칸’, 찾으면 우리 가족이 찍은 자리의 ‘사진 딱지’로 바뀝니다. 나머지 종은 도감의 ‘지도에서 찾기’나 근처 알림으로 나타납니다.
- 홈에서 뺀 것: 거르기 칩, 가까운 생물 목록, 나침반, 구역 팻말(확대하면 보임), ‘탐험 시작’ 버튼(탐험은 첫 기록을 저장할 때 자동으로 시작), 처음 안내 슬라이드(코치마크로 바꿈).

### 디자인(블록 디오라마)

- 글꼴: 제목·숫자·버튼은 블록 글꼴 Do Hyeon(Google Fonts, SIL OFL), 본문은 Pretendard. 정렬 기준은 가장자리 16px · 간격 10px(`--edge`, `--gap`)이고, 아래쪽 버튼 3개는 같은 폭·같은 높이(56px)입니다.
- 모든 화면이 지도 홈의 블록 지도와 같은 말투를 씁니다: 쿼터뷰 격자 바탕, 아래로 두께가 보이는 흰 블록 버튼·카드(누르면 내려감), 잔디 초록 강조, 분류 색(물새 파랑·숲새 주황·나무 초록).
- 색·두께는 `FE/src/styles.css` 맨 위 `:root` 토큰(`--side`, `--block`, `--brand-side` 등)에서 바꿉니다.
- 도감 칸의 못 찾은 칸은 지도 위 빈 칸과 같은 분류 색 점선 동그라미이고, 찾으면 사진으로 채워집니다. 기록하기의 ‘있던 곳’ 화면도 블록 지도를 씁니다(검토 화면은 위에서 본 지도).
- 화면 한눈에 보기: `docs/호수도감-UI-한눈에-보기.pdf`(한 장에 핵심 화면 4개, 4쪽).

### 알려진 한계

- 카메라 핀치 줌 미해결: 아이폰(크롬/사파리)에서 두 손가락 핀치가 반응하지 않습니다. 카메라의 1x/2x 버튼은 동작합니다. 리스너 부착 문제를 고쳤지만 실기기에서 여전히 재현되며, `?debug=1` 진단 패널로 원인을 확인 중입니다.
- 지도 홈은 쿼터뷰 블록 지도입니다(`FE/public/map/park-iso.svg`, `FE/scripts/build-iso.mjs`). 땅을 10m 칸으로 나눠 OSM 도형대로 블록을 놓았고, 호수·산책로·숲·건물 자리는 실제와 같습니다. 건물 높이는 보기 좋게 줄였고(층수 자료 없음), 숲 언덕의 단은 실제 높이가 아니라 꾸밈입니다. 좌표 변환 값은 `v1.json`의 `map.iso`(`FE/src/lib/iso.ts`)입니다.
- 블록 지도는 화면을 늘 꽉 채우고 그림 밖으로는 끌 수 없습니다(여백 없음). 그래서 받아 둔 OSM 범위(공원 + 둘레 약 150m) 바깥은 블록 마을·숲으로 채웠습니다. 이 바깥 부분은 꾸밈이며 실제와 다릅니다(주변 지역 OSM을 더 받으면 실제 모습으로 바꿀 수 있음).
- 생물 위치 고르기·검토 화면은 정확히 누르기 좋게 위에서 본 지도(`FE/public/map/park-map.svg`, `FE/scripts/build-map.mjs`)를 그대로 씁니다. 구역 경계(Z1~Z6)와 시설 위치는 임시 도형입니다.
- 생물 사진 핀은 GBIF 공개 기록 좌표를 가장 가까운 산책로 위로 옮긴 자리입니다. eBird 핫스폿 대표점(여러 종이 한 좌표에 찍힌 기록)과 위치 오차 150m 넘는 기록은 뺐고, 정밀 기록이 없는 종(주로 나무)은 단서 구역 산책로의 ‘찾아볼 곳’(작고 둥근 핀)으로 표시합니다. 다시 만들 때: `node scripts/fetch-sightings.mjs` → `node scripts/build-sightings.mjs` → `npm run seed:sql`.
- OSM에 호수 서·북쪽 물가길이 없어, 호수 테두리 10m 바깥 둘레를 ‘호숫가 길’로 보탰습니다(`FE/public/map/trails.json`). 실제 답사로 확인이 필요합니다.
- 내가 걸어온 길(최근 3시간)은 기기(IndexedDB)에만 두고 서버로 보내지 않습니다. 위치는 지도 화면을 연 동안만 읽습니다.
- 비오톱 데이터는 샘플 1개(호수)뿐입니다.
- `export-csv` Edge Function은 아직 배포하지 않았습니다. 팀 화면의 CSV 내보내기는 배포 전까지 동작하지 않습니다.
- 앱의 일부 문구(단서 문구, 동의 문구, 일부 헷갈리는 종 설명)는 초안입니다.
- 월별 기록 막대와 이름 검색 자료(`species_catalog.json`)는 연결 전입니다.
- 실기기(안드로이드·아이폰 × 브라우저·웹뷰) 점검은 완료했습니다.

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
  public/map/park-map.svg    위에서 본 지도(생물 위치 고르기·검토용, build-map.mjs가 만듦)
  public/map/park-iso.svg    지도 홈의 쿼터뷰 블록 지도(build-iso.mjs가 만듦)
  public/map/trails.json     산책로 선(내 위치 설명·길 안내, build-sightings.mjs가 만듦)
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

## 4. 환경변수

`FE/.env.example`을 `FE/.env.local`로 복사해 채웁니다(`.env.local`은 커밋하지 않습니다).

| 변수 | 설명 | 예 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase 프로젝트 기본 주소 | `https://<프로젝트ID>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 공개용 키(publishable 또는 anon) | 대시보드의 공개용 키 |

주의:

- URL은 `https://<프로젝트ID>.supabase.co` 기본 주소만 씁니다. `/rest/v1` 같은 경로를 붙이면 로그인 요청이 404가 납니다.
- 키는 공개용(publishable/anon)만 넣습니다. 서비스 키(secret/service_role)는 넣지 않습니다.
- 두 변수를 비우면 로컬 모드(브라우저 안 가짜 서버)로 동작합니다.

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

- 종 추천 호출 한도: 가족당 분당 5회, 하루 100회(현장 테스트 기간 임시 상향), 전체 가족 합산 하루 1500회. 한도 숫자는 가장 최근 마이그레이션 `20261103000300_identify_daily_100.sql`의 `consume_identify_quota` 함수 상단 상수입니다.
- 사진 버킷(`photos`)은 비공개이고, 서명 URL로만 올리고 봅니다. 사진에는 위치 정보(GPS)가 들어갈 수 있으니 다루는 데 주의하세요.
- 이 저장소는 공개이므로 커밋, 이슈, PR, 코드 주석, 로그에도 키나 개인정보를 쓰지 않습니다.
- 키가 저장소에 올라갔다면 파일을 지우는 것으로는 부족합니다(기록에 남습니다). 해당 키를 즉시 재발급(폐기)하세요.

## 7. 협업 방법

- `main`에 직접 커밋하지 않고, 브랜치를 만들어 작업한 뒤 PR로 합칩니다(예: `feature/...`, `fix/...`, `docs/...`).
- 팀원 검토 후 머지하고, `main`에 합쳐지면 Vercel이 자동 배포합니다.
- DB 스키마·서버 설정·배포는 직접 적용하지 말고 요청해 주세요.
- 스키마 변경은 `BE/supabase/migrations/`에 SQL 파일(타임스탬프 이름)로 남깁니다. 이미 적용된 마이그레이션 파일은 수정하지 않고 새 파일을 추가합니다.
- 마이그레이션 SQL 파일은 직접 추가해도 되지만, `supabase db push --remote`로 서버에 적용하는 것은 서버 담당자에게 요청해 주세요.
- PR을 올리기 전에 FE에서 `npm run typecheck`, `npm run test`, `npm run build`가 통과해야 합니다.
- 콘텐츠(`FE/public/content/v1.json`)를 고치면 `npm run seed:sql`로 시드를 다시 만듭니다.

## 아직 임시인 것 (교체 필요)

`FE/public/content/v1.json`의 `placeholders`에도 같은 목록이 있고, `/admin/content`에서 볼 수 있습니다.

- 그림 지도(임시 SVG), 구역 경계 Z1~Z6와 시설 위치(임시 도형)
- 비오톱(호수 1개 샘플)
- 월별 기록 막대, 이름 검색 자료
- 헷갈리는 종, 단서 문구, 가을·겨울 세트 편성, 동의 문구(초안, 팀 검토 필요)
- 자료 이용 조건(`DATA_LICENSE`)
