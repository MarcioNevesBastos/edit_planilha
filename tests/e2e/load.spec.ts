import { expect, test } from '@playwright/test';
import {
  LOAD_ROW_COUNTS,
  generateLoadCsv,
} from '../support/load-generator';

test.describe.configure({ timeout: 240_000 });

for (const rowCount of LOAD_ROW_COUNTS) {
  test(`${rowCount.toLocaleString('en-US')} rows remain progressive, cancellable, and virtualized`, async ({ page }, testInfo) => {
    const timings: Record<string, number> = {};

    await page.goto('/app.html');

    timings.importMs = await elapsed(async () => {
      await page.getByLabel('Selecionar arquivo de origem').setInputFiles({
        name: `load-${rowCount}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(generateLoadCsv(rowCount)),
      });
      await expect(page.locator('.dataset-facts').getByText(String(rowCount), { exact: true })).toBeVisible();
    });

    await page.getByRole('button', { name: 'Avançar' }).click();
    await page.getByLabel('Selecionar arquivo modelo').setInputFiles(
      'src/test-fixtures/workbooks/template-structured.xlsx',
    );
    await page.getByLabel('Aba do modelo').selectOption('Dados Modelo');
    await page.getByRole('button', { name: 'Avançar' }).click();
    await page.getByLabel(/TabelaDestino/).check();
    await page.getByRole('button', { name: 'Avançar' }).click();

    for (const header of ['ID', 'Produto', 'Quantidade', 'Preço']) {
      await page.getByRole('button', { name: `Aceitar ${header}` }).click();
    }
    for (const header of ['Ativo', 'Data', 'Observação']) {
      await page.getByRole('button', { name: `Ignorar ${header}` }).click();
    }
    await page.getByRole('button', { name: 'Avançar' }).click();

    await page.getByLabel('Tipo de transformação').selectOption('prefix');
    await page.getByLabel('Coluna principal').selectOption({ label: 'Produto' });
    await page.getByLabel('Valor').fill('Carga ');

    if (rowCount === 100_000) {
      await startHeartbeat(page);
      await page.getByRole('button', { name: 'Adicionar transformação' }).click();
      await expect(page.getByText('transform', { exact: true })).toBeVisible();
      await expect.poll(() => heartbeatCount(page)).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.locator('.operation-panel')).toBeHidden();
      await expect(page.getByText('Nenhuma transformação adicionada.')).toBeVisible();
      await stopHeartbeat(page);
    }

    await startHeartbeat(page);
    timings.transformMs = await elapsed(async () => {
      await page.getByRole('button', { name: 'Adicionar transformação' }).click();
      await expect(page.getByText('transform', { exact: true })).toBeVisible();
      await expect.poll(() => heartbeatCount(page)).toBeGreaterThan(0);
      await expect(page.getByRole('listitem').filter({ hasText: 'Adicionar prefixo' })).toBeVisible();
    });
    await stopHeartbeat(page);
    await page.getByRole('button', { name: 'Avançar' }).click();

    await startHeartbeat(page);
    timings.validationMs = await elapsed(async () => {
      await page.getByRole('button', { name: 'Executar validação' }).click();
      await expect(page.getByText('validate', { exact: true })).toBeVisible();
      await expect.poll(() => heartbeatCount(page)).toBeGreaterThan(0);
      await expect(page.getByText('Nenhum erro encontrado')).toBeVisible();
    });
    await stopHeartbeat(page);
    await page.getByRole('button', { name: 'Avançar' }).click();

    const grid = page.getByRole('region', { name: 'Prévia dos dados' });
    await expect(grid.getByText(`${rowCount} de ${rowCount} linhas`)).toBeVisible();
    const initialDomRows = await grid.locator('.data-grid-row').count();
    expect(initialDomRows).toBeGreaterThan(0);
    expect(initialDomRows).toBeLessThan(100);

    const viewport = grid.locator('.data-grid-viewport');
    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(grid.getByRole('rowheader', { name: String(rowCount + 1) })).toBeVisible();
    expect(await grid.locator('.data-grid-row').count()).toBeLessThan(100);

    await testInfo.attach(`load-${rowCount}-timings.json`, {
      body: Buffer.from(JSON.stringify({ rowCount, ...timings }, null, 2)),
      contentType: 'application/json',
    });
  });
}

async function elapsed(action: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await action();
  return Math.round(performance.now() - startedAt);
}

async function startHeartbeat(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as {
      __loadHeartbeat?: number;
      __loadHeartbeatTimer?: number;
    };
    state.__loadHeartbeat = 0;
    state.__loadHeartbeatTimer = window.setInterval(() => {
      state.__loadHeartbeat = (state.__loadHeartbeat ?? 0) + 1;
    }, 0);
  });
}

async function heartbeatCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (
    window as unknown as { __loadHeartbeat?: number }
  ).__loadHeartbeat ?? 0);
}

async function stopHeartbeat(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as {
      __loadHeartbeatTimer?: number;
    };
    if (state.__loadHeartbeatTimer !== undefined) {
      window.clearInterval(state.__loadHeartbeatTimer);
    }
  });
}
