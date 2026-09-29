/**
 * E2E do vertical slice no navegador REAL (Chromium headless via Playwright):
 * abrir → renderizar (PDF.js) → DocumentState → excluir/girar/adicionar texto → undo → redo → exportar (download)
 * → reabrir o arquivo baixado com parser independente → validar.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { buildSamplePdf, MARKERS } from '../fixtures/fixtures';
import { nodePdfJs } from '../helpers';

const DIST = new URL('../../dist/', import.meta.url).pathname;
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

let server: Server;
let baseUrl = '';
let browser: Browser;
let tmp = '';

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
      const file = join(DIST, path === '/' || path === '' ? 'index.html' : path);
      if (!file.startsWith(DIST)) throw new Error('fora do dist');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;
  browser = await chromium.launch();
  tmp = await mkdtemp(join(tmpdir(), 'simply-pdf-e2e-'));
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function newPage(): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  await page.goto(baseUrl);
  return { page, errors };
}

const thumbs = (page: Page) => page.getByTestId('thumb');
const count = async (page: Page) => Number(await page.getByTestId('page-count').textContent());
const rotations = (page: Page) => thumbs(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-rotation')));
const status = (page: Page) => page.getByTestId('status').textContent();

/** Espera o canvas principal terminar de renderizar e devolve fração de pixels escuros + dimensões CSS. */
async function mainCanvasInfo(page: Page) {
  await page.waitForSelector('[data-testid="page-canvas"][data-render-state="done"]', { timeout: 15_000 });
  return page.getByTestId('page-canvas').evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] as number) < 60 && (data[i + 1] as number) < 60 && (data[i + 2] as number) < 60) dark++;
    return { dark, total: data.length / 4, cssW: parseFloat(canvas.style.width), cssH: parseFloat(canvas.style.height) };
  });
}

async function reopen(bytes: Uint8Array) {
  const doc = await nodePdfJs.getDocument({ data: bytes.slice(), standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname }).promise;
  const pages: { rotate: number; view: number[]; text: string }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const tc = await p.getTextContent();
    pages.push({ rotate: p.rotate, view: p.view as number[], text: tc.items.map((i) => ('str' in i ? i.str : '')).join(' ') });
  }
  await doc.destroy();
  return pages;
}

