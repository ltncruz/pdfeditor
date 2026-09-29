# Simply PDF — Arquitetura

Estado: **vertical slice v0.1–v0.5** implementado e testado. Este documento descreve o que existe hoje e as decisões que guiam as próximas versões. Onde algo ainda não existe, está marcado como *(planejado)*.

## 1. Caminho primário (obrigatório)

```
Viewer → modelo do documento → páginas → alterações (operações) → undo/redo → exportação
```

Toda funcionalidade futura (assinatura, desenho, redaction, OCR, automação) entra por esse caminho, nunca por um sistema paralelo. O critério de conclusão do núcleo é um teste automatizado: abrir → visualizar → modificar → desfazer → refazer → exportar → reabrir o PDF exportado → verificar a alteração (`tests/integration/roundtrip.test.ts` e `tests/e2e/slice.e2e.test.ts`).

## 2. Camadas e fronteiras

```
app/        composição (wiring), tela principal          -> livre
features/   componentes de UI (viewer)                   -> só core + porta pdf/renderer-port
pdf/        adaptadores: PDF.js (leitura/render/verificação), pdf-lib (escrita)
services/   armazenamento (SourceStore em memória)
core/       TypeScript puro: document, pages, operations, history, export, ports
```

Regras impostas por `scripts/boundaries-lib.mjs` (roda em `npm run verify` e tem testes próprios):

- `core` só importa código dentro de `core` (nenhum pacote, nenhum `node:*`, nenhuma outra camada).
- `features` não importa `pdf-lib`/`pdfjs-dist`; de `src/pdf` só o arquivo de tipos `renderer-port`.
- `pdf` e `services` não importam React, `features` ou `app`.

Consequência: PDF.js, pdf-lib e qpdf ficam **atrás de interfaces** (`SourceReader`, `PdfWriter`, `PdfInspector`, `PageRenderer`, `SourceStore`) e podem ser trocados (por exemplo por PDFium) sem tocar no core.

## 3. Política de licenças

O produto pode ser comercial/proprietário. Portanto:

- Só entram dependências permissivas (MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, OFL para fontes). `scripts/licenses.mjs` lê a licença **do pacote realmente instalado** (package.json + arquivo de licença + busca por GPL/AGPL/LGPL/SSPL no texto) e falha o `verify` se algo sair da política. O resultado fica em `THIRD_PARTY_LICENSES.md`.
- **MuPDF e Ghostscript não são incorporados** (AGPL/comercial). Só seriam considerados com licença comercial adquirida.
- Dependência nova = instalar → ler a licença real → registrar → só então usar.

## 4. Document Model

`DocumentState` (imutável, sem React/DOM/PDF):

```ts
interface DocumentState {
  name: string;
  sources: Record<SourceId, SourceRef>;   // metadados; os BYTES ficam no SourceStore
  pages: Record<PageId, Page>;
  pageOrder: PageId[];                    // ordem "viva"; mesmas chaves de pages
  revision: number;                       // +1 por operação/undo/redo (invalida caches)
}
```

- O PDF original **nunca é alterado**. O estado referencia páginas de origem `(sourceId, índice)`; juntar/duplicar/extrair páginas será manipulação de referências.
- `openDocument()` lê a estrutura via `SourceReader`, guarda os bytes no `SourceStore` e devolve o estado inicial.

## 5. Page

```ts
interface Page {
  id: PageId;
  origin: { kind: 'source'; sourceId; index } | { kind: 'blank' };
  crop: Rect;             // CropBox efetiva em user space PDF (origem inferior esquerda), sem rotação
  baseRotation: Rotation; // /Rotate do arquivo
  rotation: Rotation;     // delta do usuário
  objects: PageObject[];  // z-order = ordem do array
}
```

Hoje `PageObject` só tem `TextObject` (caixa de texto simples, fonte Helvetica). O tipo é uma união aberta.

### Contrato de coordenadas

Objetos do modelo vivem no **espaço de página do modelo**: pontos PDF, origem no canto **superior esquerdo** da CropBox, eixo y para baixo, página **sem rotação**. A rotação (`baseRotation + rotation`) é só transformação de visualização/exportação:

- **Viewer:** o overlay HTML é desenhado no espaço do modelo e rotacionado junto com a página (`PageCanvas`).
- **Exportação:** `modelRectToUserSpace()` converte para user space PDF (soma a origem da CropBox e inverte y), desenha o texto e só então grava `/Rotate` = base + usuário. O texto gira junto com a página.
- Testado com CropBox deslocada (página 3 da fixture) e verificado na posição real do texto extraído pelo PDF.js.

## 6. Operações

Operações são **dados serializáveis** (base para autosave, testes e o futuro Simply Automate):

| Operação | Inverso calculado na aplicação |
|---|---|
| `page/delete { pageIds }` | `page/insert` com as próprias páginas e seus índices originais |
| `page/insert { items: [{page, index}] }` | `page/delete` |
| `page/rotate { pageIds, delta }` | `page/rotate` com `360 - delta` |
| `object/add { pageId, object, index? }` | `object/remove` |
| `object/remove { pageId, objectId }` | `object/add` na mesma posição de z-order |
| `batch { ops }` | `batch` dos inversos em ordem reversa (atômico, 1 entrada de histórico) |

`applyOperation(state, op)` é **pura e atômica**: nunca muta o estado; se qualquer validação falhar lança `OperationError` e nada muda. Validações: seleção vazia, página/objeto inexistente, id duplicado, índice inválido, rotação inválida.

## 7. Undo/Redo

