/** Maximum acceptable error rate. */
export const ERROR_LIMIT = 0.05;

/** Exact one-sided 95% binomial upper limit. Null means there were no trials. */
export function errorUpper95(errors: number, trials: number): number | null {
  if (trials === 0) return null;
  if (errors === trials) return 1;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 50; step++) {
    const p = (low + high) / 2;
    const logOdds = Math.log(p) - Math.log1p(-p);
    let logProbability = trials * Math.log1p(-p);
    let cumulative = Math.exp(logProbability);
    for (let i = 1; i <= errors; i++) {
      logProbability += Math.log((trials - i + 1) / i) + logOdds;
      cumulative += Math.exp(logProbability);
    }
    if (cumulative > 0.05) low = p;
    else high = p;
  }
  return high;
}

export function scoreIdentification(rows: { expected: string | null; actual: string | null }[]) {
  const known = rows.filter(({ expected }) => expected !== null);
  const recommended = rows.filter(({ actual }) => actual !== null);
  const wrong = recommended.filter(({ expected, actual }) => expected !== actual);
  const missed = known.filter(({ actual }) => actual === null);
  const errors = wrong.length + missed.length;
  const knownErrors = wrong.filter(({ expected }) => expected !== null).length + missed.length;
  return {
    tried: rows.length,
    expectedSpecies: known.length,
    recommendations: recommended.length,
    wrongFirstRecommendations: wrong.length,
    falsePositives: wrong.filter(({ expected }) => expected === null).length,
    unresolvedIdentifiablePhotos: missed.length,
    recommendationErrorRate: recommended.length ? wrong.length / recommended.length : null,
    knownErrorUpper95: errorUpper95(knownErrors, known.length),
    errorRate: rows.length ? errors / rows.length : null,
    errorUpper95: errorUpper95(errors, rows.length),
  };
}