describe('slice v0.1–v0.5 no navegador', () => {
  it('abrir → renderizar → editar → undo → redo → exportar → reabrir → validar', async () => {
    const { page, errors } = await newPage();
    const pdf = await buildSamplePdf();

    // Abrir e renderizar
    await page.getByTestId('open-input').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    await page.getByTestId('btn-export').waitFor();
    assert.equal(await count(page), 3);
    assert.deepEqual(await rotations(page), ['0', '90', '0'], 'rotação do arquivo (/Rotate 90 na página 2) refletida no viewer');
    const first = await mainCanvasInfo(page);
    assert.ok(first.dark > 500, `canvas da página 1 deve conter o retângulo preto renderizado (escuros: ${first.dark})`);
    assert.ok(first.dark < first.total * 0.5, 'e não pode estar todo preto');
    assert.ok(first.cssH > first.cssW, 'página 1 em retrato');

    // Miniaturas renderizadas sob demanda (canvas de cada miniatura com pixels escuros)
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-testid="thumb"] canvas')).every((c) => {
      const cv = c as HTMLCanvasElement;
      if (cv.width === 0) return false;
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) if ((d[i] as number) < 60) return true;
      return false;
    }), undefined, { timeout: 15_000 });

    // Excluir a página 2 (selecionar miniatura 2 e excluir)
    await thumbs(page).nth(1).click();
    await page.getByTestId('btn-delete').click();
    assert.equal(await count(page), 2);
    assert.equal(await thumbs(page).count(), 2);

    // Girar a página 1 em 90°: miniatura e canvas principal mudam de orientação
    await thumbs(page).nth(0).click();
    await page.getByTestId('btn-rotate').click();
    assert.deepEqual(await rotations(page), ['90', '0']);
    const rotated = await mainCanvasInfo(page);
    assert.ok(rotated.cssW > rotated.cssH, 'página 1 girada fica em paisagem');
    assert.ok(rotated.dark > 500, 'conteúdo continua renderizado após girar');

    // Adicionar texto na página 2 (original 3)
    await thumbs(page).nth(1).click();
    await page.getByTestId('input-text').fill('Olá E2E — ção');
    await page.getByTestId('btn-add-text').click();
    assert.equal(await page.getByTestId('text-object').count(), 1);
    assert.equal(await page.getByTestId('text-object').textContent(), 'Olá E2E — ção');

    // Undo x3 pelos botões e pelo teclado; redo x3
    await page.getByTestId('btn-undo').click();
    assert.equal(await page.getByTestId('text-object').count(), 0, 'undo remove o texto');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await rotations(page), ['0', '0'], 'undo (teclado) desfaz a rotação');
    await page.getByTestId('btn-undo').click();
    assert.equal(await count(page), 3, 'undo restaura a página excluída');
    assert.deepEqual(await rotations(page), ['0', '90', '0'], 'na mesma posição, com o /Rotate original');
    assert.equal(await page.getByTestId('btn-undo').isDisabled(), true);

    await page.getByTestId('btn-redo').click();
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await count(page), 2);
    assert.deepEqual(await rotations(page), ['90', '0']);
    assert.equal(await page.getByTestId('btn-redo').isDisabled(), true);
    await thumbs(page).nth(1).click();
    assert.equal(await page.getByTestId('text-object').count(), 1, 'redo devolve o texto');

    // Exportar (download real) e reabrir com parser independente
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('btn-export').click()]);
    const outPath = join(tmp, 'exportado.pdf');
    await download.saveAs(outPath);
    await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.startsWith('Exportado e verificado'));
    assert.match((await status(page)) ?? '', /Exportado e verificado \(2 página\(s\)/);
    assert.equal(download.suggestedFilename(), 'sample-editado.pdf');
    assert.ok((await page.getByTestId('doc-name').textContent())?.endsWith('•') === false, 'após exportar o documento fica marcado como salvo');

    const bytes = new Uint8Array(await readFile(outPath));
    const pages = await reopen(bytes);
    assert.equal(pages.length, 2);
    assert.ok(pages[0]?.text.includes(MARKERS[0]) && pages[0].rotate === 90);
    assert.ok(pages[1]?.text.includes(MARKERS[2]) && pages[1].rotate === 0);
    assert.ok(pages[1]?.text.includes('Olá E2E — ção'));
    assert.ok(!pages.some((p) => p.text.includes(MARKERS[1])));
    assert.deepEqual(pages[1]?.view, [20, 30, 320, 430]);
    const q = spawnSync('qpdf', ['--check', outPath], { encoding: 'utf8' });
    assert.equal(q.status, 0, q.stdout + q.stderr);

    assert.deepEqual(errors, [], 'nenhum erro de console/página/rede');
  });

  it('arquivo que não é PDF mostra erro claro e a interface continua utilizável', async () => {
    const { page, errors } = await newPage();
    await page.getByTestId('open-input').setInputFiles({ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('isto não é um pdf') });
    await page.waitForFunction(() => /Não foi possível abrir/.test(document.querySelector('[data-testid="status"]')?.textContent ?? ''));
    assert.match((await status(page)) ?? '', /arquivo inválido, protegido ou corrompido/);
    await page.getByTestId('open-input').setInputFiles({ name: 'ok.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await buildSamplePdf()) });
    await page.getByTestId('btn-export').waitFor();
    assert.equal(await count(page), 3);
    assert.deepEqual(errors.filter((e) => !/Failed to load resource|Indexing all PDF objects|InvalidPDFException/.test(e)), []);
  });

  it('texto fora do conjunto WinAnsi desabilita o botão (não chega ao export)', async () => {
    const { page } = await newPage();
    await page.getByTestId('open-input').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await buildSamplePdf()) });
    await page.getByTestId('btn-export').waitFor();
    await page.getByTestId('input-text').fill('日本語');
    assert.equal(await page.getByTestId('btn-add-text').isDisabled(), true);
    await page.getByTestId('input-text').fill('   ');
    assert.equal(await page.getByTestId('btn-add-text').isDisabled(), true);
  });
});
