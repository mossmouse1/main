/**
 * 조사 노력 문구. 서버의 walk_effort_text()와 같은 형식이어야 합니다.
 * 예: "어른 1·아이 2 × 40분, Z1·Z4"
 */
export function effortText(input: {
  adults: number | null;
  children: number | null;
  minutes: number;
  zoneIds: string[];
}): string {
  const people =
    input.adults == null && input.children == null
      ? '인원 미입력'
      : `어른 ${input.adults ?? 0}·아이 ${input.children ?? 0}`;
  const zones = [...new Set(input.zoneIds)].sort();
  return `${people} × ${input.minutes}분` + (zones.length ? `, ${zones.join('·')}` : '');
}
