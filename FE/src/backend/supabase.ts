/**
 * Supabase 모드. 테이블·함수·권한은 supabase/migrations에 있습니다.
 * 가족과 팀 검토자는 세션을 따로 둡니다(같은 브라우저에서 /admin을 열어도 가족 익명 계정이 바뀌지 않게).
 */
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import type { HistoryRow } from '@shared/dwc';
import { isAlreadyUploaded } from '../lib/storageErrors';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import type { MyStatus } from '../data/types';
import { IdentifyError, type AdminBackend, type AdminFilters, type AdminRow, type FamilyBackend, type IdentifyErrorCode, type IdentifyResult, type ReviewChanges } from './types';

const BUCKET = 'photos';
const SIGNED_URL_SECONDS = 600; // 10분

const family = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'parkdex-family-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const team = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'parkdex-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function familyUid(): Promise<string> {
  const { data } = await family.auth.getSession();
  if (!data.session) throw new Error('익명 계정이 아직 없어요');
  return data.session.user.id;
}

/** 같은 사진을 두 번 올려도 한 번만 저장되게(이미 있으면 성공으로 봄) */
async function uploadOnce(path: string, blob: Blob, contentType: string): Promise<void> {
  const signed = await family.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) {
    if (isAlreadyUploaded(signed.error as never)) return;
    throw new Error(signed.error.message);
  }
  const up = await family.storage.from(BUCKET).uploadToSignedUrl(path, signed.data.token, blob, { contentType });
  if (up.error && !isAlreadyUploaded(up.error as never)) throw new Error(up.error.message);
}

