// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, buildRejectedRows, type WorkflowWorker } from '../../../src/app/App';
import { DataGrid } from '../../../src/app/components/DataGrid';
import { ExportSummary } from '../../../src/app/components/ExportSummary';
import { MappingGrid, type ReviewedMapping } from '../../../src/app/components/MappingGrid';
import { applyTransform } from '../../../src/domain/transforms/apply-transform';
import type { Dataset } from '../../../src/domain/dataset/types';
import { planWrite } from '../../../src/domain/merge/plan-write';
import { validateDataset } from '../../../src/domain/validation/validate-row';
import type {
  WorkerInboundMessage,
  WorkerRequest,
  WorkerResponse,
} from '../../../src/workers/protocol';
import type { ExportRisk } from '../../../src/io/template/export-workbook';
import type { WorkbookIndex } from '../../../src/io/template/workbook-index';

const sourceDataset: Dataset = {
  columns: [
    { id: 'id__1', header: 'ID', sourceIndex: 0, detectedType: 'number' },
    { id: 'nome__1', header: 'Nome', sourceIndex: 1, detectedType: 'string' },
  ],
  rows: [
    {
      rowId: 'source-2',
      sourceRowNumber: 2,
      values: { id__1: 1, nome__1: 'Ana' },
      originalValues: { id__1: 1, nome__1: 'Ana' },
    },
    {
      rowId: 'source-3',
      sourceRowNumber: 3,
      values: { id__1: 2, nome__1: 'Bruno' },
      originalValues: { id__1: 2, nome__1: 'Bruno' },
    },
  ],
};

const templateDataset: Dataset = {
  columns: [
    { id: 'id__1', header: 'ID', sourceIndex: 0, detectedType: 'number' },
    { id: 'produto__1', header: 'Produto', sourceIndex: 1, detectedType: 'string' },
    { id: 'quantidade__1', header: 'Quantidade', sourceIndex: 2, detectedType: 'number' },
    { id: 'preco__1', header: 'Preço', sourceIndex: 3, detectedType: 'number' },
  ],
  rows: [
    {
      rowId: 'template-3',
      sourceRowNumber: 3,
      values: { id__1: 1, produto__1: 'Caderno', quantidade__1: 2, preco__1: 15.5 },
      originalValues: { id__1: 1, produto__1: 'Caderno', quantidade__1: 2, preco__1: 15.5 },
    },
  ],
};

const templateIndex: WorkbookIndex = {
  workbookPath: 'xl/workbook.xml',
  workbookProtected: false,
  relationships: [],
  definedNames: [],
  sheets: [{
    name: 'Dados Modelo',
    order: 0,
    sheetId: '1',
    state: 'visible',
    relationshipId: 'rId1',
    path: 'xl/worksheets/sheet1.xml',
    usedRange: 'A1:D5',
    autoFilterRange: 'A2:D5',
    protected: false,
    tables: [{
      id: 1,
      name: 'TabelaDestino',
      displayName: 'TabelaDestino',
      range: 'A2:D5',
      autoFilterRange: 'A2:D5',
      relationshipId: 'rId2',
      path: 'xl/tables/table1.xml',
    }],
    detectedRegions: [],
  }],
};

class FakeWorker implements WorkflowWorker {
  public onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  public readonly requests: WorkerRequest[] = [];

  public constructor(private readonly exportRisks: ExportRisk[] = []) {}

