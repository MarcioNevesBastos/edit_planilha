import type { Dataset } from '../../domain/dataset/types';

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
}

export interface SelectedSheets {
  source: string | null;
  template: string | null;
}

export type WriteMode = 'append' | 'replace';
export type BaseMode = 'external' | 'source' | 'none';

export type WorkflowStep =
  | 'source'
  | 'dataset'
  | 'template'
  | 'mapping'
  | 'transforms'
  | 'validation'
  | 'write'
  | 'export';

export interface SessionState {
  baseMode: BaseMode;
  sourceFileMetadata: FileMetadata | null;
  sourceFileBuffer: ArrayBuffer | null;
  selectedSheets: SelectedSheets;
  dataset: Dataset | null;
  templateMetadata: FileMetadata | null;
  templateFileBuffer: ArrayBuffer | null;
  mappings: unknown[];
  transforms: unknown[];
  validationRules: unknown[];
  writeMode: WriteMode;
  workflowStep: WorkflowStep;
}

export interface SessionStore {
  getState(): SessionState;
  setState(update: Partial<SessionState>): void;
  resetSession(): void;
  subscribe(listener: (state: SessionState) => void): () => void;
}

export const initialSessionState: SessionState = {
  baseMode: 'external',
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
};

function createInitialState(): SessionState {
  return {
    ...initialSessionState,
    selectedSheets: { ...initialSessionState.selectedSheets },
    mappings: [],
    transforms: [],
    validationRules: [],
  };
}

export function createSessionStore(): SessionStore {
  let state = createInitialState();
  const listeners = new Set<(state: SessionState) => void>();

  const notify = () => {
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    setState: (update) => {
      state = { ...state, ...update };
      notify();
    },
    resetSession: () => {
      state = createInitialState();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
