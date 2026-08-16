import { expect, test } from '@playwright/test';
import {
  LOAD_ROW_COUNTS,
  generateLoadCsv,
} from '../support/load-generator';

test.describe.configure({ timeout: 240_000 });

for (const rowCount of LOAD_ROW_COUNTS) {
  test(`${rowCount.toLocaleString('en-US')} row load workflow remains responsive and virtualized`, async ({ page }, testInfo) => {
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
    await page.getByLabel(/TabelaDestino/).click();
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
    await page.getByRole('textbox', { name: 'Valor' }).fill('Carga ');

    await startHeartbeat(page);
    await page.getByRole('button', { name: 'Adicionar transformação' }).click();
    const transformResult = page.getByRole('rowheader', { name: 'Prefixo' });
    await waitForOperationOrResult(page, transformResult);
    const cancelButton = page.getByRole('button', { name: 'Cancelar' });
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      await expect(page.locator('.operation-panel')).toBeHidden({ timeout: 60_000 });
      await expect(transformResult).toHaveCount(0);
    } else {
      await expect(transformResult).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: 'Remover' }).click();
    }
    await expect(page.getByText('Nenhuma transformação adicionada.')).toBeVisible();
    await stopHeartbeat(page);

    await startHeartbeat(page);
    timings.transformMs = await elapsed(async () => {
      const heartbeatBaseline = await heartbeatCount(page);
      await page.getByRole('button', { name: 'Adicionar transformação' }).click();
      const transformState = await waitForOperationOrResult(page, page.getByRole('rowheader', { name: 'Prefixo' }));
      if (transformState === 'active') {
        await page.waitForFunction(({ baseline }) => (
          (window as unknown as { __loadHeartbeat?: number }).__loadHeartbeat ?? 0
        ) > baseline, { baseline: heartbeatBaseline });
      }
      await expect(page.getByRole('rowheader', { name: 'Prefixo' })).toBeVisible({ timeout: 60_000 });
    });
    await stopHeartbeat(page);
    await page.getByRole('button', { name: 'Avançar' }).click();

    await startHeartbeat(page);
    timings.validationMs = await elapsed(async () => {
      await page.getByRole('button', { name: 'Executar validação' }).click();
      await expect(page.getByText('Nenhum erro encontrado')).toBeVisible({ timeout: 60_000 });
    });
    await stopHeartbeat(page);
    await page.getByRole('button', { name: 'Avançar' }).click();

    const grid = page.getByRole('region', { name: 'Prévia dos dados' });
    await expect(grid.getByText(`${rowCount} de ${rowCount} linhas`)).toBeVisible();
    const initialDomRows = await grid.locator('.data-grid-row').count();
    expect(initialDomRows).toBeGreaterThan(0);
    expect(initialDomRows).toBeLessThan(100);

    const viewport = grid.locator('.data-grid-viewport');
    const header = grid.locator('.data-grid-header');
    await expect(header).toHaveCSS('min-width', '1192px');
    const horizontalScroll = await viewport.evaluate((element) => Math.min(64, element.scrollWidth - element.clientWidth));
    await viewport.evaluate((element, scrollLeft) => {
      element.scrollLeft = scrollLeft;
      element.dispatchEvent(new Event('scroll'));
    }, horizontalScroll);
    await expect.poll(() => header.evaluate((element) => element.style.transform)).toBe(`translateX(-${horizontalScroll}px)`);

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

async function waitForOperationOrResult(
  page: import('@playwright/test').Page,
  result: import('@playwright/test').Locator,
): Promise<'active' | 'completed'> {
  const operationPanel = page.locator('.operation-panel');
  await expect.poll(async () => {
    if (await result.isVisible().catch(() => false)) return 'completed';
    return (await operationPanel.isVisible().catch(() => false)) ? 'active' : 'pending';
  }, { timeout: 60_000 }).toMatch(/active|completed/);
  return (await result.isVisible().catch(() => false)) ? 'completed' : 'active';
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
