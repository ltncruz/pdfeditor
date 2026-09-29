import type { PdfInspector } from '../ports';
import type { ExportPlan } from './plan';

export interface VerifyIssue {
  readonly code: 'PAGE_COUNT' | 'PAGE_ROTATION' | 'PAGE_SIZE' | 'TEXT_MISSING';
  readonly message: string;
  readonly pageIndex?: number;
}

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, '');
const SIZE_TOLERANCE = 0.01;

/** Reabre o PDF gerado com um parser independente do writer e confere o que o plano prometeu. */
export async function verifyExport(bytes: Uint8Array, plan: ExportPlan, inspector: PdfInspector): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = [];
  const doc = await inspector.inspect(bytes);
  if (doc.pages.length !== plan.pages.length) {
    issues.push({ code: 'PAGE_COUNT', message: `Esperava ${plan.pages.length} páginas, o PDF tem ${doc.pages.length}` });
    return issues;
  }
  plan.pages.forEach((expected, i) => {
    const actual = doc.pages[i];
    if (!actual) return;
    if (actual.rotation !== expected.rotation) {
      issues.push({ code: 'PAGE_ROTATION', pageIndex: i, message: `Página ${i + 1}: rotação ${actual.rotation}, esperada ${expected.rotation}` });
    }
    if (Math.abs(actual.width - expected.crop.w) > SIZE_TOLERANCE || Math.abs(actual.height - expected.crop.h) > SIZE_TOLERANCE) {
      issues.push({ code: 'PAGE_SIZE', pageIndex: i, message: `Página ${i + 1}: tamanho ${actual.width}x${actual.height}, esperado ${expected.crop.w}x${expected.crop.h}` });
    }
    const haystack = squash(actual.text);
    for (const t of expected.texts) {
      if (!haystack.includes(squash(t.text))) {
        issues.push({ code: 'TEXT_MISSING', pageIndex: i, message: `Página ${i + 1}: texto adicionado não encontrado no PDF exportado` });
      }
    }
  });
  return issues;
}
