import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../components/Layout';
import { useContent } from '../content/ContentProvider';
import { taxonById } from '../content/helpers';

export function FieldPhotos() {
  const { content } = useContent();
  const [limit, setLimit] = useState(24);
  const photos = content.fieldPhotos ?? [];
  const identified = photos.filter((photo) => !!photo.taxonId).length;
  return (
    <main className="page">
      <PageHeader title="조사팀 현장 사진" backTo="/dex?view=collection" />
      <div className="page__body stack">
        <p>{content.park.name} · {photos.length}장</p>
        <p className="caption">종과 연결한 사진 {identified}장. 이름을 확인하기 어려운 사진과 현장 풍경도 함께 볼 수 있어요.</p>
        <ul className="field-gallery">
          {photos.slice(0, limit).map((photo) => {
            const taxon = taxonById(content, photo.taxonId);
            const label = taxon?.koreanName ?? (photo.scene ? '현장 풍경·안내' : '이름 확인 중');
            return (
              <li key={photo.id}>
                <a href={photo.src} target="_blank" rel="noreferrer"><img src={photo.src} alt={label} loading="lazy" decoding="async" /></a>
                {taxon ? <Link to={`/species/${taxon.id}`}>{label}</Link> : <span>{label}</span>}
                {photo.capturedOn && <time className="caption" dateTime={photo.capturedOn}>{photo.capturedOn}</time>}
              </li>
            );
          })}
        </ul>
        {photos.length > limit && <button className="btn btn--secondary btn--block" onClick={() => setLimit((n) => n + 24)}>사진 더 보기</button>}
      </div>
    </main>
  );
}