- `DocumentSession` (única porta de escrita) = estado atual + `History`. `execute` aplica, guarda `{forward, inverse}` e limpa o redo; `undo` aplica o inverso; `redo` reaplica o `forward`.
- Custo O(tamanho da operação): nada de cópia do PDF. Páginas excluídas viajam dentro do inverso (imutáveis e estruturalmente compartilhadas).
- Limite de histórico configurável (padrão 500 entradas).
- `isDirty` é a **posição no histórico** em relação ao último `markSaved()`: desfazer até o ponto salvo deixa o documento limpo.
- Compatível com `useSyncExternalStore` (`subscribe` + `getSnapshot` estável).
- Atalhos na UI: Ctrl/Cmd+Z, Ctrl+Y, Ctrl+Shift+Z (ignorados com foco em campo de texto).
- Ainda **não** há coalescência de operações (`mergeKey`) nem persistência do histórico *(planejado, v0.7)*.

## 8. Exportação

```
preflight → plan (puro) → materialize (PdfWriter) → verify (PdfInspector independente) → bytes
```

1. **preflight** (`core/export/preflight.ts`): documento vazio, origem ausente, página de origem fora do intervalo, texto vazio/não codificável (WinAnsi), tamanho de fonte e retângulo inválidos (erros); objeto parcialmente fora da página (aviso). Erro aborta **antes** de gerar qualquer arquivo.
2. **plan** (`buildExportPlan`): função pura `DocumentState → ExportPlan`.
3. **materialize** (`pdflib-writer.ts`): cria **sempre um documento novo**, copia página a página, aplica CropBox, `/Rotate` e texto.
4. **verify** (`verifyExport`): reabre o resultado com o PDF.js (parser diferente do writer) e confere contagem de páginas, rotação, tamanho e presença do texto adicionado. Divergência ⇒ `ExportError`, **nenhum byte é devolvido**.
5. A gravação (download/disco) é do chamador e só recebe bytes verificados.

O original permanece intacto (hash conferido em teste) e o sistema nunca faz atualização incremental.

## 9. Viewer

- PDF.js (build **legacy**, com polyfills) em worker. Um `PDFDocumentProxy` por origem, cache dentro do `PageRenderer`.
- Renderização cancelável (`AbortSignal` → `RenderTask.cancel()`), com `devicePixelRatio`.
- A rotação passada ao viewport é a **efetiva** (base + usuário).
- Miniaturas são renderizadas só quando entram na área visível (`IntersectionObserver`).
- Overlay dos objetos vem do modelo; o Viewer não contém regra de edição.
- Ainda **não** há virtualização da página principal, LRU de bitmaps nem carregamento progressivo *(planejado, v0.1 completo)*: o slice mostra uma página por vez.

## 10. Estrutura de diretórios

```
src/core/{document,pages,operations,history,export}, ports.ts, session.ts, index.ts
src/pdf/        pdfjs-reader.ts, pdfjs-renderer.ts, renderer-port.ts, pdflib-writer.ts
src/services/   memory-source-store.ts
src/features/viewer/  PageCanvas.tsx, Thumbnail.tsx
src/app/        App.tsx, main.tsx, wiring.ts, index.html, styles.css
scripts/        build-web.mjs, check-boundaries.mjs, boundaries-lib.mjs, licenses.mjs
tests/{core,integration,e2e,fixtures}
```

## 11. Testes

| Suíte | O que prova |
|---|---|
| `tests/core/operations.test.ts` | cada operação + inverso, erros, atomicidade do batch, imutabilidade (estado congelado) |
| `tests/core/session.test.ts` | undo/redo, redo descartado, limite, dirty, subscribe |
| `tests/core/history.random.test.ts` | 300 sequências aleatórias: undo total = estado inicial, redo total = estado final |
| `tests/core/export.test.ts` | geometria, plano puro, preflight, pipeline com dublês (core sem lib de PDF) |
| `tests/core/boundaries.test.ts` | fronteiras entre camadas |
| `tests/integration/roundtrip.test.ts` | abrir → editar → undo/redo → exportar → reabrir (PDF.js) + `qpdf --check` |
| `tests/e2e/slice.e2e.test.ts` | o mesmo fluxo no Chromium real: render, cliques, teclado, download |

## 12. Decisões e desvios em relação ao plano inicial

1. **Sem "tombstones" de página.** O plano falava em manter páginas excluídas na tabela. Foi mais simples e igualmente barato carregar as páginas no inverso de `page/delete`.
2. **`crop: Rect` em vez de `size`.** Necessário para CropBox com origem diferente de zero.
3. **Dirty por posição no histórico**, não por `savedRevision` numérico, para que desfazer até o ponto salvo deixe o documento limpo.
4. **Testes com `node:test` + tsx e build com esbuild**, não Vitest/Vite: o registro npm estava bloqueado neste ambiente. Ver `THIRD_PARTY_LICENSES.md` (candidatas pendentes).
5. **Sem Zustand:** `useSyncExternalStore` direto sobre `DocumentSession`.
6. **PDF.js legacy no navegador:** o build padrão 5.x exige `Map.prototype.getOrInsertComputed`, ausente no Chromium do E2E.
7. **qpdf** foi usado só como validador estrutural nos testes; ainda não é dependência do produto.

## 13. Próximos passos (fora deste slice)

- Spike **PDFium** (pedido): antes da v0.8, comparar fidelidade de render vs PDF.js, remoção de objetos dentro de uma região (base da redaction real), tamanho/performance do WASM e licença da versão instalada; decidir se assume manipulação avançada sem comprometer a licença comercial.
- v0.1 completo (virtualização, LRU, progressivo), v0.6 (organizar páginas), v0.7 (mais objetos, coalescência de undo, fontes Unicode embutidas), v0.8 (redaction por rasterização verificada), v0.9 (qpdf, OCR, compressão, automação).
