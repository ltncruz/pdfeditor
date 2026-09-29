// Verifica a licença REAL de cada pacote instalado (package.json + arquivo de licença lido do disco) e
// gera/valida THIRD_PARTY_LICENSES.md. Uso: `node scripts/licenses.mjs` (gera) | `--check` (falha se
// houver licença fora da política ou se o arquivo estiver desatualizado).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'THIRD_PARTY_LICENSES.md');
const CHECK = process.argv.includes('--check');

/** Política: só licenças permissivas. Qualquer coisa fora desta lista quebra o build. */
const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Zlib', 'BlueOak-1.0.0', 'OFL-1.1']);
const FORBIDDEN_TEXT = [/GNU AFFERO GENERAL PUBLIC LICENSE/i, /GNU GENERAL PUBLIC LICENSE/i, /GNU LESSER GENERAL PUBLIC LICENSE/i, /Server Side Public License/i];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rootPkg = readJson(join(root, 'package.json'));

function resolvePkg(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return realpathSync(dirname(candidate));
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' OR ');
  return 'UNKNOWN';
}

function licenseFile(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
  if (!file) return null;
  const text = readFileSync(join(dir, file), 'utf8');
  return { name: file, sha: createHash('sha256').update(text).digest('hex').slice(0, 12), text };
}

const found = new Map(); // "nome@versão" -> info
const missingOptional = [];

function visit(name, fromDir, scope, requiredBy, optional) {
  const dir = resolvePkg(name, fromDir);
  if (!dir) {
    if (optional) missingOptional.push({ name, requiredBy });
    else throw new Error(`Dependência não instalada: ${name} (requerida por ${requiredBy})`);
    return;
  }
  const pkg = readJson(join(dir, 'package.json'));
  const key = `${pkg.name}@${pkg.version}`;
  const existing = found.get(key);
  if (existing) {
    if (scope === 'runtime') existing.scope = 'runtime';
    return;
  }
  const lf = licenseFile(dir);
  found.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), file: lf, scope, requiredBy });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, scope, key, false);
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, scope, key, true);
}

for (const name of Object.keys(rootPkg.dependencies ?? {})) visit(name, root, 'runtime', '(projeto)', false);
for (const name of Object.keys(rootPkg.devDependencies ?? {})) visit(name, root, 'dev', '(projeto)', false);

// Subpacotes de binário por plataforma (ex.: @esbuild/linux-x64, @napi-rs/canvas-linux-x64-gnu) não trazem
// arquivo de licença próprio. Só aceitamos herdar do pacote PAI quando a licença declarada é idêntica e o pai
// tem arquivo de licença; o relatório mostra explicitamente que foi herdado.
for (const p of found.values()) {
  if (p.file) continue;
  const parent = found.get(p.requiredBy);
  if (parent?.file && parent.license === p.license) {
    p.file = { ...parent.file, name: `${parent.file.name} (herdado de ${parent.name}@${parent.version})` };
  }
}

// Política
const violations = [];
for (const p of found.values()) {
  const tokens = p.license.split(/\s+(?:AND|OR)\s+|[()]/).map((t) => t.trim()).filter(Boolean);
  const bad = tokens.filter((t) => !ALLOWED.has(t));
  if (bad.length) violations.push(`${p.name}@${p.version}: licença fora da política (${p.license})`);
  if (!p.file) violations.push(`${p.name}@${p.version}: sem arquivo de licença no pacote instalado`);
  else if (FORBIDDEN_TEXT.some((re) => re.test(p.file.text.slice(0, 2000)))) violations.push(`${p.name}@${p.version}: o TEXTO da licença indica GPL/AGPL/LGPL/SSPL`);
}

// Ferramenta externa (não distribuída): qpdf, usada só como validador estrutural nos testes.
let qpdfLine = 'não encontrado no ambiente';
const q = spawnSync('qpdf', ['--version'], { encoding: 'utf8' });
if (q.status === 0) {
  const c = spawnSync('qpdf', ['--copyright'], { encoding: 'utf8' }).stdout ?? '';
  qpdfLine = `${(q.stdout ?? '').split('\n')[0]} — ${/Apache License, Version 2\.0/.test(c) ? 'Apache-2.0 (confirmado por `qpdf --copyright`)' : 'licença NÃO confirmada'}`;
  if (!/Apache License, Version 2\.0/.test(c)) violations.push('qpdf: licença não confirmada por `qpdf --copyright`');
}

// Assets copiados para dist/ (lidos do disco, não presumidos)
const pdfjsDir = resolvePkg('pdfjs-dist', root);
const fontsDir = join(pdfjsDir, 'standard_fonts');
const foxit = readFileSync(join(fontsDir, 'LICENSE_FOXIT'), 'utf8');
const liberation = readFileSync(join(fontsDir, 'LICENSE_LIBERATION'), 'utf8');
const foxitOk = /Redistribution and use in source and binary forms/.test(foxit) && /Neither the name of Google/.test(foxit);
const liberationOk = /SIL OPEN FONT LICENSE Version 1\.1/.test(liberation);
if (!foxitOk) violations.push('pdfjs-dist/standard_fonts/LICENSE_FOXIT: não parece BSD-3-Clause');
if (!liberationOk) violations.push('pdfjs-dist/standard_fonts/LICENSE_LIBERATION: não parece SIL OFL 1.1');

