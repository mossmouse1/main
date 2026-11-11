import { DISPLAY_LONG_EDGE, IDENTIFY_LONG_EDGE } from '../config';

export function isHeic(file: Blob & { name?: string }): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '');
}

type Decoded = ImageBitmap | HTMLImageElement;

async function decode(blob: Blob): Promise<Decoded> {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * 화면용 사본(긴 변 1280px JPEG). 원본은 손대지 않습니다.
 * 브라우저가 HEIC를 못 읽으면 그때만 heic2any를 받아 변환합니다.
 */
export function makeDisplayCopy(file: File): Promise<Blob | null> {
  return resizeJpeg(file, DISPLAY_LONG_EDGE, 0.85);
}

/** 종 추천용 사본(긴 변 768px 이하 JPEG, 품질 0.7). 전송량과 비용을 줄이려고 작게 보냅니다. */
export function makeIdentifyCopy(file: Blob): Promise<Blob | null> {
  return resizeJpeg(file as File, IDENTIFY_LONG_EDGE, 0.7);
}

async function resizeJpeg(file: File, longEdge: number, quality: number): Promise<Blob | null> {
  let source: Decoded;
  try {
    source = await decode(file);
  } catch {
    if (!isHeic(file)) return null;
    try {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      source = await decode(Array.isArray(out) ? out[0] : out);
    } catch {
      return null;
    }
  }
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, longEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/**
 * EXIF 모듈을 미리 받아 둡니다. 서비스 워커가 없는 웹뷰에서 오프라인 첫 기록에도 촬영 시각을 읽기 위해서입니다.
 */
export function preloadPhotoTools(): void {
  void import('exifr/dist/lite.esm.mjs').catch(() => {});
}

/**
 * 사진의 촬영 시각(EXIF DateTimeOriginal). 시간대 정보가 없으면 기기 시간대로 봅니다.
 * 미래 시각처럼 믿기 어려운 값은 버립니다.
 */
export async function readExifTime(file: File): Promise<string | null> {
  try {
    const { default: exifr } = await import('exifr/dist/lite.esm.mjs');
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'OffsetTimeOriginal'], reviveValues: false });
    const raw: unknown = tags?.DateTimeOriginal;
    if (typeof raw !== 'string') return null;
    const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const [, y, mo, d, hh, mi, ss] = m;
    const offset: unknown = tags?.OffsetTimeOriginal;
    const date =
      typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset)
        ? new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}${offset}`)
        : new Date(+y, +mo - 1, +d, +hh, +mi, +ss);
    if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}
