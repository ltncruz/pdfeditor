# Simply PDF

Editor de PDF universal, local-first. Este repositório contém o **vertical slice v0.1–v0.5**: abrir → renderizar → DocumentState → excluir/girar páginas e adicionar texto → undo/redo → exportar → reabrir e validar.

Leia `ARCHITECTURE.md` (arquitetura e decisões) e `THIRD_PARTY_LICENSES.md` (licenças verificadas).

## Comandos

```bash
npm run verify        # fronteiras + licenças + typecheck + testes + E2E
npm test              # core + integração (node:test via tsx)
npm run test:e2e      # build web + E2E no Chromium (Playwright)
npm run build:web     # gera dist/ (esbuild)
npm run licenses      # regenera THIRD_PARTY_LICENSES.md a partir dos pacotes instalados
npm run fixtures      # escreve tests/fixtures/out/sample-3pages.pdf
```

Para abrir o app: `npm run build:web` e sirva `dist/` com qualquer servidor estático (ES modules exigem http, não file://).

## Nota sobre o ambiente de desenvolvimento

`node_modules` deste snapshot foi montado com links para pacotes já instalados globalmente (o registro npm estava bloqueado). Numa máquina com acesso, `npm install` instala as mesmas versões fixas de `package.json`; rode `npm run verify` em seguida.
