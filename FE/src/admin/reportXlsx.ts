import type { AdminRow } from '../backend/types';
import type { Taxon } from '../content/types';
import { appearances, isAlien, isOutOfDex, isProtected, kstDateTime, participantNumbers, recordRow, summarize } from './report';

type Cell = string | number | { value: string | number; fontWeight: 'bold' };
const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: 'bold' }));

const APPEARANCE_HEAD = ['종명', '학명', '기록 수', '처음 관찰일', '마지막 관찰일', '구역 / 비오톱', '보호 구분', '상태 검증'];

/** 개인정보(사진 파일·URL·이메일·가족 id)는 넣지 않습니다. 가족은 첫 기록 순서의 "참여자 N"입니다. */
export async function buildReportXlsx(rows: AdminRow[], period: string, taxonOf: (id: string | null) => Taxon | undefined): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser'); // 쓸 때만 내려받습니다
  const sum = summarize(rows);
  const people = participantNumbers(rows);
  const appearanceRows = (pick: (r: AdminRow) => boolean): Cell[][] => [
    head(APPEARANCE_HEAD),
    ...appearances(rows, pick).map((a): Cell[] => [a.name, a.scientificName, a.count, a.first, a.last, a.places, a.protection, a.verified ? '검증됨' : '검증 전']),
  ];
  const all = rows.map((r) => recordRow(r, people.get(r.household_no)!, taxonOf(r.taxon_id)));

  const sheets = [
    {
      sheet: '요약',
      columns: [{ width: 24 }, { width: 28 }],
      data: [
        head(['항목', '값']),
        ['기간(관찰일, 한국 시간)', period],
        ['총 기록 수', sum.records],
        ['참여 가족 수', sum.households],
        ['관찰 종 수', sum.species],
        ['사진 있는 기록 비율', `${Math.round(sum.photoRate * 100)}%`],
        ['만든 시각(한국 시간)', kstDateTime(new Date().toISOString())],
      ] as Cell[][],
    },
    { sheet: '외래종 출현', columns: [{ width: 18 }, { width: 26 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 36 }, { width: 24 }, { width: 10 }], data: appearanceRows(isAlien) },
    { sheet: '보호종 출현', columns: [{ width: 18 }, { width: 26 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 36 }, { width: 24 }, { width: 10 }], data: appearanceRows(isProtected) },
    {
      sheet: '도감 밖 기록',
      columns: [{ width: 18 }, { width: 14 }, { width: 24 }, { width: 24 }, { width: 18 }, { width: 22 }],
      data: [
        head(['관찰일시(KST)', '참여자 번호', '적은 이름', '종 선택 방식', '구역', '확인']),
        ...rows.filter(isOutOfDex).map((r): Cell[] => {
          const x = recordRow(r, people.get(r.household_no)!, undefined);
          return [x.observedAt, x.participant, r.free_text_name ?? '', x.pickSource, x.zone, '전문가 확인 필요'];
        }),
      ] as Cell[][],
    },
    {
      sheet: '관찰기록 전체',
      columns: [18, 12, 18, 24, 14, 22, 11, 11, 18, 18, 18, 8, 16, 30, 12].map((width) => ({ width })),
      stickyRowsCount: 1,
      data: [
        head(['관찰일시(KST)', '참여자 번호', '종명', '학명', '분류군', '종 선택 방식', '위도', '경도', '위치 지정 방법', '구역', '비오톱 유형', '사진 수', '외래종 여부', '보호 구분', '검수 상태']),
        ...all.map((x): Cell[] => [x.observedAt, x.participant, x.name, x.scientificName, x.group, x.pickSource, x.lat, x.lng, x.method, x.zone, x.biotope, x.photos, x.alien, x.protection, x.review]),
      ] as Cell[][],
    },
    {
      sheet: '설명',
      columns: [{ width: 22 }, { width: 90 }],
      data: [
        head(['열 / 항목', '의미']),
        ['관찰일시(KST)', '관찰한 시각(한국 시간). 사진 EXIF 시각이 있으면 그 시각입니다.'],
        ['참여자 번호', '이 파일 안에서 가족을 첫 기록 순서대로 1, 2, 3…으로 바꾼 번호입니다. 파일마다 번호가 달라질 수 있고, 서버의 가족 id와 연결되지 않습니다.'],
        ['종명 / 학명', '검토 결과 기준 종입니다. 직접 입력한 이름은 "(직접 입력)"으로 표시됩니다.'],
        ['종 선택 방식', '가족이 종을 고른 방법(카드, 구역 추천, 이름 검색, 사진 추천, 목록에 없어요, 잘 모르겠어요).'],
        ['위도 / 경도', '생물이 있던 위치(가족이 지도에서 찍거나 내 근처로 지정). 관찰자 위치가 아닙니다.'],
        ['구역 / 비오톱 유형', '위치로 자동 판정한 공원 구역과 비오톱(비오톱 자료는 현재 샘플 1개).'],
        ['사진 수', '숨기지 않은 사진 수. 사진 파일과 주소는 이 파일에 없습니다.'],
        ['외래종 여부 / 보호 구분', '종별 상태표(src/admin/taxon-status.json) 값입니다. 공란은 "해당 없음"이 아니라 "아직 확인 안 됨"입니다. "(검증 전)"은 공식 목록과 대조하기 전 값입니다.'],
        ['검수 상태', '미동정 / 추정(가족) / 검토 완료 / 판단 불가.'],
        ['도감 밖 기록', '"목록에 없어요" 또는 "잘 모르겠어요"로 남긴 기록. 전문가 확인이 필요합니다.'],
        ['제외된 것', '숨긴 기록과 숨긴 사진, 사진 파일·URL, 이메일, 가족 id 원본.'],
      ] as Cell[][],
    },
  ];
  return writeXlsxFile(sheets).toBlob();
}
