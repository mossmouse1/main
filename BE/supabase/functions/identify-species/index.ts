// 사진으로 종 후보 3개 추천. POST { imageBase64, mime: 'image/jpeg' } → { candidates, noMatch }
// OpenAI 키는 `supabase secrets set OPENAI_API_KEY`로만 둡니다. 사진·원문 응답은 로그에 남기지 않습니다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildRequest, checkInput, DEFAULT_MODEL, mapQuotaError, parseResult, type TaxonLite } from '../_shared/identify.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => json({ error }, status);

const CACHE_MS = 10 * 60 * 1000;
let taxaCache: { at: number; rows: TaxonLite[] } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');

  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return fail(401, 'unauthorized');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return fail(401, 'unauthorized');

  const body = await req.json().catch(() => null);
  const bad = checkInput(body);
  if (bad) return fail(bad.status, bad.error);
  const apiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
  if (!apiKey) return fail(503, 'unavailable');

  // 한도 확인 + 호출 기록(통과하면 1회 소진)
  const quota = await sb.rpc('consume_identify_quota');
  if (quota.error) {
    const m = mapQuotaError(quota.error.message);
    return fail(m.status, m.error);
  }

  if (!taxaCache || Date.now() - taxaCache.at > CACHE_MS) {
    const { data, error } = await sb.from('taxa').select('id, korean_name, scientific_name, category').order('id');
    if (error || !data?.length) return fail(500, 'server_error');
    taxaCache = { at: Date.now(), rows: data as TaxonLite[] };
  }
  const taxa = taxaCache.rows;

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(Deno.env.get('OPENAI_MODEL') || DEFAULT_MODEL, taxa, body.imageBase64, body.mime)),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) {
      console.error('openai_status', res.status); // 본문은 남기지 않음
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 429) return fail(503, 'unavailable');
      return fail(502, 'upstream_error');
    }
    const result = parseResult(await res.json(), taxa);
    return result ? json(result) : fail(502, 'upstream_error');
  } catch (e) {
    console.error('identify_failed', (e as Error).name);
    return fail(502, 'upstream_error');
  }
});
