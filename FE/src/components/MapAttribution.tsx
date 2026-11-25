import { useEffect, useId, useState } from 'react';
import { Icon } from './Icon';

let attributionShown = false;

export function MapAttribution({ text }: { text: string }) {
  const id = useId();
  const [preview, setPreview] = useState(() => !attributionShown);
  const [expanded, setExpanded] = useState(false);
  const open = preview || expanded;

  useEffect(() => {
    attributionShown = true;
    if (!preview) return;
    const timer = window.setTimeout(() => setPreview(false), 5000);
    return () => window.clearTimeout(timer);
  }, [preview]);

  return (
    <div className="map-attribution">
      <button type="button" className="hud-tool" aria-label="지도 정보" aria-expanded={open} aria-controls={id} onClick={() => {
        setPreview(false);
        setExpanded(!open);
      }}>
        <Icon name="info" size={19} />
      </button>
      <div id={id} className="map-attribution__panel" hidden={!open}>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onFocus={() => {
          setPreview(false);
          setExpanded(true);
        }}>{text}</a>
      </div>
    </div>
  );
}
