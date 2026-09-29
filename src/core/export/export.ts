import type { DocumentState } from '../document/state';
import type { PdfInspector, PdfWriter, SourceStore } from '../ports';
import { buildExportPlan } from './plan';
import { preflight, type PreflightIssue } from './preflight';
import { verifyExport, type VerifyIssue } from './verify';

export type ExportFailure =
  | { readonly stage: 'preflight'; readonly issues: readonly PreflightIssue[] }
  | { readonly stage: 'write'; readonly cause: unknown }
  | { readonly stage: 'verify'; readonly issues: readonly VerifyIssue[] };

/** Falha de exportação. Nunca devolve bytes: um arquivo que não passou na verificação é descartado. */
export class ExportError extends Error {
  readonly failure: ExportFailure;
  constructor(failure: ExportFailure) {
    const detail =
      failure.stage === 'write'
        ? String(failure.cause instanceof Error ? failure.cause.message : failure.cause)
        : failure.issues.map((i) => i.message).join('; ');
    super(`Falha na exportação (${failure.stage}): ${detail}`);
    this.name = 'ExportError';
    this.failure = failure;
  }
}

export interface ExportDeps {
  readonly sources: SourceStore;
  readonly writer: PdfWriter;
  readonly inspector: PdfInspector;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly warnings: readonly PreflightIssue[];
}

/**
 * Pipeline: preflight -> plan (puro) -> materialize (writer) -> verify (parser independente).
 * A gravação em disco/download é responsabilidade do chamador, só com bytes já verificados.
 */
export async function exportDocument(state: DocumentState, deps: ExportDeps): Promise<ExportResult> {
  const issues = await preflight(state, deps.sources);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new ExportError({ stage: 'preflight', issues: errors });

  const plan = buildExportPlan(state);
  let bytes: Uint8Array;
  try {
    bytes = await deps.writer.materialize(plan, deps.sources);
  } catch (cause) {
    throw new ExportError({ stage: 'write', cause });
  }

  let problems: VerifyIssue[];
  try {
    problems = await verifyExport(bytes, plan, deps.inspector);
  } catch (cause) {
    throw new ExportError({ stage: 'write', cause: new Error(`PDF gerado não pôde ser reaberto: ${String(cause instanceof Error ? cause.message : cause)}`) });
  }
  if (problems.length > 0) throw new ExportError({ stage: 'verify', issues: problems });

  return { bytes, warnings: issues.filter((i) => i.severity === 'warning') };
}
