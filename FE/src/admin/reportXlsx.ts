import type { AdminRow, AdminWalk } from '../backend/types';
import type { Taxon } from '../content/types';
import { ID_STATUS_LABEL } from '@shared/dwc';
import {
  LOCATION_METHOD_LABEL,
  PICK_SOURCE_LABEL,
  RADIUS_BINS,
  TAXON_STATUS,
  biotopeSummary,
  countBy,
  isAlien,
  isOutOfDex,
  isProtected,
  kstDateTime,
  participantNumbers,
  radiusBin,
  recordRow,
  summarize,
  walkNumbers,
  walkSummary,
} from './report';

type Cell = string | number | { value: string | number; fontWeight?: 'bold'; format?: string };
const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: 'bold' }));
/** 숫자 그대로 두고 표시만 소수점 6자리 */
const coord = (value: number): Cell => ({ value, format: '0.000000' });
const widths = (w: number[]) => w.map((width) => ({ width }));

export interface ReportInput {
  /** 기간 필터 전 전체 기록(숨긴 기록 포함). 참여자·산책 번호를 기간과 상관없이 고정하는 데 씁니다. */
  all: AdminRow[];
  /** 기간 안의, 숨기지 않은 기록 */
  rows: AdminRow[];
  hiddenCount: number;
  walks: AdminWalk[];
  period: string;
  taxonOf: (id: string | null) => Taxon | undefined;
}

const OCCURRENCE_HEAD = ['기록 ID', '관찰일시(KST)', '종명', '학명', '위도', '경도', '위치 오차(m)', '구역 코드', '구역 이름', '비오톱 코드', '비오톱 이름', '사진 수', '검수 상태', '상태 검증'];

