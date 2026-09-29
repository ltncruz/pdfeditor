import type { DocumentState } from './state';
import type { IdFactory } from './ids';
import type { Page } from '../pages/page';
import type { SourceReader, SourceStore } from '../ports';
import { createEmptyDocument } from './state';

export class OpenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OpenError';
  }
}

/**
 * Abre um PDF: lê a estrutura (via SourceReader), guarda os bytes no SourceStore
 * e devolve o DocumentState inicial (1 página do modelo por página do PDF, sem alterações).
 */
export async function openDocument(
  input: { name: string; bytes: Uint8Array },
  deps: { reader: SourceReader; sources: SourceStore; ids: IdFactory },
): Promise<DocumentState> {
  let info;
  try {
    info = await deps.reader.read(input.bytes);
  } catch (cause) {
    throw new OpenError(`Não foi possível abrir "${input.name}": arquivo inválido, protegido ou corrompido`, { cause });
  }
  if (info.pages.length === 0) throw new OpenError(`"${input.name}" não tem páginas`);

  const sourceId = deps.ids.source();
  await deps.sources.put(sourceId, input.bytes);

  const pages: Record<string, Page> = {};
  const pageOrder = info.pages.map((p, index) => {
    const id = deps.ids.page();
    pages[id] = { id, origin: { kind: 'source', sourceId, index }, crop: p.crop, baseRotation: p.rotation, rotation: 0, objects: [] };
    return id;
  });

  const empty = createEmptyDocument(input.name);
  return {
    ...empty,
    sources: { [sourceId]: { id: sourceId, name: input.name, byteLength: input.bytes.byteLength, pageCount: info.pages.length } },
    pages,
    pageOrder,
  };
}
