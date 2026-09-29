import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SourceId } from '../core/document/ids';
import type { PdfWriter } from '../core/ports';
import type { PagePlan, TextOverlayPlan } from '../core/export/plan';

const LINE_HEIGHT = 1.2;

function drawTextBox(page: PDFPage, font: PDFFont, t: TextOverlayPlan): void {
  // Primeira linha: topo do retângulo menos o tamanho da fonte. Quebra por largura via maxWidth.
  page.drawText(t.text, {
    x: t.rect.x,
    y: t.rect.y + t.rect.h - t.fontSize,
    size: t.fontSize,
    lineHeight: t.fontSize * LINE_HEIGHT,
    maxWidth: t.rect.w,
    font,
    color: rgb(t.color.r, t.color.g, t.color.b),
  });
}

/**
 * Adaptador pdf-lib. Cria SEMPRE um novo documento (o original nunca é alterado, nem reescrito
 * incrementalmente) e copia página a página.
 * Limitação conhecida: copyPages uma página por vez duplica recursos compartilhados (fontes/imagens);
 * a otimização de estrutura é feita depois com qpdf (v0.9).
 */
export function createPdfLibWriter(): PdfWriter {
  return {
    async materialize(plan, sources) {
      const out = await PDFDocument.create();
      out.setProducer('Simply PDF');
      out.setCreator('Simply PDF');
      const font = await out.embedFont(StandardFonts.Helvetica);
      const loaded = new Map<SourceId, PDFDocument>();

      const addPage = async (p: PagePlan): Promise<PDFPage> => {
        if (!p.source) {
          const blank = out.addPage([p.crop.w, p.crop.h]);
          blank.setMediaBox(p.crop.x, p.crop.y, p.crop.w, p.crop.h);
          return blank;
        }
        let src = loaded.get(p.source.sourceId);
        if (!src) {
          src = await PDFDocument.load(await sources.get(p.source.sourceId));
          loaded.set(p.source.sourceId, src);
        }
        const [copied] = await out.copyPages(src, [p.source.index]);
        if (!copied) throw new Error(`Página ${p.source.index} não pôde ser copiada`);
        const page = out.addPage(copied);
        page.setCropBox(p.crop.x, p.crop.y, p.crop.w, p.crop.h);
        return page;
      };

      for (const p of plan.pages) {
        const page = await addPage(p);
        page.setRotation(degrees(p.rotation));
        for (const t of p.texts) drawTextBox(page, font, t);
      }
      return out.save();
    },
  };
}
