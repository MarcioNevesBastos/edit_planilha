import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function reachAutomaticExport(page: import('@playwright/test').Page, sourcePath: string, sourceIsXlsx: boolean) {
  await page.goto('/app.html');
  await page.getByLabel('Selecionar arquivo de origem').setInputFiles(sourcePath);
  if (sourceIsXlsx) {
    await page.getByLabel('Aba de origem').selectOption('Dados');
  }
  await expect(page.getByText(sourceIsXlsx ? 'source-basic.xlsx' : 'basic.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByLabel('Continuar sem modelo').check();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await expect(page.getByRole('heading', { name: 'Transformações' })).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: 'Executar validação' }).click();
  await expect(page.getByText('Nenhum erro encontrado')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByLabel(/Substituir/).check();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await expect(page.getByText('Nenhum risco de compatibilidade detectado.')).toBeVisible();
  await page.getByRole('radio', { name: 'Não, somente erros' }).check();
}

async function assertDownload(page: import('@playwright/test').Page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar .xlsx' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
}

test('exports CSV without a separate model', async ({ page }) => {
  await reachAutomaticExport(page, 'src/test-fixtures/csv/basic.csv', false);
  await assertDownload(page);
});

test('exports XLSX using the source workbook as a preserved base', async ({ page }) => {
  await reachAutomaticExport(page, 'src/test-fixtures/workbooks/source-basic.xlsx', true);
  await assertDownload(page);
});