  public postMessage(message: WorkerInboundMessage): void {
    if (message.type === 'CANCEL_OPERATION') {
      this.emit({ type: 'CANCELLED', operationId: message.operationId });
      return;
    }

    this.requests.push(message);
    this.emit({
      type: 'PROGRESS',
      operationId: message.operationId,
      completed: 1,
      total: 1,
      phase: message.type === 'IMPORT_SOURCE' ? 'import' : message.type === 'APPLY_TRANSFORMS'
        ? 'transform' : message.type === 'VALIDATE' ? 'validate' : message.type === 'PLAN_WRITE'
          ? 'plan' : 'export',
    });

    const result = (() => {
      switch (message.type) {
        case 'IMPORT_SOURCE':
          return {
            type: 'IMPORT_SOURCE' as const,
            dataset: message.operationId.startsWith('template') ? templateDataset : sourceDataset,
          };
        case 'LIST_SOURCE_SHEETS':
          return { type: 'LIST_SOURCE_SHEETS' as const, sheetNames: ['Dados'] };
        case 'INDEX_TEMPLATE':
          return { type: 'INDEX_TEMPLATE' as const, index: templateIndex };
        case 'EXTRACT_DESTINATION':
          return { type: 'EXTRACT_DESTINATION' as const, dataset: templateDataset };
        case 'APPLY_TRANSFORMS':
          return {
            type: 'APPLY_TRANSFORMS' as const,
            dataset: message.commands.reduce(applyTransform, message.dataset),
          };
        case 'VALIDATE':
          return {
            type: 'VALIDATE' as const,
            validationResult: validateDataset(message.dataset, message.rules),
          };
        case 'PLAN_WRITE':
          return { type: 'PLAN_WRITE' as const, writePlan: planWrite(message.input) };
        case 'SCAN_EXPORT_RISKS':
          return { type: 'EXPORT_RISKS' as const, risks: this.exportRisks };
        case 'EXPORT':
          return { type: 'EXPORT' as const, buffer: new ArrayBuffer(16) };
      }
    })();

    this.emit({ type: 'RESULT', operationId: message.operationId, result });
  }

  public terminate(): void {}

  private emit(response: WorkerResponse): void {
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>));
  }
}

class ControlledWorker implements WorkflowWorker {
  public onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  public readonly requests: WorkerRequest[] = [];

  public postMessage(message: WorkerInboundMessage): void {
    if (message.type !== 'CANCEL_OPERATION') this.requests.push(message);
  }

