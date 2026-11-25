import { describe, expect, it } from 'vitest';
import { buildRequest, checkInput, mapQuotaError, MAX_BASE64_CHARS, parseResult, visibleIdentifyCandidates, type TaxonLite } from './identify';

const taxa: TaxonLite[] = [
  { id: 'a', korean_name: '청둥오리', scientific_name: 'Anas platyrhynchos', category: 'bird' },
  { id: 'b', korean_name: '쇠물닭', scientific_name: 'Gallinula chloropus', category: 'bird' },
  { id: 'c', korean_name: '왕버들', scientific_name: 'Salix chaenomeloides', category: 'plant' },
  { id: 'd', korean_name: '참새', scientific_name: 'Passer montanus', category: 'bird' },
];
const wrap = (obj: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }] });

describe('buildRequest', () => {
  it('taxonId를 목록 id로 제한하고 high 이미지로 보낸다', () => {
    const r = buildRequest('m', taxa, 'AAAA', 'image/jpeg');
    const props = (r.text.format.schema.properties.candidates.items.properties as any).taxonId;
    expect(props.enum).toEqual(['a', 'b', 'c', 'd']);
    const content = r.input[0].content as any[];
    expect(content[0]).toMatchObject({ detail: 'high', image_url: 'data:image/jpeg;base64,AAAA' });
    expect(r.instructions).toContain('b: 쇠물닭 / Gallinula chloropus');
  });
});

describe('parseResult', () => {
  it('목록에 없는 종과 중복, 범위 밖 점수를 버리고 3개까지만 남긴다', () => {
    const r = parseResult(
      wrap({ noMatch: false, candidates: [{ taxonId: 'zzz', confidence: 0.9 }, { taxonId: 'a', confidence: 1.7 }, { taxonId: 'a', confidence: 0.5 }, { taxonId: 'b', confidence: 0.3 }, { taxonId: 'c', confidence: 0.2 }, { taxonId: 'd', confidence: 0.1 }] }),
      taxa,
    );
    expect(r).toEqual({
      noMatch: false,
      candidates: [
        { taxonId: 'a', koreanName: '청둥오리', confidence: 0.5 },
        { taxonId: 'b', koreanName: '쇠물닭', confidence: 0.3 },
        { taxonId: 'c', koreanName: '왕버들', confidence: 0.2 },
      ],
    });
  });
  it('후보가 모두 걸러지면 noMatch', () => {
    expect(parseResult(wrap({ noMatch: false, candidates: [{ taxonId: 'x', confidence: 1 }] }), taxa)).toEqual({ candidates: [], noMatch: true });
  });
  it('모델이 식별 불가로 답했으면 함께 보낸 후보를 버린다', () => {
    expect(parseResult(wrap({ noMatch: true, candidates: [{ taxonId: 'a', confidence: 0.9 }] }), taxa)).toEqual({ candidates: [], noMatch: true });
  });
  it('형식 오류·미완료·거절은 null', () => {
    expect(parseResult({ status: 'incomplete', output: [] }, taxa)).toBeNull();
    expect(parseResult({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, taxa)).toBeNull();
    expect(parseResult({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] }, taxa)).toBeNull();
    expect(parseResult(null, taxa)).toBeNull();
  });
});

describe('visibleIdentifyCandidates', () => {
  const candidate = { taxonId: 'a', koreanName: '청둥오리', confidence: 0.5 };
  const accepts = (id: string) => id === 'a';

  it('화면과 평가에서 낮거나 범위를 벗어난 점수를 추천하지 않는다', () => {
    for (const confidence of [0.49, 1.1, NaN, Infinity]) {
      expect(visibleIdentifyCandidates({ noMatch: false, candidates: [{ ...candidate, confidence }] }, accepts)).toEqual([]);
    }
    expect(visibleIdentifyCandidates({ noMatch: false, candidates: [candidate] }, accepts)).toEqual([candidate]);
  });

  it('미동정 결과와 현재 도감에 없는 종은 추천에서 제외한다', () => {
    expect(visibleIdentifyCandidates({ noMatch: true, candidates: [candidate] }, accepts)).toEqual([]);
    expect(visibleIdentifyCandidates({ noMatch: false, candidates: [{ ...candidate, taxonId: 'b' }] }, accepts)).toEqual([]);
  });
});

describe('mapQuotaError', () => {
  it('한도는 429, 동의 없음은 403', () => {
    expect(mapQuotaError('rate_limited')).toEqual({ status: 429, error: 'rate_limited' });
    expect(mapQuotaError('daily_limit')).toEqual({ status: 429, error: 'daily_limit' });
    expect(mapQuotaError('global_limit')).toEqual({ status: 429, error: 'global_limit' });
    expect(mapQuotaError('consent_required')).toEqual({ status: 403, error: 'consent_required' });
    expect(mapQuotaError('boom').status).toBe(500);
  });
});

describe('checkInput', () => {
  it('정상, 형식 오류, 너무 큼', () => {
    expect(checkInput({ imageBase64: '/9j/2Q==', mime: 'image/jpeg' })).toBeNull();
    expect(checkInput({ imageBase64: 'AAAA', mime: 'image/jpeg' })?.error).toBe('invalid_image');
    expect(checkInput({ imageBase64: '/9j/' + 'A'.repeat(1020) + '???=', mime: 'image/jpeg' })?.error).toBe('invalid_image');
    expect(checkInput({ imageBase64: 'AAAA', mime: 'image/png' })?.status).toBe(400);
    expect(checkInput({ imageBase64: 'data:image/jpeg;base64,AAAA', mime: 'image/jpeg' })?.status).toBe(400);
    expect(checkInput({ imageBase64: 'A'.repeat(MAX_BASE64_CHARS + 1), mime: 'image/jpeg' })?.status).toBe(413);
    expect(checkInput(null)?.status).toBe(400);
  });
});
