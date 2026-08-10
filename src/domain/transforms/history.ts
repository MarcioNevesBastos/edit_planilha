import type { CellValue, DataRow, Dataset } from '../dataset/types';
import { applyTransform } from './apply-transform';
import type { TransformCommand } from './types';

type Inverse =
  | { type: 'noop' }
  | {
    type: 'restoreCells';
    cells: Array<{ rowId: string; columnId: string; value: CellValue }>;
    columnMetadata?: Array<{ columnId: string; detectedType: Dataset['columns'][number]['detectedType'] }>;
  }
  | { type: 'restoreRows'; rows: Array<{ index: number; row: DataRow }> }
  | { type: 'restoreRowOrder'; rowIds: string[] }
  | { type: 'restoreColumnOrder'; columnIds: string[] }
  | { type: 'restoreHeader'; columnId: string; header: string }
  | { type: 'removeColumns'; columnIds: string[] };

interface HistoryEntry {
  command: TransformCommand;
  inverse: Inverse;
}

function changedCells(before: Dataset, after: Dataset): Array<{ rowId: string; columnId: string; value: CellValue }> {
  const afterRows = new Map(after.rows.map((row) => [row.rowId, row]));
  return before.rows.flatMap((row) => {
    const next = afterRows.get(row.rowId);
    if (!next) return [];
    return before.columns.flatMap((column) => Object.is(row.values[column.id], next.values[column.id])
      ? []
      : [{ rowId: row.rowId, columnId: column.id, value: row.values[column.id] }]);
  });
}

function inverseFor(before: Dataset, after: Dataset, command: TransformCommand): Inverse {
  switch (command.type) {
    case 'reorderColumns': return { type: 'restoreColumnOrder', columnIds: before.columns.map((column) => column.id) };
    case 'sort': return { type: 'restoreRowOrder', rowIds: before.rows.map((row) => row.rowId) };
    case 'filter':
    case 'removeEmptyRows':
    case 'deduplicate': {
      const retained = new Set(after.rows.map((row) => row.rowId));
      return { type: 'restoreRows', rows: before.rows.flatMap((row, index) => retained.has(row.rowId) ? [] : [{ index, row }]) };
    }
    case 'renameHeader': return { type: 'restoreHeader', columnId: command.columnId, header: before.columns.find((column) => column.id === command.columnId)!.header };
    case 'splitColumn': return { type: 'removeColumns', columnIds: command.newColumns.map((column) => column.id) };
    case 'combineColumns': return { type: 'removeColumns', columnIds: [command.newColumn.id] };
    case 'calculatedColumn': return { type: 'removeColumns', columnIds: [command.newColumn.id] };
    case 'dateConversion':
    case 'numberConversion':
    case 'currencyConversion': return {
      type: 'restoreCells',
      cells: changedCells(before, after),
      columnMetadata: [{
        columnId: command.columnId,
        detectedType: before.columns.find((column) => column.id === command.columnId)!.detectedType,
      }],
    };
    default: return { type: 'restoreCells', cells: changedCells(before, after) };
  }
}

function restoreRows(dataset: Dataset, rows: Array<{ index: number; row: DataRow }>): Dataset {
  const nextRows = [...dataset.rows];
  for (const { index, row } of [...rows].sort((left, right) => left.index - right.index)) {
    nextRows.splice(index, 0, { ...row, values: { ...row.values }, originalValues: { ...row.originalValues } });
  }
  return { ...dataset, rows: nextRows };
}

function applyInverse(dataset: Dataset, inverse: Inverse): Dataset {
  switch (inverse.type) {
    case 'noop': return dataset;
    case 'restoreCells': {
      const valuesByRow = new Map<string, Record<string, CellValue>>();
      for (const cell of inverse.cells) {
        valuesByRow.set(cell.rowId, { ...(valuesByRow.get(cell.rowId) ?? {}), [cell.columnId]: cell.value });
      }
      const metadataByColumn = new Map(inverse.columnMetadata?.map((column) => [column.columnId, column.detectedType]));
      return {
        columns: dataset.columns.map((column) => metadataByColumn.has(column.id) ? { ...column, detectedType: metadataByColumn.get(column.id)! } : column),
        rows: dataset.rows.map((row) => valuesByRow.has(row.rowId) ? { ...row, values: { ...row.values, ...valuesByRow.get(row.rowId) } } : row),
      };
    }
    case 'restoreRows': return restoreRows(dataset, inverse.rows);
    case 'restoreRowOrder': {
      const rowsById = new Map(dataset.rows.map((row) => [row.rowId, row]));
      return { ...dataset, rows: inverse.rowIds.map((rowId) => rowsById.get(rowId)!).filter(Boolean) };
    }
    case 'restoreColumnOrder': {
      const columnsById = new Map(dataset.columns.map((column) => [column.id, column]));
      return { ...dataset, columns: inverse.columnIds.map((columnId) => columnsById.get(columnId)!).filter(Boolean) };
    }
    case 'restoreHeader': return { ...dataset, columns: dataset.columns.map((column) => column.id === inverse.columnId ? { ...column, header: inverse.header } : column) };
    case 'removeColumns': {
      const removed = new Set(inverse.columnIds);
      return {
        columns: dataset.columns.filter((column) => !removed.has(column.id)),
        rows: dataset.rows.map((row) => ({ ...row, values: Object.fromEntries(Object.entries(row.values).filter(([columnId]) => !removed.has(columnId))) as Record<string, CellValue> })),
      };
    }
  }
}

export class TransformHistory {
  private state: Dataset;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  public constructor(dataset: Dataset) {
    this.state = dataset;
  }

  public get current(): Dataset {
    return this.state;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public execute(command: TransformCommand): Dataset {
    const next = applyTransform(this.state, command);
    this.undoStack.push({ command, inverse: inverseFor(this.state, next, command) });
    this.redoStack.splice(0);
    this.state = next;
    return this.state;
  }

  public undo(): Dataset {
    const entry = this.undoStack.pop();
    if (!entry) return this.state;
    this.state = applyInverse(this.state, entry.inverse);
    this.redoStack.push(entry);
    return this.state;
  }

  public redo(): Dataset {
    const entry = this.redoStack.pop();
    if (!entry) return this.state;
    this.state = applyTransform(this.state, entry.command);
    this.undoStack.push(entry);
    return this.state;
  }
}
