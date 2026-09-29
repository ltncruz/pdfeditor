# Text selection / copy support

Implemented selectable/copyable text for digital PDFs using PDF.js `TextLayer`.

Changes:
- `PageRenderer` accepts an optional text-layer container.
- `createPdfJsRenderer` renders PDF.js `TextLayer` after the canvas.
- `PageCanvas` mounts the text layer between the canvas and editor overlay.
- CSS makes PDF text transparent/selectable while preserving the canvas as the visible source.
- Added E2E coverage for selection, zoom, rotation, and dirty-state behavior.

The change does **not** edit pre-existing PDF text yet. It only enables selection/copy of text already present in digital PDFs. Scanned/image-only PDFs still need OCR before they can expose selectable text.

## PDF.js 6.3.289 hardening

- Direct dependency is pinned to `pdfjs-dist@6.3.289`.
- `TextLayer` now consumes `streamTextContent(...)`, matching the current PDF.js viewer path.
- `isEvalSupported: false` remains enforced when opening documents.
- A restrictive CSP was added to the web shell.
- The build no longer redistributes `LiberationSans-*.ttf` from PDF.js 6.3.289 because those 1.07.4 font assets are GPLv2 with the Liberation Font Exception; the Simply PDF distribution keeps its permissive-only asset policy and copies only Foxit/PDFium standard-font assets.
