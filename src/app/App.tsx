import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  DocumentSession, ExportError, OpenError, OperationError, exportDocument, getOrderedPages, isWinAnsiText, openDocument,
  type PageId,
} from '../core';
import { PageCanvas } from '../features/viewer/PageCanvas';
import { Thumbnail } from '../features/viewer/Thumbnail';
import type { Services } from './wiring';

type Status = { kind: 'info' | 'ok' | 'error'; text: string };

function download(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function App({ services }: { services: Services }) {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'info', text: 'Abra um PDF para começar.' });

  const openFile = async (file: File): Promise<void> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const state = await openDocument({ name: file.name, bytes }, services);
      setSession(new DocumentSession(state));
      setStatus({ kind: 'ok', text: `"${file.name}" aberto: ${state.pageOrder.length} página(s).` });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof OpenError ? e.message : `Erro ao abrir: ${messageOf(e)}` });
    }
  };

  return (
    <div className="app">
      {session ? (
        <Workspace key={session.getState().sources ? Object.keys(session.getState().sources).join() : 'x'} session={session} services={services} onStatus={setStatus} onOpen={openFile} />
      ) : (
        <>
          <div className="toolbar">
            <span className="title">Simply PDF</span>
            <OpenButton onOpen={openFile} />
          </div>
          <div className="empty">Nenhum documento aberto</div>
        </>
      )}
      <div className={`status ${status.kind === 'info' ? '' : status.kind}`} data-testid="status" role="status">
        {status.text}
      </div>
    </div>
  );
}

function OpenButton({ onOpen }: { onOpen: (file: File) => void }) {
  return (
    <label className="filebtn">
      Abrir PDF…
      <input
        type="file"
        accept="application/pdf,.pdf"
        data-testid="open-input"
        onChange={(e: { target: { files: FileList | null; value: string } }) => {
          const file = e.target.files?.[0];
          if (file) onOpen(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function Workspace({ session, services, onStatus, onOpen }: { session: DocumentSession; services: Services; onStatus: (s: Status) => void; onOpen: (f: File) => void }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const state = snap.state;
  const pages = getOrderedPages(state);
  const [selectedId, setSelectedId] = useState<PageId | null>(pages[0]?.id ?? null);
  const [scale, setScale] = useState(1);
  const [draft, setDraft] = useState('Olá, Simply PDF');
  const [busy, setBusy] = useState(false);
  const selected = pages.find((p) => p.id === selectedId) ?? pages[0] ?? null;
  const selectedIndex = selected ? pages.findIndex((p) => p.id === selected.id) : -1;
  const canAddText = selected !== null && draft.trim() !== '' && isWinAnsiText(draft);

  const run = (fn: () => void): void => {
    try { fn(); } catch (e) { onStatus({ kind: 'error', text: e instanceof OperationError ? e.message : messageOf(e) }); }
  };
  const deletePage = (): void => run(() => {
    if (!selected) return;
    const next = pages[selectedIndex + 1] ?? pages[selectedIndex - 1] ?? null;
    session.execute({ type: 'page/delete', pageIds: [selected.id] });
    setSelectedId(next ? next.id : null);
  });
  const rotatePage = (): void => run(() => selected && session.execute({ type: 'page/rotate', pageIds: [selected.id], delta: 90 }));
  const addText = (): void => run(() => selected && session.execute({
    type: 'object/add',
    pageId: selected.id,
    object: { id: services.ids.object(), kind: 'text', rect: { x: 72, y: 72, w: 300, h: 60 }, text: draft, fontSize: 18, color: { r: 0.75, g: 0, b: 0 } },
  }));
  const undo = (): void => { session.undo(); };
  const redo = (): void => { session.redo(); };

  const exportPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      const { bytes, warnings } = await exportDocument(state, services);
      download(bytes, state.name.replace(/\.pdf$/i, '') + '-editado.pdf');
      session.markSaved();
      onStatus({ kind: 'ok', text: `Exportado e verificado (${pages.length} página(s), ${bytes.length} bytes).${warnings.length ? ` ${warnings.length} aviso(s): ${warnings.map((w) => w.message).join('; ')}` : ''}` });
    } catch (e) {
      onStatus({ kind: 'error', text: e instanceof ExportError ? e.message : `Erro ao exportar: ${messageOf(e)}` });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); session.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); session.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  return (
    <>
      <div className="toolbar">
        <span className="title">Simply PDF</span>
        <span className="doc" data-testid="doc-name">{state.name}{snap.isDirty ? ' •' : ''}</span>
        <OpenButton onOpen={onOpen} />
        <span className="sep" />
        <button data-testid="btn-undo" disabled={!snap.canUndo} onClick={undo} title="Desfazer (Ctrl+Z)">Desfazer</button>
        <button data-testid="btn-redo" disabled={!snap.canRedo} onClick={redo} title="Refazer (Ctrl+Y / Ctrl+Shift+Z)">Refazer</button>
        <span className="sep" />
        <button data-testid="btn-rotate" disabled={!selected} onClick={rotatePage}>Girar 90°</button>
        <button data-testid="btn-delete" disabled={!selected || pages.length <= 1} onClick={deletePage}>Excluir página</button>
        <span className="sep" />
        <input type="text" data-testid="input-text" value={draft} onChange={(e: { target: { value: string } }) => setDraft(e.target.value)} aria-label="Texto a adicionar" />
        <button data-testid="btn-add-text" disabled={!canAddText} onClick={addText} title={draft && !isWinAnsiText(draft) ? 'Caracteres fora do conjunto WinAnsi' : ''}>Adicionar texto</button>
        <span className="sep" />
        <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))} aria-label="Reduzir zoom">−</button>
        <span data-testid="zoom">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))} aria-label="Aumentar zoom">+</button>
        <span className="sep" />
        <button className="primary" data-testid="btn-export" disabled={busy} onClick={exportPdf}>Exportar PDF</button>
      </div>
      <div className="workspace">
        <div className="sidebar" data-testid="sidebar">
          {pages.map((p, i) => (
            <Thumbnail key={p.id} page={p} index={i} selected={selected?.id === p.id} renderer={services.renderer} onSelect={() => setSelectedId(p.id)} />
          ))}
        </div>
        <div className="stage">
          {selected ? <PageCanvas key={selected.id} page={selected} scale={scale} renderer={services.renderer} /> : <div className="empty">Documento sem páginas</div>}
        </div>
      </div>
      <span hidden data-testid="page-count">{pages.length}</span>
    </>
  );
}
