import type { Dataset } from '../../domain/dataset/types';

export interface ReadSourceOptions {
  delimiter?: string;
  maxCells?: number;
  sheetName?: string;
}

export interface SourceReadIssue {
  code: string;
  details?: Record<string, number>;
  message: string;
  row?: number;
}

export class SourceReadError extends Error {
  constructor(public readonly issues: SourceReadIssue[]) {
    super(issues.map((issue) => issue.message).join('; '));
    this.name = 'SourceReadError';
  }
}

export type SourceReader = (file: File, options?: ReadSourceOptions) => Promise<Dataset>;
