# Remoção de proteções antes da exportação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover proteções de pasta de trabalho e de planilhas apenas na cópia exportada, permitindo a exportação sem alterar o arquivo original.

**Architecture:** Criar um sanitizador OOXML que clona o pacote, indexa workbook e worksheets e remove somente `<workbookProtection>` e `<sheetProtection>`. O worker sanitiza o pacote antes de `SCAN_EXPORT_RISKS`; `exportWorkbook` também prepara sua própria cópia para garantir segurança em chamadas diretas.

**Tech Stack:** TypeScript, React/Vitest existente, `OoxmlPackage`, parser/indexador OOXML atual e worker de dados.

## Global Constraints

- Remover proteção estrutural do workbook e proteção de todas as abas.
- Não alterar o pacote original recebido pelo usuário.
- Manter `scanExportRisks` capaz de diagnosticar proteções em um pacote bruto.
- Continuar bloqueando criptografia, macros, estruturas incompatíveis e demais riscos não relacionados à proteção.
- Seguir TDD: cada comportamento novo deve ter teste falhando antes da implementação.

---

### Task 1: Criar o sanitizador de proteções OOXML

**Files:**
- Create: `src/io/template/protection-sanitizer.ts`
- Test: `tests/unit/io/protection-sanitizer.test.ts`
- Reference: `src/io/template/ooxml-package.ts`, `src/io/template/workbook-index.ts`

**Interfaces:**
- Produces `preparePackageForExport(source: OoxmlPackage): Promise<OoxmlPackage>`.
- A função deve emitir e reabrir `source`, indexar o pacote preparado e atualizar apenas `workbookPath` e os `sheet.path` encontrados no índice.

- [ ] **Step 1: Escrever o teste falhando para remover as duas proteções**

  No teste, abra `template-structured.xlsx`, injete `<workbookProtection workbookPassword="ABCD" lockStructure="1"/>` em `xl/workbook.xml` e injete `<sheetProtection sheet="1"/>` em ambas as worksheets. Chame `preparePackageForExport` e verifique que:

  ```ts
  expect(workbookXml).not.toMatch(/<workbookProtection\b/);
  expect(sheet1Xml).not.toMatch(/<sheetProtection\b/);
  expect(sheet2Xml).not.toMatch(/<sheetProtection\b/);
  ```

- [ ] **Step 2: Executar o teste para confirmar RED**

  Run: `npx vitest run tests/unit/io/protection-sanitizer.test.ts`

  Expected: falha porque `protection-sanitizer.ts` e `preparePackageForExport` ainda não existem.

- [ ] **Step 3: Escrever a implementação mínima**

  Implementar a clonagem com `openOoxmlPackage(await source.emit())`, localizar as partes com `indexWorkbook`, e remover tags autocontidas ou com fechamento explícito usando uma função privada que receba `tagName`:

  ```ts
  function removeXmlElements(xml: string, tagName: string): string {
    const pattern = new RegExp(`<${tagName}\\b[^>]*(?:/>|>[\\s\\S]*?<\\/${tagName}>)`, 'g');
    return xml.replace(pattern, '');
  }
  ```

  Atualizar o XML somente quando houver alteração; manter todos os outros bytes de cada parte e retornar o pacote clonado.

- [ ] **Step 4: Adicionar teste de não mutação e preservação**

  Capture antes os XMLs do pacote original, execute o sanitizador e confirme que o original ainda contém as tags, enquanto a cópia não contém as tags e preserva uma marca não relacionada, como `<calcPr` ou `<sheetData`.

- [ ] **Step 5: Executar os testes da unidade**

  Run: `npx vitest run tests/unit/io/protection-sanitizer.test.ts`

  Expected: todos os testes passam.

- [ ] **Step 6: Commitar o sanitizador**

  ```bash
  git add src/io/template/protection-sanitizer.ts tests/unit/io/protection-sanitizer.test.ts
  git commit -m "feat: sanitize workbook protections in export copies"
  ```

### Task 2: Preparar a cópia dentro de `exportWorkbook`

**Files:**
- Modify: `src/io/template/export-workbook.ts`
- Test: `tests/integration/io/preservation-regression.test.ts`

**Interfaces:**
- `exportWorkbook(input: ExportInput, options?)` continuará com a mesma assinatura pública.
- A função usará um `preparedInput` cujo `package` veio de `preparePackageForExport`; o `scanExportRisks` executado internamente receberá esse pacote preparado.

- [ ] **Step 1: Escrever o teste falhando para exportar um destino protegido**

  Mantenha um teste diagnóstico que chama `scanExportRisks` no pacote bruto e confirma os riscos de proteção. Acrescente um teste que chama `exportWorkbook` com a mesma entrada, aguarda a `Blob`, reabra o resultado com `openOoxmlPackage` e confirme:

  ```ts
  expect(exportedWorkbookXml).not.toContain('<workbookProtection');
  expect(exportedSheetXml).not.toContain('<sheetProtection');
  expect(originalWorkbookXml).toContain('<workbookProtection');
  ```

