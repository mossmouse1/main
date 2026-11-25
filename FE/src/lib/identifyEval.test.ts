import { describe, expect, it } from 'vitest';
import { ERROR_LIMIT, errorUpper95, scoreIdentification } from '../../scripts/lib/identify-eval';

describe('종 추천 실측 판정', () => {
  it('오답이 없어도 표본이 적으면 95% 오차 상한이 5%를 넘는다', () => {
    expect(errorUpper95(0, 16)).toBeCloseTo(0.17075);
    expect(errorUpper95(0, 58)!).toBeGreaterThan(ERROR_LIMIT);
    expect(errorUpper95(0, 59)!).toBeLessThan(ERROR_LIMIT);
    expect(errorUpper95(1, 92)!).toBeGreaterThan(ERROR_LIMIT);
    expect(errorUpper95(1, 93)!).toBeLessThan(ERROR_LIMIT);
    expect(errorUpper95(0, 0)).toBeNull();
  });

  it('오답, 식별 실패, 종을 추천하면 안 되는 사진의 오답을 센다', () => {
    expect(scoreIdentification([
      { expected: 'a', actual: 'a' },
      { expected: 'a', actual: 'b' },
      { expected: 'b', actual: null },
      { expected: null, actual: 'a' },
      { expected: null, actual: null },
    ])).toMatchObject({
      tried: 5, recommendations: 3, wrongFirstRecommendations: 2,
      unresolvedIdentifiablePhotos: 1, falsePositives: 1,
      recommendationErrorRate: 2 / 3, errorRate: 3 / 5,
    });
  });
});
