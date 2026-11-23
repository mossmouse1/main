import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

let justSavedId: string | undefined;

export function markRecordReward(id: string) {
  justSavedId = id;
}

export function useRecordReward(savedId: string | undefined): boolean {
  const [rewardedId, setRewardedId] = useState<string>();
  useEffect(() => {
    if (!savedId || justSavedId !== savedId) return;
    // Give the result photo and the initial sync status time to paint before the flip.
    const timer = setTimeout(() => {
      if (justSavedId !== savedId) return;
      justSavedId = undefined;
      setRewardedId(savedId);
    }, 360);
    return () => clearTimeout(timer);
  }, [savedId]);
  return !!savedId && savedId === rewardedId;
}

const COLORS = ['#fff3a0', '#e2ae5d', '#9bd264', '#58a977', '#baf0db', '#fffaf1'];

function RewardParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (!canvas || !ctx || motion.matches) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    const pieces = Array.from({ length: 36 }, (_, i) => ({
      leaf: i % 3 === 0,
      color: COLORS[i % COLORS.length],
      size: 3 + Math.random() * 4,
      speedX: (Math.random() - 0.5) * 435,
      speedY: -(40 + Math.random() * 225),
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 13,
    }));
    let start = 0;
    let frame: number;
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.resetTransform();
      ctx.clearRect(0, 0, width, height);
      if (t >= 1.05 || motion.matches) return;

      ctx.globalAlpha = Math.min(1, (1.05 - t) * 2.6);
      for (const piece of pieces) {
        const x = width * 0.675 + piece.speedX * t;
        const y = height * 0.56 + piece.speedY * t + 270 * t * t;
        const angle = piece.angle + t * piece.spin;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        ctx.setTransform(cos, sin, -sin, cos, x, y);
        ctx.fillStyle = piece.color;
        if (piece.leaf) {
          ctx.beginPath();
          ctx.ellipse(0, 0, piece.size * 1.25, piece.size * 0.48, 0, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.7);
      }
      frame = requestAnimationFrame(draw);
    };
    const burst = setTimeout(() => {
      start = performance.now();
      frame = requestAnimationFrame(draw);
    }, 550);
    return () => {
      clearTimeout(burst);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <canvas ref={canvasRef} className="record-reward__particles" aria-hidden="true" />;
}

export function RecordReward({ children, active, stamp = '발견', compact = false }: { children: ReactNode; active: boolean; stamp?: string; compact?: boolean }) {
  return (
    <div className={`record-reward${compact ? ' record-reward--compact' : ''}${active ? ' is-active' : ''}`}>
      <div className="record-reward__card">
        <div className="record-reward__front">{children}</div>
        {active && <div className="record-reward__back" aria-hidden="true"><Icon name="book" size={compact ? 28 : 54} /></div>}
      </div>
      {active && <span className="record-reward__stamp" aria-hidden="true"><Icon name="check" size={compact ? 16 : 23} />{stamp}</span>}
      {active && <RewardParticles />}
    </div>
  );
}
