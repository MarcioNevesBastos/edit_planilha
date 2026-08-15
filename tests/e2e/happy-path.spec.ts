import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('imports, transforms, validates, replaces, and exports an xlsx workbook', async ({ page }) => {
  await page.goto('/app.html');
  await expect(page).toHaveTitle('Preparar planilha');
  await expect(page.getByRole('heading', { name: 'Preparar planilha' })).toBeVisible();

  await page.getByLabel('Selecionar arquivo de origem').setInputFiles(
    'src/test-fixtures/csv/basic.csv',
  );
  await expect(page.getByText('basic.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  await page.getByLabel('Selecionar arquivo modelo').setInputFiles(
    'src/test-fixtures/workbooks/template-structured.xlsx',
  );
  await page.getByLabel('Aba do modelo').selectOption('Dados Modelo');
  await expect(page.getByText('Dados Modelo selecionada')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  await page.getByLabel(/TabelaDestino/).click();
  await page.getByRole('button', { name: 'Avançar' }).click();

  await page.getByRole('button', { name: 'Aceitar ID' }).click();
  await page.getByLabel('Destino para Nome').selectOption({ label: 'Produto' });
  await page.getByRole('button', { name: 'Aceitar Nome' }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();

  await page.getByLabel('Tipo de transformação').selectOption('numberConversion');
  await page.getByLabel('Coluna principal').selectOption({ label: 'ID' });
  await page.getByRole('combobox', { name: 'Valor' }).fill('.');
  await page.getByRole('button', { name: 'Adicionar transformação' }).click();
  await expect(page.getByRole('rowheader', { name: 'Converter número' })).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  await page.getByRole('button', { name: 'Executar validação' }).click();
  await expect(page.getByText('Nenhum erro encontrado')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  await expect(page.getByRole('region', { name: 'Prévia dos dados' })).toBeVisible();
  const previewTabs = page.getByRole('tablist', { name: 'Filtrar linhas por status' });
  await expect(previewTabs).toBeVisible();
  await expect(previewTabs.getByRole('tab', { name: /Todas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(previewTabs.getByRole('tab', { name: /Com erro/ })).toBeVisible();
  await expect(previewTabs.getByRole('tab', { name: /Válidas/ })).toBeVisible();
  await expect(page.getByText('linhas com erro')).toBeVisible();
  await expect(page.getByText('linhas válidas')).toBeVisible();
  await previewTabs.getByRole('tab', { name: /Válidas/ }).click();
  await expect(previewTabs.getByRole('tab', { name: /Válidas/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Avançar' }).click();

  await page.getByLabel(/Substituir/).check();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible();
  await expect(page.getByText('Inseridos').locator('..').getByText('2')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('radio', { name: 'Não, somente erros' }).check();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar .xlsx' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
});
