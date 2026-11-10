# 우리 공원 생명 도감 (모바일 웹)

동탄호수공원에서 아이와 함께 온 보호자가 남긴 관찰을, 팀이 검토하고 Darwin Core CSV로 내보내는 모바일 웹입니다. 기획은 [prd.md](prd.md)(v0.2)를 따릅니다.

## 바로 실행

```bash
npm install
npm run dev        # http://localhost:5173  (가족 화면)  /admin (팀 검토)
npm test           # 단위 테스트(조사 노력·구역 판정·후보·도감·Darwin Core CSV)
npm run build      # 타입 검사 + 배포용 빌드(dist/)
```

`.env`가 없으면 **로컬 모드**로 동작합니다. 서버 대신 브라우저 안의 가짜 서버(IndexedDB)에 저장해서, Supabase 없이도 가족 흐름 → 검토 → CSV 내보내기를 한 브라우저에서 끝까지 시험할 수 있습니다. 가짜 서버도 실제 서버와 같은 규칙(멱등 저장, 구역·비오톱 판정, 조사 노력, 분당 20건 제한, 검토 이력)을 따르고, 오프라인이면 똑같이 실패합니다.

> 휴대폰에서 카메라·위치를 시험하려면 **HTTPS**가 필요합니다. Vercel/Cloudflare Pages 미리보기 배포나 HTTPS 터널을 쓰세요.

## 지금 된 것

| 기능 | 상태 | 위치 |
| --- | --- | --- |
| F01 바로 시작(안내 3장, 동의, 사람 수, 익명 계정) | ✅ | `src/screens/Welcome.tsx` |
| F02 공원 지도(그림 지도 ImageOverlay, 1~4배, 구역·생물 핀, 내 위치, 필터, 공원 밖 안내) | ✅ | `src/components/ParkMap.tsx`, `src/screens/MapHome.tsx` |
| F03 오늘 찾을 6종 · F04 생물 카드(단서, 월별 막대, 헷갈리는 종) | ✅ (월별 자료는 연결 전) | `src/screens/SpeciesCard.tsx` |
| F05 사진(카메라/앨범, 1~3장, 원본 + 1280px 사본, HEIC, EXIF 시각) | ✅ | `src/platform.ts`, `src/lib/photo.ts` |
| F06 후보 3개 / 목록에 없어요 / 잘 모르겠어요 | ✅ | `src/screens/Record.tsx` |
| F07 생물 위치(지도 탭, 반경 10/25/50m, 내 근처, 거리 표시) | ✅ | `src/screens/Record.tsx` |
| F08 자동 기록 · F09 오프라인 저장(IndexedDB 대기열, 재시도, 원본은 서버 확인 뒤 삭제) | ✅ | `src/data/observations.ts`, `src/data/sync.ts` |
| F10 가족 도감(칸, 진행률, NEW, 다음 단서, 검토 반영) | ✅ | `src/screens/Dex.tsx`, `src/lib/dex.ts` |
| F11 탐험 시작·끝(30분 무활동·3시간 자동 종료, 조사 노력, 요약) | ✅ | `src/data/walks.ts`, `src/screens/WalkSummary.tsx` |
| F12 팀 검토(동정 상태·이력, 중복 묶기, 숨기기, 사진 숨기기) | ✅ | `src/admin/Review.tsx` |
| F13 CSV 내보내기(Darwin Core, BOM, 기간·상태 필터, 검토 이력 CSV) | ✅ | `BE/supabase/functions/_shared/dwc.ts`, `BE/supabase/functions/export-csv` |
| F14 기록 지키기(이메일 연결, 삭제 요청) | ◐ Supabase 모드에서만, 새 기기 로그인 화면은 아직 | `src/screens/Settings.tsx` |
| F15 구역 상세 | ✅ | `src/screens/ZoneDetail.tsx` |
| F16 콘텐츠 편집 화면 | ✗ 읽기만(편집은 JSON) | `src/admin/ContentAdmin.tsx` |
| F17 품질 지표 | ◐ 완결률·기록 시간·일치율·검토 가능 비율 | `src/admin/ContentAdmin.tsx` |

Edge(헤드리스, 390×844)로 개발 서버와 배포 빌드 양쪽에서 확인한 흐름: 안내 → 동의 → 지도 → 생물 카드 → 찍기 → 고르기 → 위치 → 저장(완료 화면까지 약 100ms) → 비행기 모드에서 3건 저장(“대기 중 3건”) → 다시 연결 → 4건 모두 중복 없이 전송 → CSV 4행(BOM) → 검토에서 물닭→쇠물닭 → 가족 화면에 “확인 후 바뀌었어요”.

