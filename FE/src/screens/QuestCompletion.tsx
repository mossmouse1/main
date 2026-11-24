import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { useContent } from '../content/ContentProvider';
import { db } from '../data/db';
import { useDex, useSeason } from '../hooks';
import type { DexCompletion } from '../lib/dex';
import { kstDate } from '../lib/time';

async function withQuestPhoto(photoIds: string[], draw: (image: HTMLImageElement) => void): Promise<void> {
  const photos = await db.photos.bulkGet(photoIds);
  for (const blob of photos.flatMap((photo) => [photo?.display, photo?.original])) {
    if (!blob?.size) continue;
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      draw(image);
      return;
    } catch {
      // 다음 사진이나 원본으로 다시 시도합니다.
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new Error('photo unavailable');
}

async function makeCompletionImage(parkName: string, season: string, completion: DexCompletion): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const columns = 2;
  const tile = 428;
  const gap = 28;
  const margin = 52;
  const rows = Math.ceil(completion.entries.length / columns);
  canvas.width = margin * 2 + tile * columns + gap;
  canvas.height = 300 + rows * 316 + 44;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  ctx.fillStyle = '#f5f4e6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#234537';
  ctx.fillRect(0, 0, canvas.width, 244);
  ctx.fillStyle = '#e1f2ca';
  ctx.font = '600 29px system-ui, sans-serif';
  ctx.fillText(parkName, margin, 63);
  ctx.fillStyle = '#fff';
  ctx.font = '800 58px system-ui, sans-serif';
  ctx.fillText(`${season} 퀘스트 완료`, margin, 137);
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.fillText(`${completion.entries.length}종 수집 · ${kstDate(completion.completedAt)}`, margin, 197);

  for (const [index, entry] of completion.entries.entries()) {
    await withQuestPhoto(entry.photoIds, (image) => {
      const x = margin + (index % columns) * (tile + gap);
      const y = 276 + Math.floor(index / columns) * 316;
      const h = 246;
      const scale = Math.max(tile / image.naturalWidth, h / image.naturalHeight);
      const cropW = tile / scale;
      const cropH = h / scale;
      ctx.drawImage(image, (image.naturalWidth - cropW) / 2, (image.naturalHeight - cropH) / 2, cropW, cropH, x, y, tile, h);
      ctx.fillStyle = '#234537';
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(entry.taxon.koreanName, x, y + 283, tile);
    });
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('image unavailable')), 'image/png'));
}

export function QuestCompletion() {
  const dex = useDex();
  const season = useSeason();
  const { content } = useContent();
  const completion = dex?.completion;
  const key = completion ? JSON.stringify([season.id, completion.completedAt, completion.entries.map(({ photoIds }) => photoIds)]) : '';
  const [image, setImage] = useState<{ key: string; url: string | null }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!completion) return;
    let active = true;
    let url: string | null = null;
    void makeCompletionImage(content.park.name, season.season, completion).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setImage({ key, url });
    }, () => { if (active) setImage({ key, url: null }); });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [key, content.park.name, season.season, attempt]);

  return (
    <main className="page">
      <PageHeader title="퀘스트 완료 사진" backTo="/dex" />
      <div className="page__body stack">
        {!dex ? <p role="status">도감 진행 상황을 확인하고 있어요.</p> : !completion ? (
          <>
            <p>공원에서 도감의 {dex.total}종을 찍으면 완료 사진이 열려요.</p>
            <Link to="/dex" className="btn btn--primary btn--block">도감 돌아가기</Link>
          </>
        ) : (
          <>
            <section className="quest-finish card">
              <span className="quest-finish__medal" aria-hidden="true"><Icon name="check" size={32} /></span>
              <div>
                <p className="caption">{dex.filled}/{dex.total}종 · {kstDate(completion.completedAt)}</p>
                <h2>{season.season} 도감을 완성했어요!</h2>
              </div>
              <p>완료 사진을 현장 운영진에게 보여 주고 리워드를 받으세요.</p>
            </section>
            {image?.key !== key ? <p role="status">도감 사진으로 완료 이미지를 만들고 있어요.</p> : image.url ? (
              <>
                <a href={image.url} download={`동탄호수공원-${season.id}-퀘스트-완료.png`} className="btn btn--primary btn--block">
                  <Icon name="camera" size={20} /> 완료 사진 저장
                </a>
                <img className="quest-completion-image" src={image.url} alt={`${season.season} 퀘스트 완료 · ${dex.total}종 · ${kstDate(completion.completedAt)}`} />
              </>
            ) : (
              <>
                <p role="alert">기기의 관찰 사진을 불러오지 못했어요.</p>
                <button className="btn btn--secondary btn--block" onClick={() => { setImage(undefined); setAttempt((n) => n + 1); }}>
                  완료 사진 다시 만들기
                </button>
              </>
            )}
            <Link to="/" className="btn btn--secondary btn--block">전체 지도로 돌아가기</Link>
          </>
        )}
      </div>
    </main>
  );
}
