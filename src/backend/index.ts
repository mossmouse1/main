import { BACKEND_MODE } from '../config';
import type { AdminBackend, FamilyBackend } from './types';

// supabase-js는 Supabase 모드일 때만 받습니다(첫 화면 JS를 가볍게).
let family: Promise<FamilyBackend> | null = null;
let admin: Promise<AdminBackend> | null = null;

export function getFamilyBackend(): Promise<FamilyBackend> {
  family ??=
    BACKEND_MODE === 'supabase'
      ? import('./supabase').then((m) => m.supabaseFamily)
      : import('./local').then((m) => m.localFamily);
  return family;
}

export function getAdminBackend(): Promise<AdminBackend> {
  admin ??=
    BACKEND_MODE === 'supabase'
      ? import('./supabase').then((m) => m.supabaseAdmin)
      : import('./local').then((m) => m.localAdmin);
  return admin;
}