/** 개인정보(사진 파일·URL·이메일·가족 id)는 넣지 않습니다. 가족은 첫 기록 순서의 "참여자 N"입니다. */
export async function buildReportXlsx({ all, rows, hiddenCount, walks, period, taxonOf }: ReportInput): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser'); // 쓸 때만 내려받습니다
  const sum = summarize(rows);
  const people = participantNumbers(all);
  const walkNo = walkNumbers(walks);
  const walkSum = walkSummary(rows, walks);
  const rec = (r: AdminRow) => recordRow(r, people.get(r.household_no)!, taxonOf(r.taxon_id), walkNo.get(r.walk_id));
  const alien = rows.filter(isAlien);
  const prot = rows.filter(isProtected);
  const reviewed = rows.filter((r) => r.id_status === 'reviewed').length;

  // 출현 1건 = 1행
  const occurrences = (list: AdminRow[]): Cell[][] => [
    head(OCCURRENCE_HEAD),
    ...list.map((r): Cell[] => {
      const x = rec(r);
      return [x.id, x.observedAt, r.vernacular_name ?? '', x.scientificName, coord(x.lat), coord(x.lng), x.radius, x.zoneCode, x.zoneName, x.biotopeCode, x.biotope, x.photos, x.review, TAXON_STATUS[r.taxon_id ?? '']?.verified ? '검증됨' : '검증 전'];
    }),
  ];

  const countRows = (title: string, list: [string, number][]): Cell[][] => list.map(([label, n]): Cell[] => [title, label, n]);
  const quality: Cell[][] = [
    head(['구분', '항목', '건수']),
    ...countRows('검수 상태', countBy(rows, (r) => ID_STATUS_LABEL[r.id_status], Object.values(ID_STATUS_LABEL))),
    ...countRows('종 선택 방식', countBy(rows, (r) => PICK_SOURCE_LABEL[r.pick_source] ?? r.pick_source, Object.values(PICK_SOURCE_LABEL))),
    ...countRows('위치 지정 방법', countBy(rows, (r) => LOCATION_METHOD_LABEL[r.location_method] ?? r.location_method, Object.values(LOCATION_METHOD_LABEL))),
    ...countRows('위치 오차 구간', countBy(rows, (r) => radiusBin(r.radius_m), RADIUS_BINS)),
  ];

  const sheets = [
    {
      sheet: '요약',
      columns: widths([30, 40]),
      data: [
        head(['항목', '값']),
        ['기간(관찰일, 한국 시간)', period],
        ['총 기록 수', sum.records],
        ['참여 가족 수', sum.households],
        ['관찰 종 수', sum.species],
        ['사진 있는 기록 비율', `${Math.round(sum.photoRate * 100)}%`],
        ['산책(조사) 횟수', walkSum.count],
        ['총 산책 시간(분)', walkSum.minutes],
        ['검수 완료 비율', sum.records ? `${Math.round((reviewed / sum.records) * 100)}%` : '–'],
        ['숨김(제외) 기록 수', hiddenCount],
        ['외래종 출현 건수', alien.length],
        ['보호종 출현 건수', prot.length],
        ['좌표계', 'WGS84 (EPSG:4326)'],
        ['데이터 출처', '동탄호수공원 시민 참여 기록'],
        ['만든 시각(한국 시간)', kstDateTime(new Date().toISOString())],
      ] as Cell[][],
    },
    { sheet: '외래종 출현', columns: widths([11, 18, 18, 26, 11, 11, 12, 10, 16, 12, 16, 8, 12, 10]), stickyRowsCount: 1, data: occurrences(alien) },
    { sheet: '보호종 출현', columns: widths([11, 18, 18, 26, 11, 11, 12, 10, 16, 12, 16, 8, 12, 10]), stickyRowsCount: 1, data: occurrences(prot) },
    {
      sheet: '도감 밖 기록',
      columns: widths([11, 18, 12, 24, 24, 11, 11, 12, 16, 12, 16, 8, 18]),
      stickyRowsCount: 1,
      data: [
        head(['기록 ID', '관찰일시(KST)', '참여자 번호', '적은 이름', '종 선택 방식', '위도', '경도', '위치 오차(m)', '구역', '비오톱 코드', '비오톱 이름', '사진 수', '확인']),
        ...rows.filter(isOutOfDex).map((r): Cell[] => {
          const x = rec(r);
          return [x.id, x.observedAt, x.participant, r.free_text_name ?? '', x.pickSource, coord(x.lat), coord(x.lng), x.radius, x.zone, x.biotopeCode, x.biotope, x.photos, '전문가 확인 필요'];
        }),
      ] as Cell[][],
    },
    {
      sheet: '관찰기록 전체',
      columns: widths([11, 12, 18, 12, 10, 18, 26, 14, 22, 11, 11, 12, 16, 14, 10, 16, 12, 16, 8, 16, 30, 12]),
      stickyRowsCount: 1,
      data: [
        head(['기록 ID', '관찰일', '관찰일시(KST)', '참여자 번호', '산책 번호', '종명', '학명', '분류군', '종 선택 방식', '위도', '경도', '위치 오차(m)', '위치 지정 방법', '촬영자 위치 유무', '구역 코드', '구역 이름', '비오톱 코드', '비오톱 이름', '사진 수', '외래종 여부', '보호 구분', '검수 상태']),
        ...rows.map((r): Cell[] => {
          const x = rec(r);
          return [x.id, x.date, x.observedAt, x.participant, x.walkNo, x.name, x.scientificName, x.group, x.pickSource, coord(x.lat), coord(x.lng), x.radius, x.method, x.hasObserver, x.zoneCode, x.zoneName, x.biotopeCode, x.biotope, x.photos, x.alien, x.protection, x.review];
        }),
      ] as Cell[][],
    },
    {
      sheet: '비오톱별 요약',
      columns: widths([14, 24, 10, 8, 70, 14]),
      stickyRowsCount: 1,
      data: [
        head(['비오톱 코드', '비오톱 이름', '기록 수', '종 수', '종 목록', '중요종(외래종·보호종) 수']),
        ...biotopeSummary(rows).map((b): Cell[] => [b.code, b.name, b.records, b.species, b.speciesList, b.important]),
      ] as Cell[][],
    },
    { sheet: '데이터 품질', columns: widths([18, 28, 10]), data: quality },
    {
      sheet: '설명',
      columns: widths([26, 100]),
      data: [
        head(['열 / 항목', '의미']),
        ['[자료 개요]', ''],
        ['좌표계', 'WGS84 (EPSG:4326). 위도·경도는 십진 도(decimal degrees)이고, 값은 그대로 두고 표시만 소수점 6자리입니다.'],
        ['수집 방법', '시민(가족)이 앱으로 생물 관찰을 사진과 함께 기록합니다. AI가 사진으로 종 후보를 추천하지만 최종 선택은 사용자가 합니다.'],
        ['이용 시 유의사항', '시민이 남긴 자료이며 검수 전 기록이 포함되어 있습니다. 종 동정은 "검수 상태"를 함께 확인하고, 도감 밖 기록은 전문가 확인이 필요합니다.'],
        ['종 상태 정보 기준', '외래종·보호 구분은 종별 상태표(src/admin/taxon-status.json)의 초안 값이며 공식 목록과 대조하기 전입니다. 공란은 "해당 없음"이 아니라 "아직 확인 안 됨"입니다. "(검증 전)"·"상태 검증=검증 전"은 대조 전 값입니다.'],
        ['제외된 것', '숨긴 기록과 숨긴 사진, 사진 파일·URL, 이메일, 가족 id 원본.'],
        ['[요약 시트]', ''],
        ['산책(조사) 횟수', '기간 안에 기록이 있는 산책의 수.'],
        ['총 산책 시간(분)', '위 산책들의 (종료 시각 − 시작 시각) 합. 아직 끝나지 않은 산책은 마지막 활동 시각까지로 셉니다.'],
        ['검수 완료 비율', '검수 상태가 "검토 완료"인 기록 / 총 기록 수.'],
        ['숨김(제외) 기록 수', '기간 안에서 검토자가 숨겨 이 파일에서 뺀 기록의 수.'],
        ['외래종·보호종 출현 건수', '해당 종으로 판정된 기록 수(종 수가 아니라 건수). 종 상태 정보 기준은 위 설명을 보세요.'],
        ['[기록 열]', ''],
        ['기록 ID', '관찰 기록 UUID의 앞 8자리. 바뀌지 않으며 모든 기록 행에 있습니다. 매우 드물게 겹칠 수 있습니다.'],
        ['관찰일 / 관찰일시(KST)', '관찰한 날짜 / 시각(한국 시간). 사진 EXIF 시각이 있으면 그 시각입니다.'],
        ['참여자 번호', '가족을 전체 기록 기준 첫 기록 순서로 1, 2, 3…으로 바꾼 번호. 기간을 바꿔도 같은 가족은 같은 번호이고, 가족 id와 연결되지 않습니다. 새 가족이 생기면 나중 번호가 추가됩니다.'],
        ['산책 번호', '전체 산책을 시작 시각 순서로 센 번호. 기간을 바꿔도 같은 산책은 같은 번호입니다.'],
        ['종명 / 학명', '검토 결과 기준 종. 직접 입력한 이름은 "(직접 입력)"으로 표시됩니다.'],
        ['종 선택 방식', '가족이 종을 고른 방법(카드, 구역 추천, 이름 검색, 사진 추천, 목록에 없어요, 잘 모르겠어요).'],
        ['위도 / 경도', '생물이 있던 위치(가족이 지도에서 찍거나 내 근처로 지정). 촬영자 위치가 아닙니다.'],
        ['위치 오차(m)', '생물 위치 반경(가족이 고른 10·25·50m 등). Darwin Core의 coordinateUncertaintyInMeters와 같은 값입니다.'],
        ['위치 지정 방법', '지도에서 직접 찍음 / 내 근처.'],
        ['촬영자 위치 유무', '촬영자의 GPS 위치가 기록되어 있는지(있음/없음). 좌표 자체는 이 파일에 없습니다.'],
        ['구역 코드 / 구역 이름', '위치로 자동 판정한 공원 구역(예: Z1)과 이름. 공원 밖이면 코드는 공란, 이름은 "공원 밖".'],
        ['비오톱 코드 / 비오톱 이름', '위치로 자동 판정한 비오톱 유형(비오톱 자료는 현재 샘플 1개).'],
        ['사진 수', '숨기지 않은 사진 수. 사진 파일과 주소는 이 파일에 없습니다.'],
        ['외래종 여부 / 보호 구분', '종별 상태표 값(공식 목록 대조 전 초안).'],
        ['검수 상태', '미동정 / 추정(가족) / 검토 완료 / 판단 불가.'],
        ['상태 검증', '그 종의 외래종·보호 구분 값을 공식 목록과 대조했는지(검증됨/검증 전).'],
        ['[시트별 안내]', ''],
        ['외래종 출현 / 보호종 출현', '출현 1건 = 1행입니다.'],
        ['도감 밖 기록', '"목록에 없어요" 또는 "잘 모르겠어요"로 남긴 기록. 전문가 확인이 필요합니다.'],
        ['비오톱별 요약', '비오톱별 기록 수, 종 수, 종 목록, 중요종 수(외래종 또는 보호종으로 표시된 종의 수). 비오톱이 없는 기록은 코드 공란("비오톱 없음")으로 묶습니다.'],
        ['데이터 품질', '검수 상태·종 선택 방식·위치 지정 방법·위치 오차 구간(10m 이하 / 10~25m / 25~50m / 50m 초과 / 값 없음)별 기록 건수.'],
      ] as Cell[][],
    },
  ];
  return writeXlsxFile(sheets).toBlob();
}
