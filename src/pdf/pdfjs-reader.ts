import type * as PdfJsNamespace from 'pdfjs-dist';
import type { InspectedPage, PdfInspector, SourceReader } from '../core/ports';
import { normalizeRotation } from '../core/pages/geometry';

/** O módulo pdfjs é injetado (build padrão no navegador, build "legacy" no Node), então este arquivo não importa nada em runtime. */
export type PdfJs = typeof PdfJsNamespace;

type View = [number, number, number, number];

export interface PdfJsOptions {
  /** URL/caminho da pasta standard_fonts do pdfjs-dist (necessária para fontes padrão não embutidas, como Helvetica). */
  readonly standardFontDataUrl?: string;
}

async function withDocument<T>(
  pdfjs: PdfJs,
  options: PdfJsOptions,
  bytes: Uint8Array,
  fn: (doc: PdfJsNamespace.PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  // PDF.js TRANSFERE (destaca) o buffer recebido para o worker: sempre passar uma cópia.
  const doc = await pdfjs.getDocument({ ...options, data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    return await fn(doc);
  } finally {
    await doc.destroy();
  }
}

export function createPdfJsSourceReader(pdfjs: PdfJs, options: PdfJsOptions = {}): SourceReader {
  return {
    read: (bytes) =>
      withDocument(pdfjs, options, bytes, async (doc) => {
        const pages = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const [x0, y0, x1, y1] = page.view as View;
          pages.push({ crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rotation: normalizeRotation(page.rotate) });
          page.cleanup();
        }
        return { pages };
      }),
  };
}

/** Inspetor usado na verificação pós-exportação. Independente do writer (pdf-lib). */
export function createPdfJsInspector(pdfjs: PdfJs, options: PdfJsOptions = {}): PdfInspector {
  return {
    inspect: (bytes) =>
      withDocument(pdfjs, options, bytes, async (doc) => {
        const pages: InspectedPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const [x0, y0, x1, y1] = page.view as View;
          const content = await page.getTextContent();
          const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
          pages.push({ rotation: normalizeRotation(page.rotate), width: x1 - x0, height: y1 - y0, text });
          page.cleanup();
        }
        return { pages };
      }),
  };
}