export const supabaseFamily: FamilyBackend = {
  mode: 'supabase',

  async ensureAuth() {
    const { data } = await family.auth.getSession();
    if (data.session) return data.session.user.id;
    const res = await family.auth.signInAnonymously();
    if (res.error || !res.data.user) throw new Error(res.error?.message ?? '익명 계정을 만들지 못했어요');
    return res.data.user.id;
  },

  async registerConsent({ version, consentedAt, adults, children }) {
    check(await family.rpc('register_consent', { p_version: version, p_consented_at: consentedAt, p_adults: adults, p_children: children }));
  },

  async startWalk(w) {
    check(await family.rpc('start_walk', { p_id: w.id, p_started_at: w.startedAt, p_adults: w.adults, p_children: w.children }));
  },

  async endWalk(w) {
    check(await family.rpc('end_walk', { p_id: w.id, p_ended_at: w.endedAt, p_ended_by: w.endedBy }));
  },

  async upsertObservation(o) {
    check(await family.rpc('upsert_observation', { p: o }));
  },

  async uploadPhoto(p) {
    const uid = await familyUid();
    const ext = p.mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    const originalPath = `${uid}/${p.observationId}/${p.photoId}-original.${ext}`;
    // 비어 있는 사진은 올리지도 등록하지도 않습니다(던지면 대기열에 남아 다시 시도하고, 사진 데이터도 지워지지 않습니다).
    if (p.original && p.original.size === 0) throw new Error('photo_empty');
    const display = p.display && p.display.size > 0 ? p.display : null;
    if (!p.original && !display) throw new Error('photo_missing');
    const displayPath = display ? `${uid}/${p.observationId}/${p.photoId}-display.jpg` : null;
    // 원본이 이미 지워졌다면(앞서 올리고 등록만 실패한 경우) 올리기는 건너뜁니다.
    if (p.original) await uploadOnce(originalPath, p.original, p.mime);
    if (display && displayPath) await uploadOnce(displayPath, display, 'image/jpeg');
    // 위 올리기가 모두 성공한 뒤에만 등록합니다.
    check(
      await family.rpc('register_photo', {
        p_id: p.photoId,
        p_observation_id: p.observationId,
        p_original_path: originalPath,
        p_display_path: displayPath,
        p_mime: p.mime,
        p_exif_time: p.exifTime,
        p_media_source: p.mediaSource,
      }),
    );
  },

  async fetchMyStatuses() {
    const uid = await familyUid();
    const rows = check(
      await family
        .from('observations')
        .select('id, walk_id, observed_at, family_taxon_id, taxon_id, free_text_name, id_status, hidden, zone_id, subject_lat, subject_lng, radius_m')
        .eq('household_id', uid),
    );
    return (rows ?? []).map(
      (r): MyStatus => ({
        id: r.id,
        walkId: r.walk_id,
        observedAt: r.observed_at,
        familyTaxonId: r.family_taxon_id,
        taxonId: r.taxon_id,
        freeTextName: r.free_text_name,
        idStatus: r.id_status,
        hidden: r.hidden,
        zoneId: r.zone_id,
        subjectLat: r.subject_lat,
        subjectLng: r.subject_lng,
        radiusM: r.radius_m,
      }),
    );
  },

  async sendEvents(events) {
    check(await family.from('usage_events').insert(events.map((e) => ({ name: e.name, at: e.at, props: e.props }))));
  },

  async requestDeletion(reason) {
    check(await family.rpc('request_deletion', { p_reason: reason }));
  },

  async linkEmail(email) {
    // 익명 계정에 이메일을 붙입니다. 메일의 링크를 누르면 확정됩니다.
    const res = await family.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/settings` });
    if (res.error) throw new Error(res.error.message);
  },

  async linkedEmail() {
    const { data } = await family.auth.getUser();
    return data.user?.email ?? null;
  },

  async identifySpecies(image) {
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new IdentifyError('failed'));
      r.readAsDataURL(image);
    });
    const { data, error } = await family.functions.invoke('identify-species', { body: { imageBase64, mime: 'image/jpeg' } });
    if (!error) return data as IdentifyResult;
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      const known: IdentifyErrorCode[] = ['rate_limited', 'daily_limit', 'global_limit', 'consent_required', 'too_large'];
      throw new IdentifyError(known.find((c) => c === body?.error) ?? 'failed');
    }
    throw new IdentifyError('network');
  },
};

// ---------------- 팀 검토 ----------------

const detailsQuery = () => team.from('observation_details').select('*');

function filteredDetails(f: AdminFilters): ReturnType<typeof detailsQuery> {
  let q = detailsQuery();
  if (f.from) q = q.gte('observed_date', f.from);
  if (f.to) q = q.lte('observed_date', f.to);
  if (f.statuses?.length) q = q.in('id_status', f.statuses);
  if (!f.includeHidden) q = q.eq('hidden', false);
  return q;
}

async function teamToken(): Promise<string> {
  const { data } = await team.auth.getSession();
  if (!data.session) throw new Error('로그인이 필요해요');
  return data.session.access_token;
}

export const supabaseAdmin: AdminBackend = {
  mode: 'supabase',

  async currentUser() {
    const { data } = await team.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    if (user.app_metadata?.role !== 'reviewer') {
      await team.auth.signOut();
      throw new Error('검토자 권한이 없는 계정이에요');
    }
    return { email: user.email ?? '검토자' };
  },

  async signIn(email, password) {
    const res = await team.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(res.error.message);
  },

  async signOut() {
    await team.auth.signOut();
  },

  async listObservations(filters) {
    const rows: AdminRow[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(await filteredDetails(filters).order('observed_at', { ascending: false }).range(from, from + 999));
      rows.push(...((page ?? []) as AdminRow[]));
      if (!page || page.length < 1000) return rows;
    }
  },

  async listPhotos(observationId) {
    const photos = check(await team.from('photos').select('id, original_path, display_path, hidden, media_source, exif_time').eq('observation_id', observationId)) ?? [];
    return Promise.all(
      photos.map(async (p) => {
        const signed = await team.storage.from(BUCKET).createSignedUrl(p.display_path ?? p.original_path, SIGNED_URL_SECONDS);
        return { id: p.id, url: signed.data?.signedUrl ?? null, hidden: p.hidden, mediaSource: p.media_source, exifTime: p.exif_time };
      }),
    );
  },

  async setPhotoHidden(photoId, hidden) {
    check(await team.rpc('review_set_photo_hidden', { p_photo_id: photoId, p_hidden: hidden }));
  },

  async history(observationId) {
    return (check(await team.from('identification_history').select('*').eq('observation_id', observationId).order('created_at')) ?? []) as HistoryRow[];
  },

  async review(id, c: ReviewChanges) {
    const changes: Record<string, unknown> = {};
    if (c.taxonId !== undefined) changes.taxon_id = c.taxonId;
    if (c.status !== undefined) changes.status = c.status;
    if (c.reason !== undefined) changes.reason = c.reason;
    if (c.hidden !== undefined) changes.hidden = c.hidden;
    if (c.hiddenReason !== undefined) changes.hidden_reason = c.hiddenReason;
    if (c.establishmentMeans !== undefined) changes.establishment_means = c.establishmentMeans;
    check(await team.rpc('review_observation', { p_id: id, p_changes: changes }));
  },

  async duplicateCandidates(id) {
    return (check(await team.rpc('duplicate_candidates', { p_id: id })) ?? []) as AdminRow[];
  },

  async groupDuplicates(ids) {
    return check(await team.rpc('group_duplicates', { p_ids: ids })) as string;
  },

  async ungroup(id) {
    check(await team.rpc('review_observation', { p_id: id, p_changes: { duplicate_group_id: null } }));
  },

  async exportCsv(kind, filters) {
    // BOM이 지워지지 않게 바이트 그대로 받습니다.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/export-csv`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await teamToken()}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...filters }),
    });
    if (!res.ok) throw new Error(`내보내기 실패 (${res.status}) ${await res.text()}`);
    return res.blob();
  },

  async listDeletionRequests() {
    const rows = check(await team.from('deletion_requests').select('id, requested_at, reason, status, households(anon_no)').order('requested_at', { ascending: false })) ?? [];
    return rows.map((r) => {
      const h = r.households as unknown as { anon_no: number } | null;
      return { id: r.id, householdNo: h?.anon_no ?? 0, requestedAt: r.requested_at, reason: r.reason, status: r.status };
    });
  },
};