const rows = (scope) =>
  [...found.values()]
    .filter((p) => p.scope === scope)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.file ? `${p.file.name} (sha256 ${p.file.sha})` : '—'} | ${p.requiredBy} |`)
    .join('\n');

const header = '| Pacote | Versão instalada | Licença (package.json) | Arquivo de licença lido | Requerido por |\n|---|---|---|---|---|';
const md = `# THIRD_PARTY_LICENSES

Gerado por \`node scripts/licenses.mjs\` (não edite à mão; \`npm run licenses -- --check\` falha se estiver desatualizado).

**Método:** para cada pacote realmente instalado em \`node_modules\` (fechamento transitivo de \`dependencies\`, \`devDependencies\` e \`optionalDependencies\`), o script lê o \`package.json\` e o arquivo de licença do disco. Ele também procura no texto da licença por GPL/AGPL/LGPL/SSPL e recusa qualquer licença fora da política permissiva: ${[...ALLOWED].join(', ')}. Não se usou conhecimento prévio sobre licenças.

## Dependências de runtime (distribuídas com o produto)

${header}
${rows('runtime')}

## Dependências de desenvolvimento (não distribuídas)

${header}
${rows('dev')}

## Assets distribuídos dentro do pacote web (\`dist/standard_fonts\`, vindos de pdfjs-dist)

| Asset | Licença lida do arquivo | Observação |
|---|---|---|
| Fontes Foxit (\`FoxitFixed*.pfb\`, \`FoxitSans*.pfb\`, \`FoxitSerif*.pfb\`, \`FoxitSymbol.pfb\`, \`FoxitDingbats.pfb\`) | BSD-3-Clause (cabeçalho "PDFium Authors" em \`LICENSE_FOXIT\`) | manter o aviso de copyright ao redistribuir |
| Fontes Liberation (\`LiberationSans-*.ttf\`) | SIL Open Font License 1.1 (\`LICENSE_LIBERATION\`) | OFL permite redistribuição junto com software; não vender a fonte isoladamente |

Esses assets são usados só pelo viewer para desenhar fontes padrão NÃO incorporadas. O PDF exportado referencia a Helvetica padrão por nome e **não incorpora** nenhuma fonte.

## Ferramentas externas (não instaladas via npm e não distribuídas)

| Ferramenta | Versão / licença | Uso |
|---|---|---|
| qpdf | ${qpdfLine} | apenas nos testes, como validador estrutural independente (\`qpdf --check\`). Não faz parte do produto neste slice. |

## Dependências opcionais não instaladas neste ambiente

${missingOptional.length ? missingOptional.map((m) => `- \`${m.name}\` (opcional de \`${m.requiredBy}\`)`).join('\n') : '- nenhuma'}

## Candidatas NÃO adicionadas (licença ainda por verificar)

O registro npm estava bloqueado neste ambiente (HTTP 403, \`x-deny-reason: host_not_allowed\`), então os pacotes abaixo **não foram instalados** e portanto **não constam em \`package.json\`**. Cada um só entra depois de instalado e com a licença lida do pacote real:

| Candidata | Papel | Situação |
|---|---|---|
| vite, @vitejs/plugin-react | build/dev server | pendente (substituído por esbuild em \`scripts/build-web.mjs\`) |
| vitest | testes do core | pendente (substituído por \`node:test\` + tsx) |
| @types/react, @types/react-dom | tipos | pendente (shim temporário em \`src/types/react-shim.d.ts\`) |
| zustand | estado de UI | pendente (a UI usa \`useSyncExternalStore\` sobre \`DocumentSession\`) |
| qpdf (WASM/binário empacotado) | otimização/criptografia (v0.9) | pendente; só o binário do sistema foi usado em testes |
| PDFium (WASM) | spike futuro pedido | pendente |
| tesseract.js, fontkit, dnd-kit, @tanstack/react-virtual, fast-check | versões futuras | pendente |
| MuPDF, Ghostscript | — | **excluídos por decisão**: AGPL/comercial |
`;

if (violations.length) {
  console.error('VIOLAÇÕES DE LICENÇA:\n- ' + violations.join('\n- '));
  process.exit(1);
}
if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== md) {
    console.error('THIRD_PARTY_LICENSES.md está desatualizado: rode `npm run licenses`.');
    process.exit(1);
  }
  console.log(`Licenças OK (${found.size} pacotes, todos dentro da política permissiva).`);
} else {
  writeFileSync(OUT, md);
  console.log(`THIRD_PARTY_LICENSES.md gerado (${found.size} pacotes verificados).`);
}
