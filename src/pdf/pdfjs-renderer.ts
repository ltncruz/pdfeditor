import type * as PdfJsNamespace from 'pdfjs-dist';
import type { SourceId } from '../core/document/ids';
import type { SourceStore } from '../core/ports';
import type { PdfJs, PdfJsOptions } from './pdfjs-reader';
import type { PageRenderer } from './renderer-port';

export function createPdfJsRenderer(pdfjs: PdfJs, sources: SourceStore, options: PdfJsOptions = {}): PageRenderer {
  const docs = new Map<SourceId, Promise<PdfJsNamespace.PDFDocumentProxy>>();
  const open = (id: SourceId): Promise<PdfJsNamespace.PDFDocumentProxy> => {
    let doc = docs.get(id);
    if (!doc) {
      doc = sources.get(id).then((bytes) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, ...options }).promise);
      docs.set(id, doc);
    }
    return doc;
  };

  return {
    async render({ sourceId, index, rotation, scale, canvas, signal }) {
      if (signal?.aborted) return;
      const doc = await open(sourceId);
      const page = await doc.getPage(index + 1);
      if (signal?.aborted) return;
      const viewport = page.getViewport({ scale, rotation });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const task = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      const onAbort = (): void => task.cancel();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await task.promise;
      } catch (error) {
        if ((error as { name?: string }).name === 'RenderingCancelledException') return;
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        page.cleanup();
      }
    },
    async dispose() {
      const all = [...docs.values()];
      docs.clear();
      await Promise.all(all.map(async (d) => (await d).destroy()));
    },
  };
}