  public emit(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  public terminate(): void {}
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function templateFile(name = 'modelo.xlsx'): Promise<File> {
  const bytes = await readFile('src/test-fixtures/workbooks/template-structured.xlsx');
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function importSource(user: ReturnType<typeof userEvent.setup>, name = 'origem.csv') {
  await user.upload(
    screen.getByLabelText('Selecionar arquivo de origem'),
    new File(['ID;Nome\n1;Ana\n'], name, { type: 'text/csv' }),
  );
  await screen.findByText(name);
}

async function chooseTemplate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  await user.upload(screen.getByLabelText('Selecionar arquivo modelo'), await templateFile());
  await user.selectOptions(await screen.findByLabelText('Aba do modelo'), 'Dados Modelo');
  await screen.findByText('Dados Modelo selecionada');
}

async function chooseDestination(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  await user.click(screen.getByLabelText(/TabelaDestino/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
}

async function prepareSummary(
  user: ReturnType<typeof userEvent.setup>,
  mode: 'replace' | 'update' = 'replace',
) {
  await importSource(user);
  await chooseTemplate(user);
  await chooseDestination(user);
  await user.click(screen.getByRole('button', { name: 'Aceitar ID' }));
  await user.click(screen.getByRole('button', { name: 'Ignorar Nome' }));
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  await user.click(screen.getByRole('button', { name: 'Executar validação' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  if (mode === 'update') {
    await user.click(screen.getByRole('radio', { name: /Atualizar/ }));
    await user.click(screen.getByRole('checkbox', { name: 'ID' }));
  }
  await user.click(screen.getByRole('button', { name: 'Avançar' }));
  await screen.findByText('Inseridos');
}

describe('workflow navigation', () => {
  it('guards required steps and preserves imported files when navigating back', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    const workerFactory = () => worker;
    render(<App workerFactory={workerFactory} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();

    await importSource(user);
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeEnabled();
    await chooseTemplate(user);

    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.getByRole('heading', { name: 'Destino' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();

    await user.click(screen.getByLabelText(/TabelaDestino/));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('modelo.xlsx')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('origem.csv')).toBeInTheDocument();
    expect(worker.requests.filter(({ type }) => type === 'IMPORT_SOURCE')).toHaveLength(1);
  });

  it('changes a source without discarding the independent model selection', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    const workerFactory = () => worker;
    render(<App workerFactory={workerFactory} />);

    await importSource(user);
    await chooseTemplate(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByLabelText(/TabelaDestino/));
    await user.click(screen.getByRole('button', { name: 'Origem' }));
    await importSource(user, 'origem-revisada.csv');

    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.getByText('modelo.xlsx')).toBeInTheDocument();
    expect(screen.getByText('Dados Modelo selecionada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.getByRole('table', { name: 'Revisão de mapeamentos' })).toBeInTheDocument();
    expect(screen.getAllByText('Revisão necessária').length).toBeGreaterThan(0);
  });

  it('ignores a stale worker response after a source reselection', async () => {
    const user = userEvent.setup();
    const worker = new ControlledWorker();
    render(<App workerFactory={() => worker} />);

    await user.upload(
      screen.getByLabelText('Selecionar arquivo de origem'),
      new File(['ID;Nome\n1;Ana\n'], 'primeira.csv', { type: 'text/csv' }),
    );
    await waitFor(() => expect(worker.requests).toHaveLength(1));
    const firstRequest = worker.requests[0];
    worker.emit({ type: 'RESULT', operationId: firstRequest.operationId, result: { type: 'IMPORT_SOURCE', dataset: sourceDataset } });
    await screen.findByText('primeira.csv');

    await user.upload(
      screen.getByLabelText('Selecionar arquivo de origem'),
      new File(['ID;Nome\n2;Bruno\n'], 'segunda.csv', { type: 'text/csv' }),
    );
    await waitFor(() => expect(worker.requests).toHaveLength(2));
    const secondRequest = worker.requests[1];
    worker.emit({ type: 'RESULT', operationId: firstRequest.operationId, result: { type: 'IMPORT_SOURCE', dataset: sourceDataset } });
    expect(screen.getByText('primeira.csv')).toBeInTheDocument();
    worker.emit({ type: 'RESULT', operationId: secondRequest.operationId, result: { type: 'IMPORT_SOURCE', dataset: sourceDataset } });
    await screen.findByText('segunda.csv');
  });

  it('clears dependent destination state when replacing the model', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker} />);

    await importSource(user);
    await chooseTemplate(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByLabelText(/TabelaDestino/));
    await user.click(screen.getByRole('button', { name: 'Origem' }));
    await user.click(screen.getByRole('button', { name: 'Modelo' }));
    await user.upload(screen.getByLabelText('Selecionar arquivo modelo'), await templateFile('modelo-novo.xlsx'));

    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Origem' }));
    expect(screen.getByText('origem.csv')).toBeInTheDocument();
    expect(screen.queryByText('Dados Modelo selecionada')).not.toBeInTheDocument();
  });

  it('requires mapping review after a schema-changing transform adds a column', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker} />);

    await importSource(user);
    await chooseTemplate(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByLabelText(/TabelaDestino/));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Aceitar ID' }));
    await user.click(screen.getByRole('button', { name: 'Ignorar Nome' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    await user.selectOptions(screen.getByLabelText('Tipo de transformação'), 'calculatedColumn');
    await user.clear(screen.getByLabelText('Nome da nova coluna'));
    await user.type(screen.getByLabelText('Nome da nova coluna'), 'Código');
    await user.click(screen.getByRole('button', { name: 'Adicionar transformação' }));
    await user.click(screen.getByRole('button', { name: 'Mapeamento' }));

    expect(screen.getByText('Código')).toBeInTheDocument();
    expect(screen.getAllByText('Revisão necessária').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });

  it('blocks duplicate destinations even after both mappings are accepted', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker} />);

    await importSource(user);
    await chooseTemplate(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByLabelText(/TabelaDestino/));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.selectOptions(screen.getByLabelText('Destino para Nome'), 'id__1');
    await user.click(screen.getByRole('button', { name: 'Aceitar Nome' }));

    expect(screen.getAllByText(/Conflito: destino duplicado/)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });

  it('offers only accepted mapped columns as update keys', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker} />);

    await importSource(user);
    await chooseTemplate(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByLabelText(/TabelaDestino/));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Aceitar ID' }));
    await user.click(screen.getByRole('button', { name: 'Ignorar Nome' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Executar validação' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('radio', { name: /Atualizar/ }));

    expect(screen.getByRole('checkbox', { name: 'ID' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Nome' })).not.toBeInTheDocument();
  });
});

describe('mapping and summary invariants', () => {
  it('surfaces duplicate destination conflicts in the mapping grid', () => {
    const sourceColumns = sourceDataset.columns;
    const destinationColumns = templateDataset.columns;
    const mappings: ReviewedMapping[] = sourceColumns.map((column) => ({
      sourceColumnId: column.id,
      destinationColumnId: 'id__1',
      confidence: 'exact',
      score: 1,
      status: 'accepted',
      action: 'map',
    }));

    render(<MappingGrid
      sourceColumns={sourceColumns}
      destinationColumns={destinationColumns}
      mappings={mappings}
      onChange={() => undefined}
    />);

    expect(screen.getAllByText('Conflito: destino duplicado')).toHaveLength(2);
  });

  it('counts effective actions and distinct rejected rows', () => {
    render(<ExportSummary
      plan={{
        mode: 'update',
        headerRow: 2,
        clears: [],
        inserts: [
          { incomingRowId: 'row-1', destinationRow: 3, values: {} },
          { incomingRowId: 'row-2', destinationRow: 4, values: {} },
        ],
        updates: [{ incomingRowId: 'row-3', existingRowId: 'existing-3', destinationRow: 5, values: {} }],
        kept: [{ incomingRowId: 'row-4', existingRowId: 'existing-4', destinationRow: 6 }],
        duplicates: [{ scope: 'incoming', keyColumnIds: ['id__1'], keyValues: [1], rowIds: ['row-5', 'row-5'] }],
        rejected: [{ incomingRowId: 'row-5', reason: 'incoming-duplicate-key', keyColumnIds: ['id__1'], keyValues: [1] }],
        assignments: [],
      }}
      validationIssues={[
        { rowId: 'row-2', sourceRowNumber: 3, columnId: 'id__1', code: 'required', value: null, message: 'Obrigatório' },
        { rowId: 'row-2', sourceRowNumber: 3, columnId: 'nome__1', code: 'type', value: null, message: 'Tipo' },
        { rowId: 'row-6', sourceRowNumber: 7, columnId: 'id__1', code: 'required', value: null, message: 'Obrigatório' },
      ]}
    />);

    expect(within(screen.getByText('Inseridos').parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByText('Atualizados').parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByText('Mantidos').parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByText('Duplicados').parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByText('Rejeitados').parentElement as HTMLElement).getByText('3')).toBeInTheDocument();
  });

  it('builds rejection rows from validation and planner rejections with original values', () => {
    const rows = buildRejectedRows(
      sourceDataset,
      {
        isValid: false,
        issues: [{
          rowId: 'source-2', sourceRowNumber: 2, columnId: 'nome__1', code: 'required', value: '', message: 'Nome obrigatório',
        }],
      },
      {
        mode: 'update', headerRow: 2, clears: [], inserts: [], updates: [], kept: [], duplicates: [], assignments: [],
        rejected: [{
          incomingRowId: 'source-3', reason: 'missing-update-key', keyColumnIds: ['id__1'], keyValues: [null],
        }],
      },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        sourceRowNumber: 2,
        originalRelevantFields: { id__1: 1, nome__1: 'Ana' },
        rejectionReason: 'Nome obrigatório',
        failedRuleOrTransform: 'required',
      }),
      expect.objectContaining({
        sourceRowNumber: 3,
        originalRelevantFields: { id__1: 2, nome__1: 'Bruno' },
        rejectionReason: 'Chave de atualização ausente.',
        failedRuleOrTransform: 'missing-update-key',
      }),
    ]);
  });
});

describe('final export safeguards', () => {
  it('uses one fixed-value dataset for validation and write planning', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker} />);

    await importSource(user);
    await chooseTemplate(user);
    await chooseDestination(user);
    await user.click(screen.getByRole('button', { name: 'Aceitar ID' }));
    await user.selectOptions(screen.getByLabelText('Destino para Nome'), 'produto__1');
    await user.click(screen.getByRole('button', { name: 'Usar valor fixo Nome' }));
    await user.type(screen.getByLabelText('Valor fixo para Nome'), 'Constante');
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Executar validação' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    const validation = worker.requests.find(({ type }) => type === 'VALIDATE');
    const plan = worker.requests.find(({ type }) => type === 'PLAN_WRITE');
    expect(validation?.type === 'VALIDATE' && validation.dataset.rows[0].values.nome__1).toBe('Constante');
    expect(plan?.type === 'PLAN_WRITE' && plan.input.incoming.rows[0].values.nome__1).toBe('Constante');
  });

  it('invalidates an update plan immediately when key columns change', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker();
    render(<App workerFactory={() => worker} />);

    await prepareSummary(user, 'update');
    await user.click(screen.getByRole('button', { name: 'Modo de gravação' }));
    await user.click(screen.getByRole('checkbox', { name: 'ID' }));
    await user.click(screen.getByRole('button', { name: 'Resumo' }));

    expect(screen.queryByText('Inseridos')).not.toBeInTheDocument();
  });

  it('shows worker export risks and requires explicit soft-risk confirmation', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker([{
      code: 'formula-overwrite',
      severity: 'soft',
      message: 'Uma fórmula será sobrescrita.',
      partPath: 'xl/worksheets/sheet1.xml',
    }]);
    render(<App workerFactory={() => worker} />);

    await prepareSummary(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(await screen.findByText('Uma fórmula será sobrescrita.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar .xlsx' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Confirmar risco formula-overwrite/ }));
    expect(screen.getByRole('button', { name: 'Exportar .xlsx' })).toBeEnabled();
  });

