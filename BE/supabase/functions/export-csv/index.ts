// Darwin Core CSV 내보내기(팀 검토자 전용). 필터와 권한 확인을 서버에서 합니다.
// POST { kind: 'observations' | 'history', from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', statuses?: IdStatus[] }
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  DWC_COLUMNS,
  HISTORY_COLUMNS,
  historyToRow,
  observationToDwc,
  toCsv,
  type ExportRow,
  type HistoryRow,
} from '../_shared/dwc.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const PAGE = 1000;
const STATUSES = ['unidentified', 'family', 'reviewed', 'undeterminable'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('POST만 받아요', { status: 405, headers: cors });

  const authorization = req.headers.get('Authorization') ?? '';
  // 호출한 검토자의 권한으로 읽습니다(RLS가 그대로 적용됨).
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: auth } = await sb.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (auth.user?.app_metadata?.role !== 'reviewer') {
    return new Response('검토자만 내보낼 수 있어요', { status: 403, headers: cors });
  }

  const body = await req.json().catch(() => ({}));
  const kind = body.kind === 'history' ? 'history' : 'observations';
  const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(body.from) ? (body.from as string) : null;
  const to = isDate(body.to) ? (body.to as string) : null;
  const statuses = Array.isArray(body.statuses) ? body.statuses.filter((s: unknown) => STATUSES.includes(s as string)) : [];

  async function readAll<T>(view: string, statusColumn: string, order: string): Promise<T[]> {
    const rows: T[] = [];
    for (let start = 0; ; start += PAGE) {
      let q = sb.from(view).select('*').eq('hidden', false);
      if (from) q = q.gte('observed_date', from);
      if (to) q = q.lte('observed_date', to);
      if (statuses.length) q = q.in(statusColumn, statuses);
      const { data, error } = await q.order(order).range(start, start + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return rows;
    }
  }

  try {
    const csv =
      kind === 'observations'
        ? toCsv(DWC_COLUMNS, (await readAll<ExportRow>('observation_details', 'id_status', 'observed_at')).map(observationToDwc))
        : toCsv(HISTORY_COLUMNS, (await readAll<HistoryRow>('identification_history', 'current_status', 'created_at')).map(historyToRow));
    const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(csv, {
      headers: {
        ...cors,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="park-dex-${kind}-${stamp}.csv"`,
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500, headers: cors });
  }
});