Supabase SQL(마이그레이션·시드·DB 함수·RLS·저장소 정책)은 Docker 없이 PGlite + PostGIS에 auth/storage 스텁을 붙여 35개 항목을 확인했습니다(멱등 저장, 구역·비오톱 판정, 조사 노력, 다른 가족 기록 차단, 검토 이력, 중복 묶기, 자동 종료, 분당 20건 제한 등). 실제 Supabase 프로젝트, Edge Function, pg_cron, 실기기·웹뷰 점검은 아직입니다.

## 구조

```
public/content/v1.json     콘텐츠 한 곳: 구역·시설·비오톱·종 카드·계절 세트 (GET /content/v1.json)
public/map/park-map.svg    임시 그림 지도
src/platform.ts            카메라·위치·저장소는 여기서만 부름(웹뷰 네이티브 브리지 교체 지점)
src/data/                  기기 DB(Dexie), 기록·탐험·전송 대기열·사용 기록
src/backend/               서버 연결: local.ts(가짜 서버) / supabase.ts
src/screens/               가족 화면 S0~S11
src/admin/                 팀 화면 A1~A3 (/admin, 따로 받음)
BE/supabase/migrations/       테이블·RLS·DB 함수(PostGIS 구역·비오톱 판정, 멱등 저장, 검토)
BE/supabase/functions/        export-csv(Edge Function), _shared/dwc.ts(웹과 같이 쓰는 매핑)
scripts/gen-seed.mjs       v1.json → supabase/seed.sql
```

## Supabase 연결

1. 프로젝트를 만들고 **Authentication → Anonymous sign-ins**를 켭니다(봇 막기용 CAPTCHA 권장). Authentication → URL Configuration에 배포 주소를 넣습니다(이메일 연결 링크용).
2. 스키마: `npx supabase link --project-ref <ref>` 후 `npx supabase db push`. 두 번째 마이그레이션은 pg_cron(30분 무활동 탐험 자동 종료)을 씁니다.
3. 시드: `npm run seed:sql` 후 `BE/supabase/seed.sql`을 SQL 편집기에서 실행합니다(콘텐츠를 고칠 때마다 다시).
4. 내보내기 함수: `npx supabase functions deploy export-csv`
5. 검토자 계정: Authentication에서 사용자를 만든 뒤 SQL로 역할을 줍니다.
   ```sql
   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"reviewer"}' where email = '검토자@메일';
   ```
6. `.env.example`을 `.env`로 복사해 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣습니다.

## 아직 임시인 것 (교체 필요)

`public/content/v1.json`의 `placeholders`에도 같은 목록이 있고, /admin/content에 보입니다.

- **그림 지도**: 임시 SVG. 발표 표지 그림 지도(1080×1302, WebP 600KB 이하)로 바꾸고 `map.image`만 고치면 됩니다.
- **구역 경계 Z1~Z6, 시설 위치**: 임시 도형. 공원조성계획도·사전답사로 그린 GeoJSON으로 교체.
- **비오톱**: 호수(DC2) 1개만 임시. `biotope_samples_4326.geojson`(97개)로 교체.
- **월별 기록 막대 / 이름 591개 검색**: `species_catalog.json`을 받으면 연결합니다(지금은 “자료 연결 전” 표시, 검색은 시드 39종).
- **헷갈리는 종**: 물닭·쇠물닭·흰뺨검둥오리만 확정, 나머지는 초안(draft).
- **단서 문구, 가을 12칸·겨울 세트 편성, 동의 문구**: 초안. 팀 검토 필요.
- **license 열**: 자료 이용 조건이 정해지면 `DATA_LICENSE`에 넣습니다.

## 다음에 할 일

- 실기기 4종(안드로이드·아이폰 × 브라우저·웹뷰) 점검표와 비행기 모드·강제 종료 시험
- M3 자료(`species_catalog.json`, `biotope_samples_4326.geojson`, `analysis_summary.json`) 가져오기 스크립트
- 기록 지키기: 다른 기기에서 이메일로 이어 쓰기 화면, 삭제 요청 처리 흐름
- 콘텐츠 편집 화면(F16), 첫 기록 완료율·재방문 집계(usage_events)
- 사진 내보내기 방식(associatedMedia에 지금은 저장소 경로) 결정
