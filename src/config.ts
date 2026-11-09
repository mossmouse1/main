export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

/** Supabase 설정이 없으면 브라우저 안의 가짜 서버로 동작합니다. */
export const BACKEND_MODE: 'supabase' | 'local' = SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'local';

export const CONTENT_URL = '/content/v1.json';

/** 동의 문구가 확정되면 버전을 올립니다(PRD 12장 미결). */
export const CONSENT_VERSION = '2026-11-draft-1';

export const WALK_IDLE_MS = 30 * 60 * 1000;
export const WALK_MAX_MS = 3 * 60 * 60 * 1000;

export const MAX_PHOTOS = 3;
export const DISPLAY_LONG_EDGE = 1280;

export const RADIUS_CHOICES = [10, 25, 50] as const;
export const DEFAULT_RADIUS = 25;
/** ‘내 근처예요’ 반경 = 이 값 + GPS 정확도 */
export const NEAR_ME_BASE_RADIUS = 50;
