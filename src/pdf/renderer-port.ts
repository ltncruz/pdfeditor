/**
 * Porta de renderização do viewer. Arquivo SOMENTE de tipos: pode ser importado por features/*
 * sem acoplar a nenhuma biblioteca de PDF (a implementação com PDF.js vive em pdfjs-renderer.ts).
 */
import type { SourceId } from '../core/document/ids';
import type { Rotation } from '../core/pages/page';

export interface RenderRequest {
  readonly sourceId: SourceId;
  /** Índice 0-based da página no PDF de origem. */
  readonly index: number;
  /** Rotação FINAL desejada (base + usuário); substitui o /Rotate do arquivo no viewport. */
  readonly rotation: Rotation;
  readonly scale: number;
  readonly canvas: HTMLCanvasElement;
  readonly signal?: AbortSignal;
}

/** Desenha só o conteúdo ORIGINAL da página; objetos adicionados vêm do modelo (overlay). */
export interface PageRenderer {
  render(request: RenderRequest): Promise<void>;
  dispose(): Promise<void>;
}