- [ ] **Step 2: Executar o teste para confirmar RED**

  Run: `npx vitest run tests/integration/io/preservation-regression.test.ts`

  Expected: o teste falha porque `exportWorkbook` ainda calcula riscos e bloqueia o pacote protegido.

- [ ] **Step 3: Integrar o sanitizador antes da análise de riscos**

  Em `exportWorkbook`, prepare uma cópia no início, crie `preparedInput = { ...input, package: preparedPackage }`, use `preparedInput` para `scanExportRisks`, revisão de riscos, indexação, escrita e emissão. Nunca chame `updatePart` em `input.package`.

- [ ] **Step 4: Executar os testes de preservação**

  Run: `npx vitest run tests/integration/io/preservation-regression.test.ts`

  Expected: os testes de proteção e os demais testes de preservação passam sem alterar os riscos existentes.

- [ ] **Step 5: Commitar a integração de exportação**

  ```bash
  git add src/io/template/export-workbook.ts tests/integration/io/preservation-regression.test.ts
  git commit -m "feat: export workbooks without protection tags"
  ```

### Task 3: Sanitizar a análise de riscos no worker

**Files:**
- Modify: `src/workers/data-worker.ts`
- Test: `tests/integration/workers/data-worker.test.ts`

**Interfaces:**
- O protocolo `SCAN_EXPORT_RISKS` não muda.
- O caso `EXPORT` continuará delegando a sanitização à função pública `exportWorkbook`.

- [ ] **Step 1: Escrever o teste falhando do fluxo de análise**

  Usar o dispatcher existente para enviar `SCAN_EXPORT_RISKS` com template contendo `workbookProtection` e `sheetProtection`. Verificar que a resposta `EXPORT_RISKS` não contém `protected-workbook` nem `protected-destination-sheet`, mas continua retornando outros riscos reais quando inseridos no pacote.

- [ ] **Step 2: Executar o teste para confirmar RED**

  Run: `npx vitest run tests/integration/workers/data-worker.test.ts`

  Expected: a resposta ainda contém os riscos de proteção porque o worker analisa o pacote bruto.

- [ ] **Step 3: Preparar o pacote no caso `SCAN_EXPORT_RISKS`**

  Depois de abrir `request.templateBuffer`, chamar `preparePackageForExport(packageForScan)` antes de `scanExportRisks`. Manter as verificações de cancelamento antes e depois da preparação.

- [ ] **Step 4: Executar os testes do worker**

  Run: `npx vitest run tests/integration/workers/data-worker.test.ts`

  Expected: o teste novo passa e os demais testes do worker continuam verdes.

- [ ] **Step 5: Commitar a análise sanitizada**

  ```bash
  git add src/workers/data-worker.ts tests/integration/workers/data-worker.test.ts
  git commit -m "feat: scan sanitized workbooks for export risks"
  ```

### Task 4: Verificação final e regressões

**Files:**
- Review: `src/io/template/protection-sanitizer.ts`
- Review: `src/io/template/export-workbook.ts`
- Review: `src/workers/data-worker.ts`
- Tests: `tests/unit/io/protection-sanitizer.test.ts`, `tests/integration/io/preservation-regression.test.ts`, `tests/integration/workers/data-worker.test.ts`, `tests/unit/app/workflow.test.tsx`

- [ ] **Step 1: Procurar proteções mutadas fora da cópia**

  Run: `rg -n "workbookProtection|sheetProtection|preparePackageForExport" src tests`

  Confirmar que a remoção ocorre somente no sanitizador e que o scanner bruto continua detectando tags.

- [ ] **Step 2: Executar a suíte focada**

  Run: `npx vitest run tests/unit/io/protection-sanitizer.test.ts tests/integration/io/preservation-regression.test.ts tests/integration/workers/data-worker.test.ts tests/unit/app/workflow.test.tsx --testTimeout=15000`

  Expected: zero falhas.

- [ ] **Step 3: Executar typecheck, testes completos e build**

  ```bash
  npm run typecheck
  npm test -- --testTimeout=15000
  npm run build
  ```

  Expected: todos os comandos terminam com código 0; a suíte deve confirmar que criptografia, macros e riscos de escrita continuam bloqueando.

- [ ] **Step 4: Executar E2E**

  Run: `npm run test:e2e`

  Expected: o fluxo existente não deve mais exibir o bloqueio de proteção na etapa 10. Se o Chromium empacotado estiver ausente, repetir com o Chrome local documentando o bloqueio de ambiente, sem alterar testes do produto.

- [ ] **Step 5: Revisar diff e estado do repositório**

  Run: `git diff --check && git status --short`

  Confirmar que apenas os arquivos previstos foram modificados e que nenhuma alteração foi feita no fixture original para simular a remoção.

- [ ] **Step 6: Commitar a verificação final**

  ```bash
  git add src/io/template/protection-sanitizer.ts src/io/template/export-workbook.ts src/workers/data-worker.ts tests/unit/io/protection-sanitizer.test.ts tests/integration/io/preservation-regression.test.ts tests/integration/workers/data-worker.test.ts
  git commit -m "test: verify protected workbook export sanitization"
  ```
