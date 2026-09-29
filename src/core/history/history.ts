import type { Operation } from '../operations/types';

/** Uma entrada de histórico guarda só operações (dados pequenos), nunca cópias do PDF. */
export interface HistoryEntry {
  readonly forward: Operation;
  readonly inverse: Operation;
}

export class History {
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  readonly maxEntries: number;

  constructor(maxEntries = 500) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries deve ser >= 1');
    this.maxEntries = maxEntries;
  }

  /** Nova alteração: entra na pilha de undo e invalida o redo. */
  push(entry: HistoryEntry): void {
    this.#undo.push(entry);
    this.#redo.length = 0;
    if (this.#undo.length > this.maxEntries) this.#undo.shift();
  }

  peekUndo(): HistoryEntry | undefined {
    return this.#undo[this.#undo.length - 1];
  }
  peekRedo(): HistoryEntry | undefined {
    return this.#redo[this.#redo.length - 1];
  }

  /** Chamados APÓS o estado ter sido atualizado com sucesso. */
  commitUndo(): void {
    const entry = this.#undo.pop();
    if (entry) this.#redo.push(entry);
  }
  commitRedo(): void {
    const entry = this.#redo.pop();
    if (entry) this.#undo.push(entry);
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }
  get undoDepth(): number {
    return this.#undo.length;
  }
  get redoDepth(): number {
    return this.#redo.length;
  }
}
