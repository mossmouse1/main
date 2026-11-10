import { useEffect, useRef, useState } from 'react';

export interface TourStep {
  /** 밝게 비출 요소(지도 핀처럼 늦게 생기면 나타날 때까지 기다립니다) */
  target: () => Element | null;
  title: string;
  body: string;
  note?: string;
  shape?: 'circle' | 'round';
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 8;
const CARD_MAX_W = 360;

/** 처음 한 번 보여 주는 화면 안내(탐험 가이드 1/3). 대상 둘레만 밝게 두고 나머지는 어둡게 덮습니다. */
export function Tour({ steps, label, onDone }: { steps: TourStep[]; label: string; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const overlay = useRef<HTMLDivElement>(null);
  const step = steps[index];

  // 지도가 움직이는 동안에도 따라가도록 자주 잽니다.
  useEffect(() => {
    const measure = () => {
      const root = overlay.current?.getBoundingClientRect();
      const el = step.target();
      if (!root) return;
      setFrame({ w: root.width, h: root.height });
      if (!el) return setHole(null);
      const r = el.getBoundingClientRect();
      setHole({ x: r.left - root.left - PAD, y: r.top - root.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
    };
    measure();
    const id = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const last = index === steps.length - 1;
  const cardW = Math.min(CARD_MAX_W, frame.w - 32);
  const below = !hole || hole.y + hole.h / 2 < frame.h / 2;
  const cx = hole ? hole.x + hole.w / 2 : frame.w / 2;
  const cardLeft = Math.min(Math.max(16, cx - cardW / 2), frame.w - 16 - cardW);
  const arrowLeft = Math.min(Math.max(24, cx - cardLeft), cardW - 24);
  const cardPos = hole
    ? below
      ? { top: hole.y + hole.h + 14 }
      : { bottom: frame.h - hole.y + 14 }
    : { top: frame.h / 3 };

  return (
    <div ref={overlay} className={`tour${hole ? '' : ' tour--dim'}`} role="dialog" aria-modal="true" aria-label={label}>
      {hole && (
        <div
          className={`tour__hole${step.shape === 'circle' ? ' is-circle' : ''}`}
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
          aria-hidden="true"
        />
      )}
      <section className={`tour__card${below ? ' is-below' : ' is-above'}`} style={{ ...cardPos, left: cardLeft, width: cardW }}>
        {hole && <span className="tour__arrow" style={{ left: arrowLeft }} aria-hidden="true" />}
        <div className="tour__top">
          <span className="tour__badge">
            {label} {index + 1} / {steps.length}
          </span>
          <ol className="tour__dots" aria-hidden="true">
            {steps.map((s, i) => (
              <li key={s.title} className={i === index ? 'is-on' : undefined} />
            ))}
          </ol>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.note && <p className="tour__note">{step.note}</p>}
        <div className="tour__actions">
          <button className="btn btn--text" onClick={onDone}>
            건너뛰기
          </button>
          <button className="btn btn--primary" onClick={() => (last ? onDone() : setIndex(index + 1))} autoFocus>
            {last ? '시작하기' : '다음'}
          </button>
        </div>
      </section>
    </div>
  );
}
