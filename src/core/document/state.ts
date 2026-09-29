import type { PageId, SourceId } from './ids';
import type { Page } from '../pages/page';

/** Metadados de um PDF de origem. Os BYTES ficam no SourceStore, nunca no estado. */
export interface SourceRef {
  readonly id: SourceId;
  readonly name: string;
  readonly byteLength: number;
  readonly pageCount: number;
}

/**
 * Fonte de verdade do documento aberto. Imutável e independente de React/DOM/PDF.
 * O PDF original nunca é alterado: o estado só referencia páginas de origem e acumula alterações.
 */
export interface DocumentState {
  readonly name: string;
  readonly sources: Readonly<Record<SourceId, SourceRef>>;
  readonly pages: Readonly<Record<PageId, Page>>;
  /** Ordem "viva" do documento. Contém exatamente as chaves de `pages`. */
  readonly pageOrder: readonly PageId[];
  /** +1 a cada operação aplicada (execute/undo/redo). Útil para invalidar caches e memoização. */
  readonly revision: number;
}

export function createEmptyDocument(name: string): DocumentState {
  return { name, sources: {}, pages: {}, pageOrder: [], revision: 0 };
}
