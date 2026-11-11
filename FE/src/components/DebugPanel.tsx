import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { BACKEND_MODE } from '../config';
import { db } from '../data/db';
import { debugGet, useDebugData } from '../lib/debug';

/** ?debug=1일 때만 App이 띄우는 진단 패널. 숫자와 상태값만 보여 줍니다(사진 내용·위치·키 없음). */
export function DebugPanel() {
  const data = useDebugData();
  const [rates, setRates] = useState({ upd: 0, moves: 0 });
  const prev = useRef({ upd: 0, moves: 0 });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      const upd = Number(debugGet('zoom.updates') ?? 0);
      const moves = Number(debugGet('zoom.moves') ?? 0);
      setRates({ upd: upd - prev.current.upd, moves: moves - prev.current.moves });
      prev.current = { upd, moves };
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // 업로드 상태: 사진 전송 대기열과 마지막 오류(80자까지)
  const upload = useLiveQuery(async () => {
    const photos = await db.photos.toArray();
    const waiting = photos.filter((p) => !p.uploaded);
    const items = await db.outbox.where('kind').equals('photo').toArray();
    const failing = items.filter((i) => i.attempts > 0).sort((a, b) => b.attempts - a.attempts)[0];
    const obsFail = (await db.outbox.where('kind').equals('observation').toArray()).find((i) => i.attempts > 0);
    return {
      waiting: waiting.length,
      sizes: waiting.map((p) => `${p.original?.size ?? '-'}/${p.display?.size ?? '-'}`).join(' ') || '-',
      queued: items.length,
      attempts: failing?.attempts ?? 0,
      lastError: (failing?.lastError ?? '').slice(0, 80),
      obsAttempts: obsFail?.attempts ?? 0,
      obsError: (obsFail?.lastError ?? '').slice(0, 80),
    };
  }, []);

  const rows: [string, unknown][] = [
    ['백엔드', BACKEND_MODE],
    ['사진 size', data['photo.size']],
    ['사진 type', data['photo.type']],
    ['저장 형태', data['photo.storage']],
    ['createImageBitmap', data['photo.bitmap']],
    ['img 오류', data['photo.imgError']],
    ['재시도 단계(0~3)', data['photo.stage']],
    ['핀치 대상 요소', data['zoom.target']],
    ['핀치 리스너 부착', data['zoom.attached']],
    ['줌 모드', data['zoom.mode']],
    ['caps.zoom', data['zoom.capsZoom']],
    ['줌 범위', data['zoom.hwRange']],
    ['현재 배율', data['zoom.value']],
    ['핀치 move 수', Number(data['zoom.moves'] ?? 0)],
    ['pointercancel 수', Number(data['zoom.cancels'] ?? 0)],
    ['초당 갱신/move', `${rates.upd}/${rates.moves}`],
    ['업로드 대기 사진', upload?.waiting],
    ['대기 사진 size 원본/화면', upload?.sizes],
    ['사진 대기열/실패횟수', `${upload?.queued}/${upload?.attempts}`],
    ['사진 마지막 오류', upload?.lastError],
    ['기록 실패횟수', upload?.obsAttempts],
    ['기록 마지막 오류', upload?.obsError],
  ];
  return (
    <aside className="debug-panel" aria-label="진단">
      <button onClick={() => setOpen(!open)}>진단 {open ? '▾' : '▸'}</button>
      {open && (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v === undefined || v === '' ? '–' : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
