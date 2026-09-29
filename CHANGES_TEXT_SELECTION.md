# Text selection / copy support

Implemented selectable/copyable text for digital PDFs using PDF.js `TextLayer`.

Changes:
- `PageRenderer` accepts an optional text-layer container.
- `createPdfJsRenderer` renders PDF.js `TextLayer` after the canvas.
- `PageCanvas` mounts the text layer between the canvas and editor overlay.
- CSS makes PDF text transparent/selectable while preserving the canvas as the visible source.
- Added E2E coverage for selection, zoom, rotation, and dirty-state behavior.

The change does **not** edit pre-existing PDF text yet. It only enables selection/copy of text already present in digital PDFs. Scanned/image-only PDFs still need OCR before they can expose selectable text.
