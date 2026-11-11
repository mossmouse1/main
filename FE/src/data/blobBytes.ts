/**
 * iOS WebKit은 IndexedDB에 Blob 객체로 저장한 사진을 나중에 읽을 때 비거나 못 읽는 일이 있어,
 * 사진은 ArrayBuffer(바이트)+type으로 저장하고 읽을 때 Blob으로 되살립니다.
 * - withBytes: 사진을 바이트로 읽어 메모리 Blob으로 만들고, 저장할 때 바이트로 바꿀 수 있게 기억합니다.
 * - packBlobs: 저장 직전에 기억된 Blob을 바이트 형태로 바꿉니다(기억에 없는 옛 Blob은 그대로).
 * - reviveBlobs: 읽을 때(Dexie reading 훅) 바이트 형태를 Blob으로 되돌립니다. 옛 Blob 데이터도 그대로 읽힙니다.
 */
export interface StoredBlob {
  __blob: true;
  bytes: ArrayBuffer;
  type: string;
}

const known = new WeakMap<Blob, ArrayBuffer>();

export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** 비어 있으면 던집니다(빈 사진을 정상으로 저장·전송하지 않게). */
export async function withBytes(blob: Blob): Promise<Blob> {
  const bytes = await readBytes(blob);
  if (bytes.byteLength === 0) throw new Error('empty_photo');
  const fresh = new Blob([bytes], { type: blob.type });
  known.set(fresh, bytes);
  return fresh;
}

/** 진단용: 이 Blob이 바이트로 저장·복원된 것인지(false면 옛 Blob 저장 방식) */
export const isByteBacked = (blob: Blob): boolean => known.has(blob);

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

export function packBlobs<T>(v: T): T {
  if (v instanceof Blob) {
    const bytes = known.get(v);
    return (bytes ? ({ __blob: true, bytes, type: v.type } satisfies StoredBlob) : v) as T;
  }
  if (Array.isArray(v)) return v.map(packBlobs) as T;
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, packBlobs(x)])) as T;
  return v;
}

export function reviveBlobs<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reviveBlobs) as T;
  if (isPlain(v)) {
    if (v.__blob === true && v.bytes instanceof ArrayBuffer) {
      const blob = new Blob([v.bytes], { type: String(v.type ?? '') });
      known.set(blob, v.bytes);
      return blob as T;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reviveBlobs(x)])) as T;
  }
  return v;
}
