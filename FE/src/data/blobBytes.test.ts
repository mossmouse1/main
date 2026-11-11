import { describe, expect, it } from 'vitest';
import { isByteBacked, packBlobs, reviveBlobs, withBytes } from './blobBytes';

describe('blobBytes', () => {
  it('저장 직전에 바이트로 바꾸고, 읽을 때 같은 내용의 Blob으로 되살린다', async () => {
    const photo = await withBytes(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }));
    const row = { id: 'p', mime: 'image/jpeg', original: photo, display: null as Blob | null, list: [{ b: photo }] };
    const stored = packBlobs(row) as any;
    expect(stored.original.__blob).toBe(true);
    expect(stored.original.bytes.byteLength).toBe(4);
    expect(stored.list[0].b.type).toBe('image/jpeg');
    expect(stored.display).toBeNull();
    const back = reviveBlobs(stored);
    expect(back.original).toBeInstanceOf(Blob);
    expect(back.original!.size).toBe(4);
    expect(back.original!.type).toBe('image/jpeg');
    expect(isByteBacked(back.original!)).toBe(true);
    // 되살린 Blob을 다시 저장해도 바이트 형태가 유지된다(읽고 고쳐 쓰는 경로)
    expect((packBlobs(back) as any).original.__blob).toBe(true);
  });

  it('옛 방식으로 저장된 Blob은 그대로 읽히고 그대로 둔다', () => {
    const legacy = new Blob(['x'], { type: 'image/jpeg' });
    expect(reviveBlobs({ original: legacy }).original).toBe(legacy);
    expect(packBlobs({ original: legacy }).original).toBe(legacy);
    expect(isByteBacked(legacy)).toBe(false);
  });

  it('빈 사진은 거절한다', async () => {
    await expect(withBytes(new Blob([], { type: 'image/jpeg' }))).rejects.toThrow('empty_photo');
  });
});
