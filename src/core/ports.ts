/**
 * Portas (interfaces) que o core exige do mundo externo. Adaptadores vivem em src/pdf e src/services.
 * O core NUNCA importa PDF.js, pdf-lib, qpdf, React ou DOM.
 */
import type { SourceId } from './document/ids';
import type { Rect, Rotation } from './pages/page';
import type { ExportPlan } from './export/plan';

/** Armazena os bytes dos PDFs de origem (memória, OPFS, disco no desktop...). */
export interface SourceStore {
  has(id: SourceId): Promise<boolean>;
  /** Lança se a origem não existir. O chamador NÃO deve mutar o resultado. */
  get(id: SourceId): Promise<Uint8Array>;
  put(id: SourceId, bytes: Uint8Array): Promise<void>;
}

export interface SourcePageInfo {
  readonly crop: Rect;
  readonly rotation: Rotation;
}
export interface SourceInfo {
  readonly pages: readonly SourcePageInfo[];
}
/** Lê a estrutura básica de um PDF de origem (implementado com PDF.js). */
export interface SourceReader {
  read(bytes: Uint8Array): Promise<SourceInfo>;
}

/** Materializa um ExportPlan em bytes de PDF (implementado com pdf-lib). */
export interface PdfWriter {
  materialize(plan: ExportPlan, sources: SourceStore): Promise<Uint8Array>;
}

export interface InspectedPage {
  /** /Rotate da página resultante. */
  readonly rotation: Rotation;
  /** Tamanho da CropBox efetiva, sem rotação. */
  readonly width: number;
  readonly height: number;
  /** Texto extraído da página (uma string, itens separados por espaço). */
  readonly text: string;
}
export interface InspectedDocument {
  readonly pages: readonly InspectedPage[];
}
/** Parser INDEPENDENTE do writer, usado para verificar o PDF exportado (implementado com PDF.js). */
export interface PdfInspector {
  inspect(bytes: Uint8Array): Promise<InspectedDocument>;
}
