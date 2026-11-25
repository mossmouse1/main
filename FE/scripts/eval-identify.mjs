import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import sharp from 'sharp';
import { checkInput, IDENTIFY_JPEG_QUALITY, IDENTIFY_LONG_EDGE, visibleIdentifyCandidates } from '../../BE/supabase/functions/_shared/identify.ts';
import { ERROR_LIMIT, errorUpper95, scoreIdentification } from './lib/identify-eval.ts';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const content = JSON.parse(await readFile(resolve(publicDir, 'content/v1.json'), 'utf8'));
const taxa = new Set(content.taxa.map(({ id }) => id));

async function loadCases(manifest) {
  const rows = manifest
    ? JSON.parse(await readFile(manifest, 'utf8'))
    : content.fieldPhotos.filter(({ taxonId }) => taxonId).map(({ id, src, taxonId }) => ({
        id, image: src.slice(1), taxonId,
      }));
  if (!Array.isArray(rows) || !rows.length) throw new Error('검증에 사용할 사진 목록이 비어 있습니다.');
  const directory = manifest ? dirname(resolve(manifest)) : publicDir;
  const hashes = new Set();
  const cases = [];
  for (const [index, row] of rows.entries()) {
    if (typeof row?.image !== 'string' || !row.image || (row.taxonId !== null && !taxa.has(row.taxonId))) {
      throw new Error(`사진 ${index + 1}: image 경로와 도감 taxonId(식별 불가 사진은 null)가 필요합니다.`);
    }
    const image = await readFile(resolve(directory, row.image));
    const hash = createHash('sha256').update(image).digest('hex');
    if (hashes.has(hash)) throw new Error(`사진 ${index + 1}: 같은 이미지가 이미 목록에 있습니다.`);
    hashes.add(hash);
    cases.push({ id: row.id ?? index + 1, image, expected: row.taxonId });
  }
  return cases;
}

async function connect() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('실제 모델 검증에는 검증용 Supabase 주소와 공개 키가 필요합니다.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: authError } = await client.auth.signInAnonymously();
  if (authError) throw new Error(`검증 계정 인증 실패 (${authError.status ?? 'network'})`);
  const { error: consentError } = await client.rpc('register_consent', {
    p_version: 'identify-eval', p_consented_at: new Date().toISOString(), p_adults: null, p_children: null,
  });
  if (consentError) throw new Error(`검증 계정 동의 등록 실패 (${consentError.code})`);
  return client;
}

async function evaluate(client, cases) {
  const rows = [];
  for (const [index, { id, image, expected }] of cases.entries()) {
    const jpeg = await sharp(image).rotate().resize({
      width: IDENTIFY_LONG_EDGE, height: IDENTIFY_LONG_EDGE, fit: 'inside', withoutEnlargement: true,
    }).jpeg({ quality: Math.round(IDENTIFY_JPEG_QUALITY * 100) }).toBuffer();
    const body = { imageBase64: jpeg.toString('base64'), mime: 'image/jpeg' };
    const invalid = checkInput(body);
    if (invalid) throw new Error(`사진 ${id} 요청 불가 (${invalid.error})`);
    const invoke = () => client.functions.invoke('identify-species', { body, signal: AbortSignal.timeout(60_000) });
    let response = await invoke();
    if (response.error instanceof FunctionsHttpError && response.error.context.status === 429) {
      const failure = await response.error.context.clone().json().catch(() => null);
      if (failure?.error === 'rate_limited') {
        console.error('분당 한도에 도달했습니다. 1분 뒤 같은 사진을 다시 확인합니다.');
        await wait(60_000);
        response = await invoke();
      }
    }
    if (response.error) {
      const status = response.error instanceof FunctionsHttpError ? response.error.context.status : 'network';
      throw new Error(`사진 ${id}: 실제 AI 호출 실패 (${status}). 검증 완료 ${rows.length}/${cases.length}건.`);
    }
    if (typeof response.data?.noMatch !== 'boolean' || !Array.isArray(response.data.candidates)) {
      throw new Error(`사진 ${id}: 서버 응답 형식이 다릅니다.`);
    }
    const [first] = visibleIdentifyCandidates(response.data, (taxonId) => taxa.has(taxonId));
    rows.push({ id, expected, actual: first?.taxonId ?? null });
    if ((index + 1) % 5 === 0) console.error(`${index + 1}/${cases.length}장 분석 완료`);
  }
  return rows;
}

try {
  const { values } = parseArgs({ options: { inspect: { type: 'boolean' }, manifest: { type: 'string' } } });
  const cases = await loadCases(values.manifest);
  const known = cases.filter(({ expected }) => expected !== null);
  console.log(JSON.stringify({
    dataset: values.manifest ? 'holdout-manifest' : 'repository-field-photos',
    images: cases.length,
    identifiedSpecies: new Set(known.map(({ expected }) => expected)).size,
    identifiableImages: known.length,
    noRecommendationExpected: cases.length - known.length,
    bestPossibleKnownErrorUpper95: errorUpper95(0, known.length),
  }, null, 2));
  if (!values.inspect) {
    const rows = await evaluate(await connect(), cases);
    const score = scoreIdentification(rows);
    const passed = !!values.manifest && score.errorUpper95 !== null && score.errorUpper95 < ERROR_LIMIT &&
      score.knownErrorUpper95 !== null && score.knownErrorUpper95 < ERROR_LIMIT;
    console.log(JSON.stringify({ ...score, target: ERROR_LIMIT, passed, mismatches: rows.filter(({ expected, actual }) => expected !== actual) }, null, 2));
    if (!passed) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
