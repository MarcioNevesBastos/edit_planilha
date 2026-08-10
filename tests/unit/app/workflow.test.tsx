// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type WorkflowWorker } from '../../../src/app/App';
import { DataGrid } from '../../../src/app/components/DataGrid';
import { applyTransform } from '../../../src/domain/transforms/apply-transform';
import type { Dataset } from '../../../src/domain/dataset/types';
import { planWrite } from '../../../src/domain/merge/plan-write';
import { validateDataset } from '../../../src/domain/validation/validate-row';
import type {
  WorkerInboundMessage,
  WorkerRequest,
  WorkerResponse,
} from '../../../src/workers/protocol';

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

class FakeWorker implements WorkflowWorker {
  public onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  public readonly requests: WorkerRequest[] = [];

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function templateFile(): Promise<File> {
  const bytes = await readFile('src/test-fixtures/workbooks/template-structured.xlsx');
  return new File([bytes], 'modelo.xlsx', {
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
    expect(screen.getByText('Revisão necessária')).toBeInTheDocument();
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
