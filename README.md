# 우리 공원 생명 도감 (모바일 웹)

동탄호수공원에서 아이와 함께 온 가족이 산책하며 생물 관찰을 사진과 함께 남기고, 팀이 그 기록을 검토해 Darwin Core CSV로 내보내는 모바일 웹입니다. 기획은 [prd.md](prd.md)(v0.2)를 따릅니다.

> 이 저장소는 공개입니다. 실제 키, 프로젝트 주소, 사용자 데이터(사진·기록 CSV)는 절대 올리지 않습니다([보안 수칙](#6-보안-수칙) 참고).

## 1. 현재 상태

### 구현된 것

| 기능 | 상태 | 위치 |
| --- | --- | --- |
| F01 바로 시작(전체 지도, 퀘스트 시작 버튼, 설정에서 지도 코치마크 열기) | 구현 | `FE/src/screens/MapHome.tsx`, `FE/src/components/Tour.tsx`, `FE/src/screens/Welcome.tsx` |
| F02 공원 지도 홈(쿼터뷰 블록 지도, 사진 핀, 계절 퀘스트 10종, 내 위치와 산책로 안내) | 구현 | `FE/src/screens/MapHome.tsx`, `FE/src/components/ParkMap.tsx`, `FE/src/lib/trail.ts` |
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
- 계절 퀘스트 지도 위쪽에는 ‘다음에 찾을 생물’이 나옵니다. 못 찾은 생물의 관찰 지점에 가까워지면 같은 자리에 알림이 뜹니다.
- 첫 화면에서 전체 지도를 살펴보고 **퀘스트 시작해 보기**를 누르면 지도에서 찾기, 촬영과 등록, 도감 확인, 완료 사진의 네 단계를 안내합니다. **첫 생물 찾기**를 누르면 참고 사진과 관찰 지점 또는 구역을 엽니다.
- 전체 도감 177종에 참고 사진을 제공합니다. 공개 참고 사진은 재사용 가능한 iNaturalist와 위키미디어 커먼즈 사진을 WebP로 크기 조정한 것이며, 촬영자와 사진 원문 및 이용 조건은 생물 카드에서 확인할 수 있습니다. 핀의 위치는 공개 관찰 기록에서 가져옵니다.
- 계절 퀘스트는 흰뺨검둥오리와 물닭을 고정하고, 계절 식물 후보에서 8종을 골라 시즌 동안 유지합니다. 예전 목록에서 현재 후보에 해당하는 식물은 유지되고, 이전 사진은 전체 도감에서 볼 수 있습니다.
- **전체 도감**에는 계절과 관계없이 내가 찍어 저장한 기록이 남습니다. 이름을 모르는 사진이나 직접 적은 이름도 볼 수 있고, 검토로 종이 확인되면 해당 칸에 반영됩니다.
- 퀘스트의 새 종을 채울 때 저장 화면에 도장과 모션을 표시하고 효과음을 재생합니다. 저장 후 다음 생물을 지도에서 바로 열 수 있습니다. 10종을 모두 모으면 직접 찍은 사진으로 만든 완료 이미지를 저장하거나 현장 운영진에게 보여 줄 수 있습니다. 코치마크는 설정의 **탐험 가이드 다시 보기**에서 열 수 있습니다.
- **조사팀 현장 사진**에는 2026년 11월 12일 촬영본을 담았습니다. 이름을 확인한 사진은 종 카드와 지도에 연결했고, 지도 좌표는 EXIF의 촬영자 위치입니다.
- 가을 후보 식물 9종 중 갈대·남천·단풍나무·토끼풀·수크령은 2026년 11월 12일 현장 사진에서 확인했습니다. 억새와 물억새는 시의 식생 자료, 소나무와 화살나무는 공원 내 11월 식재 관찰에 근거합니다. [화성특례시 가을 식생 자료](https://www.hscity.go.kr/www/user/bbs/BD_selectBbs.do?q_bbsCode=1051&q_bbscttSn=20261012181158202) · [소나무 관찰](https://www.inaturalist.org/observations/100897535) · [화살나무 관찰](https://www.inaturalist.org/observations/101591674)
- 2026년 12월 1일 한국 시간부터 토끼풀이 빠지고, 남은 식물은 마른 이삭과 가지, 남은 열매나 바늘잎으로 찾습니다. 겨울 식물 후보는 공원 내 기록과 겨울에 남는 특징을 함께 고려했습니다. 두 물새는 11월 12일 현장 사진과 1~2월 공원 일대 기록에서 확인했습니다. [물닭 겨울 관찰](https://www.gbif.org/occurrence/6771555088) · [흰뺨검둥오리 겨울 관찰](https://www.gbif.org/occurrence/6785317871) · [서울시 억새·물억새 자료](https://parks.seoul.go.kr/program/detailView.do?bIdx=2718)
- 홈에서 뺀 것: 거르기 칩, 가까운 생물 목록, 나침반, 구역 팻말(확대하면 보임), ‘탐험 시작’ 버튼(탐험은 첫 기록을 저장할 때 자동으로 시작), 처음 안내 슬라이드(코치마크로 바꿈).

### 디자인(블록 디오라마)

- 글꼴: 제목·숫자·버튼은 블록 글꼴 Do Hyeon(Google Fonts, SIL OFL), 본문은 Pretendard. 정렬 기준은 가장자리 16px · 간격 10px(`--edge`, `--gap`)이고, 아래쪽 버튼 3개는 같은 폭·같은 높이(56px)입니다.
- 모든 화면이 지도 홈의 블록 지도와 같은 말투를 씁니다: 쿼터뷰 격자 바탕, 아래로 두께가 보이는 흰 블록 버튼·카드(누르면 내려감), 잔디 초록 강조, 분류 색(물새 파랑·숲새 주황·나무 초록).
- 색·두께는 `FE/src/styles.css` 맨 위 `:root` 토큰(`--side`, `--block`, `--brand-side` 등)에서 바꿉니다.
- 도감 칸의 못 찾은 칸은 지도 위 빈 칸과 같은 분류 색 점선 동그라미이고, 찾으면 사진으로 채워집니다. 기록하기의 ‘있던 곳’ 화면도 블록 지도를 씁니다(검토 화면은 위에서 본 지도).
- 화면 한눈에 보기: `docs/호수도감-UI-한눈에-보기.pdf`(한 장에 핵심 화면 4개, 4쪽).

### 알려진 한계

- 카메라 핀치 줌 미해결: 아이폰(크롬/사파리)에서 두 손가락 핀치가 반응하지 않습니다. 카메라의 1x/2x 버튼은 동작합니다. 리스너 부착 문제를 고쳤지만 실기기에서 여전히 재현되며, `?debug=1` 진단 패널로 원인을 확인 중입니다.
- 지도 홈은 쿼터뷰 블록 지도를 WebP 배경으로 표시합니다(`FE/public/map/park-iso.webp`, SVG 원본 생성 `FE/scripts/build-iso.mjs`). 지도 위에 관찰 핀을 올리며, 확대할 때 같은 관찰 핀은 재사용합니다. OSM 도형을 바탕으로 호수·산책로·숲·건물 위치를 표시하고 건물과 숲 높이는 그림에 맞춰 표현합니다.
- 블록 지도는 화면을 늘 꽉 채우고 그림 밖으로는 끌 수 없습니다(여백 없음). 그래서 받아 둔 OSM 범위(공원 + 둘레 약 150m) 바깥은 블록 마을·숲으로 채웠습니다. 이 바깥 부분은 꾸밈이며 실제와 다릅니다(주변 지역 OSM을 더 받으면 실제 모습으로 바꿀 수 있음).
- 생물 위치 고르기·검토 화면은 정확히 누르기 좋게 위에서 본 지도(`FE/public/map/park-map.svg`, `FE/scripts/build-map.mjs`)를 그대로 씁니다. 구역 경계(Z1~Z6)와 시설 위치는 임시 도형입니다.
- 산책 지도에서 공개 관찰 핀은 원자료의 좌표에 놓입니다. 구역 기록은 구역 표시로 열 수 있고, 찾아볼 곳은 단서에 근거한 산책 안내입니다. 관찰 지점으로 길을 켜면 가까운 산책로까지 안내합니다.
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
  public/map/park-iso.webp   지도 홈의 쿼터뷰 블록 지도(build-iso.mjs가 만듦)
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

### OpenAI 사진 추천 연결

1. [OpenAI API 키 페이지](https://platform.openai.com/api-keys)에서 키를 발급합니다.
2. Supabase 프로젝트의 [Edge Function Secrets](https://supabase.com/dashboard/project/_/functions/secrets)에 이름이 **`OPENAI_API_KEY`**인 시크릿을 만들고 발급한 키를 값에 붙여넣습니다. 기본 모델은 `gpt-5.4-mini`입니다. 이미지 입력과 구조화 출력을 지원하는 다른 모델을 쓰려면 같은 곳에 `OPENAI_MODEL`을 추가합니다.
3. Supabase Authentication의 **Anonymous Sign-Ins**를 켭니다. 기존 원격 DB에는 최신 마이그레이션까지 적용하고, 저장소의 `BE` 폴더에서 Edge Function을 배포합니다. 새 로컬 DB는 Supabase 시작 또는 리셋 시 시드가 적용됩니다.

   ```powershell
   cd BE
   npx supabase functions deploy identify-species --project-ref <프로젝트ID>
   ```

4. 웹앱을 Supabase에 연결하고 휴대폰에서 **촬영 → 관찰 위치 지정 → 생물 확인 → 사진으로 종 추천받기**를 진행합니다. 화면에 고른 사진을 JPEG 사본으로 보내며 후보를 최대 3개 보여줍니다. 후보를 고른 뒤 **맞아요, 도감에 등록**으로 기록합니다.

웹앱에는 위 표의 Supabase 공개 설정 두 가지만 둡니다. OpenAI 키의 위치는 Supabase Edge Function Secrets입니다.

### 공개 관찰 자료 갱신

공원 지도 범위와 [OpenStreetMap 공원 경계](https://www.openstreetmap.org/relation/17419957)가 겹치는 범위를 조회합니다. iNaturalist는 공개 좌표와 재사용 라이선스가 붙은 연구 등급 자료를 사용합니다. GBIF에 올라온 같은 iNaturalist 관찰은 원본 ID로 중복을 제거합니다. 알려진 위치 오차가 100m를 초과하는 좌표는 제외합니다. 원자료에 오차 정보가 없으면 생물 카드에 표시합니다. eBird 체크리스트는 구역 단위로 표시합니다.

- GBIF에서 [네이처링](https://www.gbif.org/publisher/7de30ffe-19bb-489f-a1fb-5e291ad006d5), [국립중앙과학관](https://www.gbif.org/publisher/eb07eeb0-3db9-11d9-8439-b8a03c50a862), [국립생태원](https://www.gbif.org/publisher/6f2da4d9-8bd9-4f4f-852b-22cde4a43a01), [eBird](https://www.gbif.org/dataset/4fa7b334-ce0d-4e88-aaae-2e0c138d049e) 등에서 제공한 관찰을 찾고 [iNaturalist API](https://www.inaturalist.org/api)도 함께 조회합니다. 자료별 라이선스는 기록에 표시합니다.
- 화성시 자료와 별도로 사진을 검토한 공원 내 식재 관찰은 `FE/scripts/data/dongtan-survey.json`에서 추가합니다. 위치 오차가 큰 화살나무 관찰은 구역으로 표시합니다. [화성시민신문의 어류조사 인용](https://www.ohmynews.com/NWS_Web/View/at_pg.aspx?CNTN_CD=A0003061499) · [화성특례시 보도자료](https://www.hscity.go.kr/www/user/bbs/BD_selectBbs.do?q_bbsCode=1051&q_bbscttSn=20261012181158202)
- [제5차 전국자연환경조사 GDB](https://www.data.go.kr/data/15138804/fileData.do)의 공개 파일을 지도 범위로 잘라 확인한 결과 좌표 기록은 0건이었습니다. [국립생태원 공원 평가](https://www.nie.re.kr/nie/cmmn/file/fileDown.do?atchFileId=ef309f94394140d7b28f1de56fcaee86&fileSn=2)는 서식처 자료이며, 확인한 [학술논문](https://www.kci.go.kr/kciportal/mobile/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003134970)은 이용 행태 연구입니다.
- [루카 운영기관의 공개 기록 게시판](https://admin.luca.or.kr/bbs/board.php?bo_table=B12)에서 동탄호수공원·산척·송방천으로 검색한 결과는 0건이었습니다. [경기생물다양성탐사 공개 CSV](https://www.data.go.kr/data/15117062/fileData.do)는 지역별 관찰 종 수를 집계한 자료입니다. 루카 앱에서 이 공원 개별 기록을 내려받는 공개 경로는 확인되지 않았습니다.

```powershell
cd FE
npm run data:observations
npm run seed:sql
```

새 종이 추가되면 대상 원격 DB에도 해당 `taxa` 행을 업서트하는 마이그레이션을 적용합니다. 웹 콘텐츠와 서버 종 목록의 ID가 일치해야 촬영 추천과 저장에서 새 종을 사용할 수 있습니다. 전체 시드는 로컬 DB 초기화에 사용합니다.

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
| OpenAI 키 | Supabase Edge Function Secrets의 `OPENAI_API_KEY` | 대시보드 또는 Supabase CLI에서 설정합니다. |

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
- 헷갈리는 종, 단서 문구, 동의 문구(초안, 팀 검토 필요)
- 자료 이용 조건(`DATA_LICENSE`)
