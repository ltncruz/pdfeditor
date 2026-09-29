import { useEffect, useRef, useState } from 'react';
import { displaySize, effectiveRotation, type Page } from '../../core';
import type { PageRenderer } from '../../pdf/renderer-port';

function overlayTransform(rotation: number, w: number, h: number): string {
  switch (rotation) {
    case 90: return `translate(${h}px, 0) rotate(90deg)`;
    case 180: return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270: return `translate(0, ${w}px) rotate(270deg)`;
    default: return 'none';
  }
}

/** Página do viewer: canvas + text layer selecionável do original + overlay com objetos do MODELO. */
export function PageCanvas({ page, scale, renderer }: { page: Page; scale: number; renderer: PageRenderer }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [renderState, setRenderState] = useState('pending');
  const rotation = effectiveRotation(page);
  const size = displaySize(page);
  const originKey = page.origin.kind === 'source' ? `${page.origin.sourceId}:${page.origin.index}` : 'blank';

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!canvas || !textLayer) return;
    setRenderState('rendering');
    if (page.origin.kind === 'blank') {
      canvas.width = Math.round(size.w * scale);
      canvas.height = Math.round(size.h * scale);
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      textLayer.replaceChildren();
      textLayer.style.width = `${canvas.width}px`;
      textLayer.style.height = `${canvas.height}px`;
      setRenderState('done');
      return;
    }
    const ctrl = new AbortController();
    renderer
      .render({ sourceId: page.origin.sourceId, index: page.origin.index, rotation, scale, canvas, textLayer, signal: ctrl.signal })
      .then(() => { if (!ctrl.signal.aborted) setRenderState('done'); })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted) return;
        console.error('Falha ao renderizar a página', page.id, error);
        setRenderState('error');
      });
    return () => ctrl.abort();
  }, [originKey, rotation, scale, renderer]);

  const w = page.crop.w * scale;
  const h = page.crop.h * scale;
  return (
    <div className="page-frame" style={{ width: size.w * scale, height: size.h * scale }}>
      <canvas ref={canvasRef} data-testid="page-canvas" data-render-state={renderState} data-page-id={page.id} data-rotation={String(rotation)} />
      <div ref={textLayerRef} className="textLayer" data-testid="text-layer" aria-label="Texto selecionável do PDF" />
      <div className="overlay" style={{ width: w, height: h, transform: overlayTransform(rotation, w, h) }}>
        {page.objects.map((o) => (
          <div
            key={o.id}
            className="text-object"
            data-testid="text-object"
            style={{ left: o.rect.x * scale, top: o.rect.y * scale, width: o.rect.w * scale, height: o.rect.h * scale, fontSize: o.fontSize * scale, color: `rgb(${Math.round(o.color.r * 255)},${Math.round(o.color.g * 255)},${Math.round(o.color.b * 255)})` }}
          >
            {o.text}
          </div>
        ))}
      </div>
    </div>
  );
}
