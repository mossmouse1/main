import { useEffect, useLayoutEffect, useRef, useState } from 'react';


export interface TourStep {
  /** 밝게 비출 요소(지도 위 칸처럼 늦게 생기면 나타날 때까지 기다립니다) */
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

const PAD = 6;
const CARD_MAX_W = 340;

/**
 * 실제 화면 위에서 할 일을 하나씩 짚어 줍니다.
 * onDone(true)은 끝까지 본 경우, onDone(false)은 건너뛴 경우입니다.
 */
export function Tour({ steps, label, finishLabel = '시작하기', skipLabel = '건너뛰기', onDone }: {
  steps: TourStep[];
  label: string;
  /** 마지막 단계 버튼 글자(예: 위치 켜고 시작) */
  finishLabel?: string;
  skipLabel?: string;
  onDone: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [cardHeight, setCardHeight] = useState(0);
  const overlay = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const step = steps[index];

  // 단계가 바뀔 때마다 카드에 초점을 둡니다.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [index]);

  useLayoutEffect(() => {
    const rootEl = overlay.current;
    const cardEl = card.current;
    if (!rootEl || !cardEl) return;
    const el = step.target();
    const measure = () => {
      const root = rootEl.getBoundingClientRect();
      setFrame((old) => old.w === root.width && old.h === root.height ? old : { w: root.width, h: root.height });
      setCardHeight(cardEl.offsetHeight);
      if (!el) return setHole(null);
      const r = el.getBoundingClientRect();
      const box = { x: r.left - root.left - PAD, y: r.top - root.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
      setHole((old) => old?.x === box.x && old.y === box.y && old.w === box.w && old.h === box.h ? old : box);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rootEl);
    observer.observe(cardEl);
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const last = index === steps.length - 1;
  const cardW = Math.max(0, Math.min(CARD_MAX_W, frame.w - 32));
  // 대상이 화면 위쪽이면 카드는 아래에, 아래쪽이면 위에
  const below = !hole || hole.y + hole.h / 2 < frame.h / 2;
  const cx = hole ? hole.x + hole.w / 2 : frame.w / 2;
  const cardLeft = Math.min(Math.max(16, cx - cardW / 2), frame.w - 16 - cardW);
  const arrowLeft = Math.min(Math.max(26, cx - cardLeft), cardW - 26);
  const preferredTop = hole ? (below ? hole.y + hole.h + 16 : hole.y - cardHeight - 16) : (frame.h - cardHeight) / 2;
  const cardTop = Math.max(12, Math.min(preferredTop, frame.h - cardHeight - 16));

  return (
    <div ref={overlay} className={`tour${hole ? '' : ' tour--dim'}`} role="dialog" aria-modal="true" aria-label={label}>
      {hole && (
        <div
          className={`tour__hole${step.shape === 'circle' ? ' is-circle' : ''}`}
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
          aria-hidden="true"
        />
      )}
      <section key={index} ref={card} tabIndex={-1} aria-live="polite" className={`tour__card${below ? ' is-below' : ' is-above'}`} style={{ top: cardTop, left: cardLeft, width: cardW }}>
        {hole && cardTop === preferredTop && <span className="tour__arrow" style={{ left: arrowLeft }} aria-hidden="true" />}
        <div className="tour__top">
          <ol className="tour__steps" aria-label={`${steps.length}단계 중 ${index + 1}단계`}>
            {steps.map((s, i) => (
              <li key={s.title} className={i < index ? 'is-done' : i === index ? 'is-on' : undefined} />
            ))}
          </ol>
          <button className="tour__skip" onClick={() => onDone(false)}>
            {skipLabel}
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.note && <p className="tour__note">{step.note}</p>}
        <div className="tour__actions">
          {index > 0 && (
            <button className="btn btn--secondary" onClick={() => setIndex(index - 1)}>
              이전
            </button>
          )}
          <button className="btn btn--primary" onClick={() => (last ? onDone(true) : setIndex(index + 1))}>
            {last ? finishLabel : '다음'}
          </button>
        </div>
      </section>
    </div>
  );
}
