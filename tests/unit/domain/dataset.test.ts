import { describe, expect, it } from 'vitest';
import { makeColumnId } from '../../../src/domain/dataset/column-id';
import {
  createSessionStore,
  type SessionState,
} from '../../../src/app/state/session-store';

describe('makeColumnId', () => {
  it('creates stable ids even when headers repeat', () => {
    expect(makeColumnId('Cliente', 0)).toBe('cliente__1');
    expect(makeColumnId('Cliente', 1)).toBe('cliente__2');
  });

  it('normalizes accents and unsafe characters', () => {
    expect(makeColumnId(' Data de Nascimento ', 0)).toBe('data-de-nascimento__1');
  });
});

describe('session store', () => {
  it('resets all session data and releases file and dataset references', () => {
    const store = createSessionStore();
    const dataset = {
      columns: [],
      rows: [],
    };
    const sourceFileBuffer = new ArrayBuffer(8);
    const templateFileBuffer = new ArrayBuffer(8);

    store.setState({
      sourceFileMetadata: { name: 'source.xlsx', size: 8, type: 'application/xlsx' },
      sourceFileBuffer,
      selectedSheets: { source: 'Dados', template: 'Destino' },
      dataset,
      templateMetadata: { name: 'template.xlsx', size: 8, type: 'application/xlsx' },
      templateFileBuffer,
      mappings: [{ sourceColumnId: 'cliente__1', targetColumn: 'Cliente' }],
      transforms: [{ type: 'trim', columnId: 'cliente__1' }],
      validationRules: [{ type: 'required', columnId: 'cliente__1' }],
      writeMode: 'replace',
      workflowStep: 'export',
    });

    store.resetSession();

    expect(store.getState()).toEqual({
      sourceFileMetadata: null,
      sourceFileBuffer: null,
      selectedSheets: { source: null, template: null },
      dataset: null,
      templateMetadata: null,
      templateFileBuffer: null,
      mappings: [],
      transforms: [],
      validationRules: [],
      writeMode: 'append',
      workflowStep: 'source',
    } satisfies SessionState);
  });
});
