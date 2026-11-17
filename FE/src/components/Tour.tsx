import { useEffect, useRef, useState } from 'react';


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
 * 코치마크: 처음 한 번, 실제 화면 위에서 하나씩 짚어 줍니다(대상 둘레만 밝고 나머지는 어둡게).
 * 처음 안내 슬라이드 대신 씁니다. onDone(true)은 끝까지 본 경우, onDone(false)은 건너뛴 경우입니다.
 */
export function Tour({ steps, label, finishLabel = '시작하기', onDone }: {
  steps: TourStep[];
  label: string;
  /** 마지막 단계 버튼 글자(예: 위치 켜고 시작) */
  finishLabel?: string;
  onDone: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const overlay = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const step = steps[index];

  // 단계가 바뀔 때마다 카드에 초점을 둡니다.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [index]);

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const last = index === steps.length - 1;
  const cardW = Math.min(CARD_MAX_W, frame.w - 32);
  // 대상이 화면 위쪽이면 카드는 아래에, 아래쪽이면 위에
  const below = !hole || hole.y + hole.h / 2 < frame.h / 2;
  const cx = hole ? hole.x + hole.w / 2 : frame.w / 2;
  const cardLeft = Math.min(Math.max(16, cx - cardW / 2), frame.w - 16 - cardW);
  const arrowLeft = Math.min(Math.max(26, cx - cardLeft), cardW - 26);
  const cardPos = hole ? (below ? { top: hole.y + hole.h + 16 } : { bottom: frame.h - hole.y + 16 }) : { top: frame.h / 3 };

  return (
    <div ref={overlay} className={`tour${hole ? '' : ' tour--dim'}`} role="dialog" aria-modal="true" aria-label={label}>
      {hole && (
        <div
          className={`tour__hole${step.shape === 'circle' ? ' is-circle' : ''}`}
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
          aria-hidden="true"
        />
      )}
      <section key={index} ref={card} tabIndex={-1} aria-live="polite" className={`tour__card${below ? ' is-below' : ' is-above'}`} style={{ ...cardPos, left: cardLeft, width: cardW }}>
        {hole && <span className="tour__arrow" style={{ left: arrowLeft }} aria-hidden="true" />}
        <div className="tour__top">
          <ol className="tour__steps" aria-label={`${steps.length}단계 중 ${index + 1}단계`}>
            {steps.map((s, i) => (
              <li key={s.title} className={i < index ? 'is-done' : i === index ? 'is-on' : undefined} />
            ))}
          </ol>
          <button className="tour__skip" onClick={() => onDone(false)}>
            건너뛰기
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
