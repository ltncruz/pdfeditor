import type { DocumentState } from './document/state';
import type { Operation } from './operations/types';
import { applyOperation } from './operations/apply';
import { History, type HistoryEntry } from './history/history';

export interface SessionSnapshot {
  readonly state: DocumentState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
}

/**
 * Sessão de edição: estado atual + histórico. É a ÚNICA porta de escrita do documento.
 * Compatível com useSyncExternalStore (subscribe / getSnapshot com identidade estável entre mudanças).
 */
export class DocumentSession {
  #state: DocumentState;
  readonly #history: History;
  readonly #listeners = new Set<() => void>();
  #savedTop: HistoryEntry | null = null;
  #snapshot: SessionSnapshot;

  constructor(initial: DocumentState, options: { maxHistory?: number } = {}) {
    this.#state = initial;
    this.#history = new History(options.maxHistory);
    this.#snapshot = this.#buildSnapshot();
  }

  getState = (): DocumentState => this.#state;
  getSnapshot = (): SessionSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get canUndo(): boolean {
    return this.#history.canUndo;
  }
  get canRedo(): boolean {
    return this.#history.canRedo;
  }
  /** True se o estado atual difere do último ponto salvo (o ponto é uma posição no histórico). */
  get isDirty(): boolean {
    return (this.#history.peekUndo() ?? null) !== this.#savedTop;
  }

  /** Aplica uma alteração. Lança OperationError (estado intacto) se a operação for inválida. */
  execute(op: Operation): void {
    const applied = applyOperation(this.#state, op);
    this.#state = applied.state;
    this.#history.push({ forward: op, inverse: applied.inverse });
    this.#publish();
  }

  undo(): boolean {
    const entry = this.#history.peekUndo();
    if (!entry) return false;
    this.#state = applyOperation(this.#state, entry.inverse).state;
    this.#history.commitUndo();
    this.#publish();
    return true;
  }

  redo(): boolean {
    const entry = this.#history.peekRedo();
    if (!entry) return false;
    this.#state = applyOperation(this.#state, entry.forward).state;
    this.#history.commitRedo();
    this.#publish();
    return true;
  }

  /** Marca o estado atual como salvo/exportado (não altera o histórico). */
  markSaved(): void {
    this.#savedTop = this.#history.peekUndo() ?? null;
    this.#publish();
  }

  #buildSnapshot(): SessionSnapshot {
    return { state: this.#state, canUndo: this.canUndo, canRedo: this.canRedo, isDirty: this.isDirty };
  }

  #publish(): void {
    this.#snapshot = this.#buildSnapshot();
    for (const l of [...this.#listeners]) l();
  }
}