  it('displays hard risks and keeps export blocked', async () => {
    const user = userEvent.setup();
    const worker = new FakeWorker([{
      code: 'protected-destination-sheet',
      severity: 'hard',
      message: 'A aba está protegida.',
    }]);
    render(<App workerFactory={() => worker} />);

    await prepareSummary(user);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(await screen.findByText('A aba está protegida.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar .xlsx' })).toBeDisabled();
  });
});

describe('virtualized preview grid', () => {
  it('renders a window, filters by issue metadata, and dispatches direct edits', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      rowId: `row-${index}`,
      sourceRowNumber: index + 2,
      values: { id__1: index, nome__1: `Pessoa ${index}` },
      originalValues: { id__1: index, nome__1: `Pessoa ${index}` },
    }));
    const dataset = { ...sourceDataset, rows };
    const onEdit = vi.fn();
    render(<DataGrid
      dataset={dataset}
      issues={[{
        rowId: 'row-150',
        sourceRowNumber: 152,
        columnId: 'nome__1',
        code: 'required',
        value: '',
        message: 'Obrigatório',
      }]}
      onEdit={onEdit}
    />);

    expect(screen.getAllByRole('row').length).toBeLessThan(30);
    fireEvent.click(screen.getByLabelText('Mostrar somente erros'));
    const input = await screen.findByDisplayValue('Pessoa 150');
    const errorRow = input.closest('[role="row"]');
    expect(errorRow).not.toBeNull();
    const scopedInput = within(errorRow as HTMLElement).getByDisplayValue('Pessoa 150');
    fireEvent.change(scopedInput, { target: { value: 'Corrigida' } });
    fireEvent.blur(scopedInput);

    expect(onEdit).toHaveBeenCalledWith({
      type: 'editCell',
      rowId: 'row-150',
      columnId: 'nome__1',
      value: 'Corrigida',
    });
    expect(scopedInput).toHaveAttribute('aria-invalid', 'true');
  });
});
