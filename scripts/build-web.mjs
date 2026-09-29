// Build do app web SEM Vite (o registro npm estava bloqueado): esbuild + cópia dos assets do PDF.js.
// Quando o Vite puder ser instalado (licença a verificar), este script é substituído por vite.config.ts.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'src/app/main.tsx')],
  outfile: join(dist, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

cpSync(join(root, 'src/app/index.html'), join(dist, 'index.html'));
cpSync(join(root, 'src/app/styles.css'), join(dist, 'styles.css'));
cpSync(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'), join(dist, 'pdf.worker.min.mjs'));
// PDF.js 6.3.289 corrigiu a licença das LiberationSans 1.07.4: elas são GPLv2
// com exceção de fonte. A política do Simply PDF permite apenas licenças permissivas,
// então NÃO redistribuímos os .ttf Liberation. Mantemos apenas as fontes Foxit/PDFium
// (BSD-3-Clause) necessárias às fontes padrão Type 1 e seu aviso de licença.
const sourceFonts = join(root, 'node_modules/pdfjs-dist/standard_fonts');
const targetFonts = join(dist, 'standard_fonts');
mkdirSync(targetFonts, { recursive: true });
for (const name of readdirSync(sourceFonts)) {
  if (name === 'LICENSE_FOXIT' || /^Foxit.*\.pfb$/i.test(name)) {
    cpSync(join(sourceFonts, name), join(targetFonts, name));
  }
}
console.log('dist/ pronto');
