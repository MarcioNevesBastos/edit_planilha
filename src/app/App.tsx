import * as XLSX from 'xlsx';
import React from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CellValue, Dataset, DatasetColumn } from '../domain/dataset/types';
import { makeColumnId } from '../domain/dataset/column-id';
import { suggestMappings } from '../domain/mapping/suggest-mappings';
import type { WriteMode, WritePlan } from '../domain/merge/types';
import type { Expression, FilterOperator, TransformCommand, TransformConditionNode, TransformConditionOperator } from '../domain/transforms/types';
import { detectDateFormats, detectDecimalSeparator, getSuggestedDelimiters } from '../domain/transforms/transform-values';
import { validateDataset } from '../domain/validation/validate-row';
import { validateConditionalMatrixRule } from '../domain/validation/matrix';
import type { ValidationIssue, ValidationResult, ValidationRule } from '../domain/validation/types';
import {
  destinationDetectionWarnings,
  detectDestination,
  type DestinationCandidate,
} from '../io/template/destination-detector';
import {
  exportRiskIdentifier,
  type ExportDestination,
  type ExportRisk,
} from '../io/template/export-workbook';
import type { RejectedSheetRow } from '../io/template/rejected-sheet';
import type { WorkbookIndex } from '../io/template/workbook-index';
import {
  transferablesForRequest,
  type WorkerInboundMessage,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResult,
} from '../workers/protocol';
import { DataGrid } from './components/DataGrid';
import { ExportSummary } from './components/ExportSummary';
import { FileDrop } from './components/FileDrop';
import {
  MappingGrid,
  type ReviewedMapping,
} from './components/MappingGrid';
import { Stepper, type WorkflowStepDefinition } from './components/Stepper';
import { ValidationPanel } from './components/ValidationPanel';
import { ConditionBuilder } from './components/ConditionBuilder';
import { ValuePicker } from './components/ValuePicker';
import { createSessionStore, type FileMetadata } from './state/session-store';

const STEPS = [
  { id: 'source', label: 'Origem' },
  { id: 'template', label: 'Modelo' },
  { id: 'destination', label: 'Destino' },
  { id: 'mapping', label: 'Mapeamento' },
  { id: 'transforms', label: 'Transformações' },
  { id: 'validation', label: 'Validação' },
  { id: 'preview', label: 'Prévia' },
  { id: 'write', label: 'Modo de gravação' },
  { id: 'summary', label: 'Resumo' },
  { id: 'export', label: 'Exportar' },
] as const satisfies readonly WorkflowStepDefinition[];

const STEP_DESCRIPTIONS = [
  'Importe a planilha que contém os dados a preparar.',
  'Escolha o arquivo modelo sem alterar o original.',
  'Confirme a aba e a faixa que receberão os dados.',
  'Revise cada sugestão antes de continuar.',
  'Monte uma sequência reproduzível de ajustes.',
  'Revise regras detectadas, adicione regras e corrija erros.',
  'Confira os dados finais e edite células pontualmente.',
  'Defina como os registros serão gravados no modelo.',
  'Confira as contagens exatas antes da exportação.',
  'Gere uma nova planilha .xlsx localmente.',
] as const;

const TRANSFORM_LABELS: Record<TransformCommand['type'], string> = {
  reorderColumns: 'Reordenar colunas',
  sort: 'Ordenar',
  filter: 'Filtrar',
  removeEmptyRows: 'Remover linhas vazias',
  deduplicate: 'Remover duplicados',
  renameHeader: 'Renomear cabeçalho',
  splitColumn: 'Dividir coluna',
  combineColumns: 'Combinar colunas',
  findReplace: 'Localizar e substituir',
  dateConversion: 'Converter data',
  numberConversion: 'Converter número',
  currencyConversion: 'Converter moeda',
  prefix: 'Prefixo',
  suffix: 'Sufixo',
  fixedValue: 'Valor fixo',
  calculatedColumn: 'Coluna calculada',
  conditionalRule: 'Regra condicional',
  editCell: 'Edição direta',
};

export interface WorkflowWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  postMessage(message: WorkerInboundMessage, transfer?: Transferable[]): void;
  terminate(): void;
}

interface AppProps {
  workerFactory?: () => WorkflowWorker;
}

interface ActiveOperation {
  operationId: string;
  label: string;
  completed: number;
  total: number;
  phase: string;
}

interface PendingOperation {
  operationId?: string;
  onResult(result: WorkerResult): void;
  onCancelled?(): void;
  onError?(message: string): void;
}

interface CommandHistory {
  past: TransformCommand[][];
  future: TransformCommand[][];
}

function defaultWorkerFactory(): WorkflowWorker {
  return new Worker(new URL('../workers/data-worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkflowWorker;
}

function metadata(file: File): FileMetadata {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  };
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function rangeRows(reference: string): { headerRow: number; dataStartRow: number; templateRow: number } {
  const range = XLSX.utils.decode_range(reference.replace(/\$/g, ''));
  return {
    headerRow: range.s.r + 1,
    dataStartRow: range.s.r + 2,
    templateRow: Math.max(range.s.r + 2, range.e.r + 1),
  };
}

function detectedValidationRules(
  sourceColumns: readonly DatasetColumn[],
  templateColumns: readonly DatasetColumn[],
  mappings: readonly ReviewedMapping[],
): ValidationRule[] {
  return mappings.flatMap((mapping) => {
    if (mapping.destinationColumnId === null || mapping.action === 'ignore') return [];
    const source = sourceColumns.find(({ id }) => id === mapping.sourceColumnId);
    const destination = templateColumns.find(({ id }) => id === mapping.destinationColumnId);
    if (!source || !destination || destination.detectedType === 'mixed' || destination.detectedType === 'empty') return [];
    const valueType = destination.detectedType === 'date' ? 'date' : destination.detectedType;
    return [{ type: 'type' as const, columnId: source.id, valueType }];
  });
}

function acceptedMappings(mappings: readonly ReviewedMapping[]) {
  return mappings.map(({ action, fixedValue, ...mapping }) => ({
    ...mapping,
    destinationColumnId: action === 'ignore' ? null : mapping.destinationColumnId,
    status: 'accepted' as const,
  }));
}

function reconcileMappings(
  sourceColumns: readonly DatasetColumn[],
  destinationColumns: readonly DatasetColumn[],
  previous: readonly ReviewedMapping[],
): ReviewedMapping[] {
  const previousBySource = new Map(previous.map((mapping) => [mapping.sourceColumnId, mapping]));
  return suggestMappings(sourceColumns, destinationColumns).map((suggestion) => {
    const existing = previousBySource.get(suggestion.sourceColumnId);
    if (existing) return existing;
    return {
      ...suggestion,
      action: 'map' as const,
      status: 'review-required' as const,
    };
  });
}

function changedSchema(previous: Dataset, next: Dataset): boolean {
  return previous.columns.length !== next.columns.length
    || previous.columns.some((column, index) => {
      const nextColumn = next.columns[index];
      return !nextColumn || column.id !== nextColumn.id || column.header !== nextColumn.header;
    });
}

function validationRuleUsesOnlyColumns(rule: ValidationRule, columnIds: ReadonlySet<string>): boolean {
  if (rule.type === 'conditionalMatrix') {
    return [...rule.keyColumnIds, ...rule.dependentColumnIds].every((columnId) => columnIds.has(columnId))
      && rule.entries.every((entry) => Object.keys(entry.conditions).every((columnId) => columnIds.has(columnId))
        && Object.keys(entry.constraints).every((columnId) => columnIds.has(columnId)));
  }
  if (rule.type === 'compositeUnique') return rule.columnIds.every((columnId) => columnIds.has(columnId));
  return columnIds.has(rule.columnId);
}

function duplicateDestinationIds(mappings: readonly ReviewedMapping[]): Set<string> {
  const counts = new Map<string, number>();
  for (const mapping of mappings) {
    if (mapping.action === 'ignore' || mapping.destinationColumnId === null) continue;
    counts.set(mapping.destinationColumnId, (counts.get(mapping.destinationColumnId) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([columnId]) => columnId));
}

function acceptedMappedSourceIds(mappings: readonly ReviewedMapping[]): Set<string> {
  return new Set(mappings
    .filter(({ status, action, destinationColumnId }) => status === 'accepted'
      && action !== 'ignore'
      && destinationColumnId !== null)
    .map(({ sourceColumnId }) => sourceColumnId));
}

function fixedMappingCommands(
  mappings: readonly ReviewedMapping[],
): Array<Extract<TransformCommand, { type: 'fixedValue' }>> {
  return mappings.flatMap((mapping) => mapping.action === 'fixed' && mapping.fixedValue !== undefined
    ? [{ type: 'fixedValue' as const, columnId: mapping.sourceColumnId, value: mapping.fixedValue }]
    : []);
}

function effectiveIncomingDataset(
  dataset: Dataset,
  mappings: readonly ReviewedMapping[],
): Dataset {
  return fixedMappingCommands(mappings).reduce((current, command) => ({
    ...current,
    rows: current.rows.map((row) => ({
      ...row,
      values: { ...row.values, [command.columnId]: command.value },
    })),
  }), dataset);
}

export function buildRejectedRows(
  dataset: Dataset,
  validation: ValidationResult,
  plan: WritePlan,
  includeWarnings = false,
): RejectedSheetRow[] {
  const rowsById = new Map(dataset.rows.map((row) => [row.rowId, row]));
  const columnsById = new Map(dataset.columns.map((column) => [column.id, column]));
  const validationRows = validation.issues
    .filter((issue) => includeWarnings || (issue.severity ?? 'error') === 'error')
    .map((issue): RejectedSheetRow => {
    const row = rowsById.get(issue.rowId);
    return {
      sourceRowNumber: issue.sourceRowNumber,
      originalRelevantFields: row?.originalValues ?? {},
      errorField: columnsById.get(issue.columnId)?.header ?? issue.columnId,
      invalidValue: issue.value,
      rejectionReason: issue.message,
      failedRuleOrTransform: issue.code,
    };
    });
  const reason = {
    'incoming-duplicate-key': 'Chave duplicada nos dados de origem.',
    'existing-duplicate-key': 'Chave duplicada no destino existente.',
    'missing-update-key': 'Chave de atualização ausente.',
  } as const;
  const planRows = plan.rejected.map((rejection): RejectedSheetRow => {
    const row = rowsById.get(rejection.incomingRowId);
    return {
      sourceRowNumber: row?.sourceRowNumber ?? 0,
      originalRelevantFields: row?.originalValues ?? {},
      errorField: rejection.keyColumnIds
        .map((id) => columnsById.get(id)?.header ?? id)
        .join(' + '),
      invalidValue: JSON.stringify(rejection.keyValues),
      rejectionReason: reason[rejection.reason],
      failedRuleOrTransform: rejection.reason,
    };
  });
  return [...validationRows, ...planRows];
}

function writePlanFingerprint(
  mode: WriteMode,
  keys: readonly string[],
  mappings: readonly ReviewedMapping[],
  validation: ValidationResult | null,
  datasetRevision: number,
): string {
  return JSON.stringify({
    mode,
    keys,
    mappings: mappings.map(({ sourceColumnId, destinationColumnId, status, action, fixedValue }) => ({
      sourceColumnId, destinationColumnId, status, action, fixedValue,
    })),
    validation,
    datasetRevision,
  });
}

function mapExistingForPlanning(
  existing: Dataset,
  source: Dataset,
  mappings: readonly ReviewedMapping[],
): Dataset {
  const mapped = mappings.filter((mapping) => mapping.action !== 'ignore' && mapping.destinationColumnId);
  return {
    columns: source.columns,
    rows: existing.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(source.columns.map((column) => {
        const mapping = mapped.find(({ sourceColumnId }) => sourceColumnId === column.id);
        return [column.id, mapping?.destinationColumnId ? row.values[mapping.destinationColumnId] ?? null : null];
      })),
      originalValues: { ...row.originalValues },
    })),
  };
}

function destinationForExport(
  candidate: DestinationCandidate,
  dataset: Dataset,
  index: WorkbookIndex,
): ExportDestination {
  const rows = rangeRows(candidate.range);
  const tablePath = candidate.kind === 'table'
    ? index.sheets.find(({ name }) => name === candidate.sheetName)?.tables
      .find(({ displayName }) => displayName === candidate.tableName)?.path
    : undefined;
  return {
    sheetName: candidate.sheetName,
    range: candidate.range,
    dataStartRow: rows.dataStartRow,
    templateRow: rows.templateRow,
    ...(tablePath ? { tablePath } : {}),
    ...(candidate.kind === 'named-range' ? { definedName: candidate.definedName } : {}),
    columns: dataset.columns.map((column) => ({
      id: column.id,
      column: XLSX.utils.encode_col(column.sourceIndex),
    })),
  };
}

export function App({ workerFactory = defaultWorkerFactory }: AppProps) {
  const workerFactoryRef = useRef(workerFactory);
  const [store] = useState(createSessionStore);
  const session = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [stepIndex, setStepIndex] = useState(0);
  const [highestVisited, setHighestVisited] = useState(0);
  const [baseDataset, setBaseDataset] = useState<Dataset | null>(null);
  const [pendingSourceFile, setPendingSourceFile] = useState<File | null>(null);
  const [sourceSheets, setSourceSheets] = useState<string[]>([]);
  const [templateIndex, setTemplateIndex] = useState<WorkbookIndex | null>(null);
  const [destinationCandidates, setDestinationCandidates] = useState<DestinationCandidate[]>([]);
  const [destinationWarnings, setDestinationWarnings] = useState<string[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<DestinationCandidate | null>(null);
  const [templateDataset, setTemplateDataset] = useState<Dataset | null>(null);
  const [writeMode, setWriteMode] = useState<WriteMode>('replace');
  const [keyColumnIds, setKeyColumnIds] = useState<string[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [exportValidationErrors, setExportValidationErrors] = useState<boolean | null>(null);
  const [includeValidationWarnings, setIncludeValidationWarnings] = useState<boolean | null>(null);
  const [writePlan, setWritePlan] = useState<WritePlan | null>(null);
  const [writePlanFingerprintValue, setWritePlanFingerprintValue] = useState<string | null>(null);
  const [datasetRevision, setDatasetRevision] = useState(0);
  const [exportRisks, setExportRisks] = useState<ExportRisk[] | null>(null);
  const [riskFingerprint, setRiskFingerprint] = useState<string | null>(null);
  const [reviewedRiskIds, setReviewedRiskIds] = useState<string[]>([]);
  const [focusTarget, setFocusTarget] = useState<{ rowId: string; columnId: string } | null>(null);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const workflowBusy = activeOperation !== null || preflightBusy;
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const workerRef = useRef<WorkflowWorker | null>(null);
  const pendingOperationRef = useRef<PendingOperation | null>(null);
  const preflightRef = useRef<string | null>(null);
  const operationCounter = useRef(0);
  const commandHistory = useRef<CommandHistory>({ past: [], future: [] });

  const mappings = session.mappings as ReviewedMapping[];
  const commands = session.transforms as TransformCommand[];
  const userRules = session.validationRules as ValidationRule[];
  const effectiveDataset = useMemo(
    () => session.dataset ? effectiveIncomingDataset(session.dataset, mappings) : null,
    [mappings, session.dataset],
  );
  const currentPlanFingerprint = useMemo(() => writePlanFingerprint(
    writeMode,
    keyColumnIds,
    mappings,
    validationResult,
    datasetRevision,
  ), [datasetRevision, keyColumnIds, mappings, validationResult, writeMode]);
  const currentWritePlan = writePlanFingerprintValue === currentPlanFingerprint ? writePlan : null;
  const currentExportRisks = riskFingerprint === currentPlanFingerprint ? exportRisks : null;
  const validationErrorCount = useMemo(() => new Set(
    validationResult?.issues
      .filter(({ severity }) => (severity ?? 'error') === 'error')
      .map(({ rowId }) => rowId) ?? [],
  ).size, [validationResult]);

  useEffect(() => {
    setExportValidationErrors(null);
  }, [currentPlanFingerprint]);
  const duplicateMappings = useMemo(() => duplicateDestinationIds(mappings), [mappings]);
  const acceptedMappedColumns = useMemo(() => acceptedMappedSourceIds(mappings), [mappings]);
  const availableKeyColumns = useMemo(
    () => session.dataset?.columns.filter(({ id }) => acceptedMappedColumns.has(id)) ?? [],
    [acceptedMappedColumns, session.dataset],
  );
  const detectedRules = useMemo(() => session.dataset && templateDataset
    ? detectedValidationRules(session.dataset.columns, templateDataset.columns, mappings)
    : [], [mappings, session.dataset, templateDataset]);

  useEffect(() => {
    const worker = workerFactoryRef.current();
    workerRef.current = worker;
    worker.onmessage = ({ data }) => {
      const pending = pendingOperationRef.current;
      if (!pending || pending.operationId !== data.operationId) return;
      setActiveOperation((current) => {
        if (!current || current.operationId !== data.operationId) return current;
        if (data.type === 'PROGRESS') {
          return { ...current, completed: data.completed, total: data.total, phase: data.phase };
        }
        return null;
      });
      if (data.type === 'RESULT') {
        pendingOperationRef.current = null;
        pending.onResult(data.result);
      } else if (data.type === 'CANCELLED') {
        pendingOperationRef.current = null;
        pending.onCancelled?.();
      } else if (data.type === 'ERROR') {
        pendingOperationRef.current = null;
        setError(data.message);
        pending.onError?.(data.message);
      }
    };
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  const runOperation = useCallback((
    request: WorkerRequest,
    label: string,
    pending: PendingOperation,
  ): boolean => {
    const worker = workerRef.current;
    if (!worker) {
      setError('Worker de processamento indisponível.');
      return false;
    }
    if (pendingOperationRef.current) {
      setError('Já existe uma operação de processamento em andamento.');
      return false;
    }
    setError(null);
    pendingOperationRef.current = { ...pending, operationId: request.operationId };
    setActiveOperation({
      operationId: request.operationId,
      label,
      completed: 0,
      total: 0,
      phase: '',
    });
    worker.postMessage(request, transferablesForRequest(request));
    return true;
  }, []);

  const operationId = useCallback((prefix: string) => `${prefix}-${++operationCounter.current}`, []);

  const beginPreflight = useCallback(() => {
    if (preflightRef.current) return null;
    const id = operationId('preflight');
    preflightRef.current = id;
    setPreflightBusy(true);
    return id;
  }, [operationId]);

  const finishPreflight = useCallback((id: string) => {
    if (preflightRef.current !== id) return;
    preflightRef.current = null;
    setPreflightBusy(false);
  }, []);

  const invalidateAfterSource = useCallback(() => {
    store.setState({ mappings: [], transforms: [], validationRules: [] });
    commandHistory.current = { past: [], future: [] };
    setValidationResult(null);
    setWritePlan(null);
    setExported(false);
    setKeyColumnIds([]);
  }, [store]);

  const importSourceFile = useCallback(async (file: File, sheetName?: string, preflightId?: string) => {
    const id = preflightId ?? beginPreflight();
    if (!id) return;
    try {
      const stableBuffer = await file.arrayBuffer();
      if (preflightRef.current !== id) return;
      const requestBuffer = stableBuffer.slice(0);
      const workerOperationId = operationId('source');
      finishPreflight(id);
      runOperation({
        type: 'IMPORT_SOURCE',
        operationId: workerOperationId,
        source: { name: file.name, buffer: requestBuffer, mediaType: file.type },
        options: sheetName ? { sheetName } : undefined,
      }, 'Importando origem', {
        onResult: (result) => {
          if (result.type !== 'IMPORT_SOURCE') return;
          invalidateAfterSource();
          const refreshedMappings: ReviewedMapping[] = templateDataset
            ? reconcileMappings(result.dataset.columns, templateDataset.columns, mappings)
            : [];
          setBaseDataset(result.dataset);
          setDatasetRevision((current) => current + 1);
          setPendingSourceFile(null);
          setSourceSheets([]);
          store.setState({
            sourceFileMetadata: metadata(file),
            sourceFileBuffer: stableBuffer,
            selectedSheets: { ...store.getState().selectedSheets, source: sheetName ?? null },
            dataset: result.dataset,
            mappings: refreshedMappings,
          });
        },
      });
    } finally {
      finishPreflight(id);
    }
  }, [beginPreflight, finishPreflight, invalidateAfterSource, mappings, operationId, runOperation, store, templateDataset]);

  const selectSourceFile = useCallback(async (file: File) => {
    if (!['csv', 'xlsx'].includes(extension(file.name))) {
      setError('A origem deve ser um arquivo .xlsx ou .csv.');
      return;
    }
    const preflightId = beginPreflight();
    if (!preflightId) return;
    if (extension(file.name) === 'csv') {
      await importSourceFile(file, undefined, preflightId);
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      if (preflightRef.current !== preflightId) return;
      finishPreflight(preflightId);
      runOperation({
        type: 'LIST_SOURCE_SHEETS',
        operationId: operationId('source-sheets'),
        source: { name: file.name, buffer, mediaType: file.type },
      }, 'Lendo abas da origem', {
        onResult: (result) => {
          if (result.type !== 'LIST_SOURCE_SHEETS') return;
          setPendingSourceFile(file);
          setSourceSheets(result.sheetNames);
          if (result.sheetNames.length === 1) void importSourceFile(file, result.sheetNames[0]);
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      finishPreflight(preflightId);
    }
  }, [beginPreflight, finishPreflight, importSourceFile, operationId, runOperation]);

  const selectTemplateFile = useCallback(async (file: File) => {
    if (extension(file.name) !== 'xlsx') {
      setError('O modelo deve ser um arquivo .xlsx.');
      return;
    }
    const preflightId = beginPreflight();
    if (!preflightId) return;
    try {
      setError(null);
      const buffer = await file.arrayBuffer();
      if (preflightRef.current !== preflightId) return;
      finishPreflight(preflightId);
      runOperation({
        type: 'INDEX_TEMPLATE',
        operationId: operationId('template-index'),
        templateBuffer: buffer.slice(0),
      }, 'Indexando modelo', {
        onResult: (result) => {
          if (result.type !== 'INDEX_TEMPLATE') return;
          setTemplateIndex(result.index);
          setDestinationCandidates([]);
          setDestinationWarnings([]);
          setSelectedDestination(null);
          setTemplateDataset(null);
          setValidationResult(null);
          setWritePlan(null);
          setExported(false);
          setKeyColumnIds([]);
          store.setState({
            templateMetadata: metadata(file),
            templateFileBuffer: buffer,
            selectedSheets: { ...store.getState().selectedSheets, template: null },
            mappings: [],
            validationRules: [],
          });
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      finishPreflight(preflightId);
    }
  }, [beginPreflight, finishPreflight, operationId, runOperation, store]);

  const selectTemplateSheet = useCallback((sheetName: string) => {
    if (!templateIndex) return;
    setDestinationCandidates(detectDestination(templateIndex, sheetName));
    setDestinationWarnings(destinationDetectionWarnings(templateIndex, sheetName));
    setSelectedDestination(null);
    setTemplateDataset(null);
    setValidationResult(null);
    setWritePlan(null);
    setExported(false);
    setKeyColumnIds([]);
    store.setState({
      selectedSheets: { ...store.getState().selectedSheets, template: sheetName },
      mappings: [],
      validationRules: [],
    });
  }, [store, templateIndex]);

  const selectDestination = useCallback((candidate: DestinationCandidate) => {
    if (!session.templateFileBuffer || !session.dataset) return;
    runOperation({
      type: 'EXTRACT_DESTINATION',
      operationId: operationId('destination'),
      templateBuffer: session.templateFileBuffer.slice(0),
      sheetName: candidate.sheetName,
      range: candidate.range,
    }, 'Lendo destino', {
      onResult: (result) => {
        if (result.type !== 'EXTRACT_DESTINATION' || !session.dataset) return;
        const suggestions: ReviewedMapping[] = suggestMappings(
          session.dataset.columns,
          result.dataset.columns,
        ).map((mapping) => ({ ...mapping, action: 'map' }));
        setSelectedDestination(candidate);
        setTemplateDataset(result.dataset);
        setValidationResult(null);
        setWritePlan(null);
        setExported(false);
        setKeyColumnIds([]);
        store.setState({ mappings: suggestions, validationRules: [] });
      },
    });
  }, [operationId, runOperation, session.dataset, session.templateFileBuffer, store]);

  const commitCommandSet = useCallback((
    nextCommands: TransformCommand[],
    historyUpdate: () => void,
    after?: (dataset: Dataset) => void,
  ) => {
    if (!baseDataset) return;
    const id = operationId('transform');
    runOperation({
      type: 'APPLY_TRANSFORMS',
      operationId: id,
      dataset: baseDataset,
      commands: nextCommands,
    }, 'Aplicando transformações', {
      onResult: (result) => {
        if (result.type !== 'APPLY_TRANSFORMS') return;
        historyUpdate();
        const schemaChanged = baseDataset ? changedSchema(baseDataset, result.dataset) : false;
        store.setState({
          transforms: nextCommands,
          dataset: result.dataset,
          ...(schemaChanged && templateDataset
            ? { mappings: reconcileMappings(result.dataset.columns, templateDataset.columns, mappings) }
            : {}),
          ...(schemaChanged
            ? { validationRules: userRules.filter((rule) => validationRuleUsesOnlyColumns(rule, new Set(result.dataset.columns.map(({ id }) => id)))) }
            : {}),
        });
        setDatasetRevision((current) => current + 1);
        setValidationResult(null);
        setWritePlan(null);
        if (schemaChanged) setKeyColumnIds([]);
        setExported(false);
        after?.(effectiveIncomingDataset(result.dataset, mappings));
      },
    });
  }, [baseDataset, mappings, operationId, runOperation, store, templateDataset, userRules]);

  const replaceCommands = useCallback((nextCommands: TransformCommand[]) => {
    const previous = [...commands];
    commitCommandSet(nextCommands, () => {
      commandHistory.current.past.push(previous);
      commandHistory.current.future = [];
    });
  }, [commands, commitCommandSet]);

  const undoCommands = useCallback(() => {
    const target = commandHistory.current.past.at(-1);
    if (!target) return;
    const current = [...commands];
    commitCommandSet(target, () => {
      commandHistory.current.past.pop();
      commandHistory.current.future.push(current);
    });
  }, [commands, commitCommandSet]);

  const redoCommands = useCallback(() => {
    const target = commandHistory.current.future.at(-1);
    if (!target) return;
    const current = [...commands];
    commitCommandSet(target, () => {
      commandHistory.current.future.pop();
      commandHistory.current.past.push(current);
    });
  }, [commands, commitCommandSet]);

  const revalidateCorrection = useCallback((dataset: Dataset, command: Extract<TransformCommand, { type: 'editCell' }>) => {
    if (!validationResult) return;
    const rules = [...detectedRules, ...userRules];
    const nextIssues = validateDataset(dataset, rules).issues;
    setValidationResult({ isValid: nextIssues.every(({ severity }) => (severity ?? 'error') !== 'error'), issues: nextIssues });
  }, [detectedRules, userRules, validationResult]);

  const editCell = useCallback((command: Extract<TransformCommand, { type: 'editCell' }>) => {
    const previous = [...commands];
    const next = [...commands, command];
    commitCommandSet(next, () => {
      commandHistory.current.past.push(previous);
      commandHistory.current.future = [];
    }, (dataset) => revalidateCorrection(dataset, command));
  }, [commands, commitCommandSet, revalidateCorrection]);

  const runValidation = useCallback(() => {
    if (!effectiveDataset) return;
    const matrixErrors = [...detectedRules, ...userRules]
      .filter((rule) => rule.type === 'conditionalMatrix')
      .flatMap((rule) => validateConditionalMatrixRule(rule, effectiveDataset.columns.map(({ id }) => id)));
    if (matrixErrors.length > 0) {
      setError(`Corrija a configuração da matriz: ${matrixErrors[0]}`);
      return;
    }
    const id = operationId('validation');
    runOperation({
      type: 'VALIDATE',
      operationId: id,
      dataset: effectiveDataset,
      rules: [...detectedRules, ...userRules],
    }, 'Validando dados', {
      onResult: (result) => {
        if (result.type !== 'VALIDATE') return;
        setValidationResult(result.validationResult);
        setExportValidationErrors(null);
        setIncludeValidationWarnings(null);
        setWritePlan(null);
        setExported(false);
      },
    });
  }, [detectedRules, effectiveDataset, operationId, runOperation, userRules]);

  const runWritePlan = useCallback(() => {
    if (!effectiveDataset || !templateDataset || !selectedDestination) return;
    const incoming = effectiveDataset;
    const rows = rangeRows(selectedDestination.range);
    const id = operationId('plan');
    const fingerprint = currentPlanFingerprint;
    runOperation({
      type: 'PLAN_WRITE',
      operationId: id,
      input: {
        mode: writeMode,
        incoming,
        existing: mapExistingForPlanning(templateDataset, incoming, mappings),
        destination: { headerRow: rows.headerRow, dataStartRow: rows.dataStartRow },
        comparedColumnIds: [...acceptedMappedColumns],
        ...(writeMode === 'update' ? { keyColumnIds: keyColumnIds.filter((id) => acceptedMappedColumns.has(id)) } : {}),
      },
    }, 'Calculando resumo', {
      onResult: (result) => {
        if (result.type !== 'PLAN_WRITE') return;
        setWritePlan(result.writePlan);
        setWritePlanFingerprintValue(fingerprint);
        setExportRisks(null);
        setExportValidationErrors(null);
        setRiskFingerprint(null);
        setReviewedRiskIds([]);
        setExported(false);
        setStepIndex(8);
        setHighestVisited((current) => Math.max(current, 8));
      },
    });
  }, [acceptedMappedColumns, currentPlanFingerprint, effectiveDataset, keyColumnIds, mappings, operationId, runOperation, selectedDestination, templateDataset, writeMode]);

  const exportInput = useCallback((plan: WritePlan, riskIds: readonly string[] = [], includeWarnings = false) => {
    if (!validationResult || !selectedDestination || !templateDataset || !templateIndex || !session.dataset) return null;
    return {
      destination: destinationForExport(selectedDestination, templateDataset, templateIndex),
      mappings: acceptedMappings(mappings),
      writePlan: plan,
      validationResult,
      rejectedRows: buildRejectedRows(session.dataset, validationResult, plan, includeWarnings),
      reviewedRiskIds: riskIds,
    };
  }, [mappings, selectedDestination, session.dataset, templateDataset, templateIndex, validationResult]);

  const runExportRiskScan = useCallback(() => {
    if (!currentWritePlan || !session.templateFileBuffer) return;
    const input = exportInput(currentWritePlan);
    if (!input) return;
    const fingerprint = currentPlanFingerprint;
    runOperation({
      type: 'SCAN_EXPORT_RISKS',
      operationId: operationId('export-risks'),
      templateBuffer: session.templateFileBuffer.slice(0),
      input,
    }, 'Verificando riscos', {
      onResult: (result) => {
        if (result.type !== 'EXPORT_RISKS') return;
        setExportRisks(result.risks);
        setExportValidationErrors(null);
        setRiskFingerprint(fingerprint);
        setReviewedRiskIds([]);
        setStepIndex(9);
        setHighestVisited((current) => Math.max(current, 9));
      },
    });
  }, [currentPlanFingerprint, currentWritePlan, exportInput, operationId, runOperation, session.templateFileBuffer]);

  const exportWorkbook = useCallback(() => {
    if (!currentWritePlan || !session.templateFileBuffer) return;
    if (includeValidationWarnings === null) return;
    if (validationErrorCount > 0 && exportValidationErrors !== true) return;
    const input = exportInput(currentWritePlan, reviewedRiskIds, includeValidationWarnings);
    if (!input) return;
    const id = operationId('export');
    runOperation({
      type: 'EXPORT',
      operationId: id,
      templateBuffer: session.templateFileBuffer.slice(0),
      input,
    }, 'Exportando planilha', {
      onResult: (result) => {
        if (result.type !== 'EXPORT') return;
        const blob = new Blob([result.buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'planilha-preparada.xlsx';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        setExported(true);
      },
    });
  }, [currentWritePlan, exportInput, exportValidationErrors, includeValidationWarnings, operationId, reviewedRiskIds, runOperation, session.templateFileBuffer, validationErrorCount]);

  const canAdvance = useMemo(() => {
    switch (stepIndex) {
      case 0: return session.dataset !== null;
      case 1: return session.templateFileBuffer !== null && session.selectedSheets.template !== null;
      case 2: return selectedDestination !== null;
      case 3: return mappings.length > 0
        && mappings.every(({ status }) => status === 'accepted')
        && duplicateMappings.size === 0;
      case 4: return true;
      case 5: return validationResult !== null;
      case 6: return true;
      case 7: return writeMode !== 'update'
        || (keyColumnIds.length > 0 && keyColumnIds.every((id) => acceptedMappedColumns.has(id)));
      case 8: return currentWritePlan !== null;
      default: return false;
    }
  }, [acceptedMappedColumns, currentWritePlan, duplicateMappings.size, keyColumnIds, mappings, selectedDestination, session.dataset, session.selectedSheets.template, session.templateFileBuffer, stepIndex, validationResult, writeMode]);

  const advance = () => {
    if (!canAdvance || activeOperation) return;
    if (stepIndex === 7) {
      runWritePlan();
      return;
    }
    if (stepIndex === 8) {
      runExportRiskScan();
      return;
    }
    const next = Math.min(STEPS.length - 1, stepIndex + 1);
    setStepIndex(next);
    setHighestVisited((current) => Math.max(current, next));
  };

  const cancelOperation = () => {
    if (!activeOperation) return;
    workerRef.current?.postMessage({
      type: 'CANCEL_OPERATION',
      operationId: activeOperation.operationId,
    });
  };

  return (
    <main className="app-shell">
      <style>{APP_STYLES}</style>
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">X</div>
        <div>
          <p>Transformador local</p>
          <h1>Preparar planilha</h1>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={workflowBusy}
          onClick={() => {
            store.resetSession();
            setStepIndex(0);
            setHighestVisited(0);
            setBaseDataset(null);
            setPendingSourceFile(null);
            setSourceSheets([]);
            setTemplateIndex(null);
            setDestinationCandidates([]);
            setDestinationWarnings([]);
            setSelectedDestination(null);
            setTemplateDataset(null);
            setValidationResult(null);
            setExportValidationErrors(null);
            setWritePlan(null);
            setWritePlanFingerprintValue(null);
            setDatasetRevision(0);
            setExportRisks(null);
            setRiskFingerprint(null);
            setReviewedRiskIds([]);
            setExported(false);
            commandHistory.current = { past: [], future: [] };
          }}
        >
          Nova sessão
        </button>
      </header>

      <Stepper
        steps={STEPS}
        currentIndex={stepIndex}
        highestVisitedIndex={highestVisited}
        disabled={workflowBusy}
        onSelect={setStepIndex}
      />

      <section className="workflow-card" id="workflow">
        <div className="step-heading">
          <span>Etapa {stepIndex + 1} de {STEPS.length}</span>
          <h2>{STEPS[stepIndex].label}</h2>
          <p>{STEP_DESCRIPTIONS[stepIndex]}</p>
        </div>

        {error ? <div className="error-banner" role="alert">{error}</div> : null}

        {activeOperation ? (
          <div className="operation-panel" aria-live="polite">
            <div>
              <strong>{activeOperation.label}</strong>
              <span>{activeOperation.phase || 'preparando'}</span>
            </div>
            <progress value={activeOperation.completed} max={Math.max(1, activeOperation.total)} />
            <span>{activeOperation.total === 0 ? '0%' : `${Math.round(activeOperation.completed / activeOperation.total * 100)}%`}</span>
            <button type="button" onClick={cancelOperation}>Cancelar</button>
          </div>
        ) : null}

        <div className="step-content">
          {stepIndex === 0 ? (
            <>
              <FileDrop
                accept=".xlsx,.csv"
                actionLabel="Selecionar arquivo de origem"
                description="Formatos aceitos: .xlsx e .csv"
                fileName={pendingSourceFile?.name ?? session.sourceFileMetadata?.name}
                disabled={workflowBusy}
                onSelect={(file) => void selectSourceFile(file)}
              />
              {pendingSourceFile && sourceSheets.length > 1 ? (
                <label className="field">Aba de origem
                  <select
                    defaultValue=""
                    disabled={workflowBusy}
                    onChange={(event) => void importSourceFile(pendingSourceFile, event.currentTarget.value)}
                  >
                    <option value="" disabled>Selecione uma aba</option>
                    {sourceSheets.map((sheet) => <option value={sheet} key={sheet}>{sheet}</option>)}
                  </select>
                </label>
              ) : null}
              {session.dataset ? <DatasetFacts dataset={session.dataset} /> : null}
            </>
          ) : null}

          {stepIndex === 1 ? (
            <>
              <FileDrop
                accept=".xlsx"
                actionLabel="Selecionar arquivo modelo"
                description="O arquivo original permanecerá intacto. Formato aceito: .xlsx"
                fileName={session.templateMetadata?.name}
                disabled={workflowBusy}
                onSelect={(file) => void selectTemplateFile(file)}
              />
              {templateIndex ? (
                <label className="field">Aba do modelo
                  <select
                    value={session.selectedSheets.template ?? ''}
                    disabled={workflowBusy}
                    onChange={(event) => selectTemplateSheet(event.currentTarget.value)}
                  >
                    <option value="" disabled>Selecione uma aba</option>
                    {templateIndex.sheets.map((sheet) => <option value={sheet.name} key={sheet.name}>{sheet.name}</option>)}
                  </select>
                </label>
              ) : null}
              {session.selectedSheets.template ? <p className="selection-note">{session.selectedSheets.template} selecionada</p> : null}
            </>
          ) : null}

          {stepIndex === 2 ? (
            <div className="candidate-list">
              {destinationCandidates.map((candidate, index) => (
                <label key={`${candidate.kind}-${candidate.range}`} data-selected={selectedDestination === candidate || undefined}>
                  <input
                    type="radio"
                    name="destination"
                    checked={selectedDestination === candidate}
                    onChange={() => selectDestination(candidate)}
                  />
                  <span>
                    <strong>{candidate.kind === 'table' ? candidate.tableName : candidate.kind === 'named-range' ? candidate.definedName.name : `Região ${index + 1}`}</strong>
                    <small>{candidate.sheetName} · {candidate.range}</small>
                    <small>{candidate.explanation}</small>
                  </span>
                  <em>{candidate.confidence === 'high' ? 'Alta confiança' : 'Média confiança'}</em>
                </label>
              ))}
              {destinationCandidates.length === 0 ? <p>Nenhum destino detectado na aba selecionada.</p> : null}
              {destinationWarnings.map((warning) => <p className="error-banner" key={warning}>{warning}</p>)}
            </div>
          ) : null}

          {stepIndex === 3 && session.dataset && templateDataset ? (
            <>
              {duplicateMappings.size > 0 ? (
                <p className="error-banner" role="alert">Conflito: destinos duplicados precisam ser corrigidos antes de continuar.</p>
              ) : null}
              <MappingGrid
                sourceColumns={session.dataset.columns}
                destinationColumns={templateDataset.columns}
                mappings={mappings}
                disabled={workflowBusy}
                onChange={(next) => {
                  store.setState({ mappings: next });
                  setKeyColumnIds([]);
                  setValidationResult(null);
                  setWritePlan(null);
                }}
              />
            </>
          ) : null}

          {stepIndex === 4 && session.dataset ? (
            <TransformationEditor
              dataset={session.dataset}
              commands={commands}
              busy={workflowBusy}
              canUndo={commandHistory.current.past.length > 0}
              canRedo={commandHistory.current.future.length > 0}
              onReplace={replaceCommands}
              onUndo={undoCommands}
              onRedo={redoCommands}
            />
          ) : null}

          {stepIndex === 5 && session.dataset ? (
            <ValidationPanel
              dataset={session.dataset}
              columns={session.dataset.columns}
              detectedRules={detectedRules}
              userRules={userRules}
              issues={validationResult?.issues ?? []}
              disabled={workflowBusy}
              onAddRule={(rule) => {
                store.setState({ validationRules: [...userRules, rule] });
                setValidationResult(null);
              }}
              onReplaceRule={(index, rule) => {
                store.setState({ validationRules: userRules.map((current, currentIndex) => currentIndex === index ? rule : current) });
                setValidationResult(null);
              }}
              onRemoveRule={(index) => {
                store.setState({ validationRules: userRules.filter((_, current) => current !== index) });
                setValidationResult(null);
              }}
              onRun={runValidation}
              onSelectIssue={(issue) => {
                setFocusTarget({ rowId: issue.rowId, columnId: issue.columnId });
                setStepIndex(6);
                setHighestVisited((current) => Math.max(current, 6));
              }}
            />
          ) : null}

          {stepIndex === 6 && session.dataset ? (
            <DataGrid
              dataset={session.dataset}
              issues={validationResult?.issues ?? []}
              focusTarget={focusTarget}
              busy={workflowBusy}
              onEdit={editCell}
            />
          ) : null}

          {stepIndex === 7 && session.dataset ? (
            <div className="write-mode-grid">
              {([
                ['replace', 'Substituir', 'Limpa as linhas atuais e grava o conjunto preparado.'],
                ['append', 'Acrescentar', 'Mantém as linhas atuais e adiciona novas linhas ao final.'],
                ['update', 'Atualizar', 'Compara uma ou mais colunas-chave revisadas.'],
              ] as const).map(([mode, label, description]) => (
                <label key={mode} data-selected={writeMode === mode || undefined}>
                  <input
                    type="radio"
                    name="write-mode"
                    value={mode}
                    checked={writeMode === mode}
                    onChange={() => {
                      setWriteMode(mode);
                      setWritePlan(null);
                    }}
                  />
                  <strong>{label}</strong>
                  <span>{description}</span>
                </label>
              ))}
              {writeMode === 'update' ? (
                <fieldset className="key-columns">
                  <legend>Colunas-chave revisadas</legend>
                  {availableKeyColumns.length === 0 ? <p>Nenhuma coluna mapeada e revisada está disponível.</p> : null}
                  {availableKeyColumns.map((column) => (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        checked={keyColumnIds.includes(column.id)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setKeyColumnIds((current) => checked
                            ? [...current, column.id]
                            : current.filter((id) => id !== column.id));
                          setWritePlan(null);
                          setWritePlanFingerprintValue(null);
                          setExportRisks(null);
                          setRiskFingerprint(null);
                        }}
                      />
                      {column.header}
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
          ) : null}

          {stepIndex === 8 && currentWritePlan ? (
            <>
              <ExportSummary plan={currentWritePlan} validationIssues={validationResult?.issues ?? []} />
              <p className="summary-note">Modo selecionado: <strong>{writeMode === 'replace' ? 'Substituir' : writeMode === 'append' ? 'Acrescentar' : 'Atualizar'}</strong></p>
            </>
          ) : null}

          {stepIndex === 9 ? (
            <div className="export-panel">
              <div className="export-icon" aria-hidden="true">XLSX</div>
              <h3>{exported ? 'Arquivo exportado' : 'Tudo pronto para exportar'}</h3>
              <p>O processamento acontece no navegador e o modelo original não será alterado.</p>
              {currentExportRisks ? (
                <section className="risk-list" aria-label="Riscos de exportação">
                  {currentExportRisks.length === 0 ? <p>Nenhum risco de compatibilidade detectado.</p> : null}
                  {currentExportRisks.map((risk) => {
                    const riskId = exportRiskIdentifier(risk);
                    return (
                      <div key={riskId} className={risk.severity === 'hard' ? 'error-banner' : 'selection-note'}>
                        <strong>{risk.severity === 'hard' ? 'Bloqueio' : 'Confirmação necessária'}</strong>
                        <p>{risk.message}</p>
                        {risk.severity === 'soft' ? (
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Confirmar risco ${risk.code}`}
                              checked={reviewedRiskIds.includes(riskId)}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setReviewedRiskIds((current) => checked
                                  ? [...current, riskId]
                                  : current.filter((id) => id !== riskId));
                              }}
                            />
                            Confirmo este risco
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </section>
              ) : null}
              {validationErrorCount > 0 ? (
                <fieldset className="validation-export-choice">
                  <legend>
                    {validationErrorCount === 1
                      ? '1 registro com erro de validação. Deseja exportar somente os registros sem erro?'
                      : `${validationErrorCount} registros com erro de validação. Deseja exportar somente os registros sem erro?`}
                  </legend>
                  <label>
                    <input
                      type="radio"
                      name="export-validation-errors"
                      checked={exportValidationErrors === false}
                      onChange={() => setExportValidationErrors(false)}
                    />
                    Não, não exportar
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="export-validation-errors"
                      checked={exportValidationErrors === true}
                      onChange={() => setExportValidationErrors(true)}
                    />
                    Sim, exportar somente registros sem erro
                  </label>
                  <p className="selection-note">Os registros com erro serão adicionados à aba “Registros rejeitados”.</p>
                </fieldset>
              ) : null}
              <fieldset className="warning-export-choice">
                <legend>Incluir avisos no relatório de rejeitados?</legend>
                <label>
                  <input
                    type="radio"
                    name="include-validation-warnings"
                    checked={includeValidationWarnings === false}
                    onChange={() => setIncludeValidationWarnings(false)}
                  />
                  Não, somente erros
                </label>
                <label>
                  <input
                    type="radio"
                    name="include-validation-warnings"
                    checked={includeValidationWarnings === true}
                    onChange={() => setIncludeValidationWarnings(true)}
                  />
                  Sim, incluir avisos
                </label>
              </fieldset>
              <button
                type="button"
                className="primary-button export-button"
                disabled={workflowBusy
                  || !currentWritePlan
                  || !validationResult
                  || currentExportRisks === null
                  || includeValidationWarnings === null
                  || (validationErrorCount > 0 && exportValidationErrors !== true)
                  || currentExportRisks.some((risk) => risk.severity === 'hard')
                  || currentExportRisks.some((risk) => risk.severity === 'soft'
                    && !reviewedRiskIds.includes(exportRiskIdentifier(risk)))}
                onClick={exportWorkbook}
              >
                Exportar .xlsx
              </button>
            </div>
          ) : null}
        </div>

        <footer className="workflow-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={stepIndex === 0 || workflowBusy}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            Voltar
          </button>
          {stepIndex < 9 ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canAdvance || workflowBusy}
              onClick={advance}
            >
              Avançar
            </button>
          ) : null}
        </footer>
      </section>
    </main>
  );
}

function DatasetFacts({ dataset }: { dataset: Dataset }) {
  return (
    <dl className="dataset-facts">
      <div><dt>Linhas</dt><dd>{dataset.rows.length}</dd></div>
      <div><dt>Colunas</dt><dd>{dataset.columns.length}</dd></div>
      <div><dt>Processamento</dt><dd>Somente nesta sessão</dd></div>
    </dl>
  );
}

interface TransformationEditorProps {
  dataset: Dataset;
  commands: readonly TransformCommand[];
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onReplace(commands: TransformCommand[]): void;
  onUndo(): void;
  onRedo(): void;
}

function TransformationEditor({
  dataset,
  commands,
  busy,
  canUndo,
  canRedo,
  onReplace,
  onUndo,
  onRedo,
}: TransformationEditorProps) {
  const [type, setType] = useState<Exclude<TransformCommand['type'], 'editCell'>>('prefix');
  const [columnId, setColumnId] = useState(dataset.columns[0]?.id ?? '');
  const [secondColumnId, setSecondColumnId] = useState(dataset.columns[1]?.id ?? dataset.columns[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [extra, setExtra] = useState('');
  const [typedValue, setTypedValue] = useState<CellValue>(null);
  const [typedExtraValue, setTypedExtraValue] = useState<CellValue>(null);
  const [operator, setOperator] = useState('+');
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('contains');
  const [when, setWhen] = useState<TransformConditionNode | undefined>();

  useEffect(() => {
    setValue('');
    setExtra('');
    setTypedValue(null);
    setTypedExtraValue(null);
    setWhen(undefined);
  }, [columnId, type]);

  const add = () => {
    const command = buildTransform(type, {
      columnId,
      secondColumnId,
      value,
      extra,
      typedValue,
      typedExtraValue,
      operator,
      filterOperator,
      when,
    }, dataset);
    if (command) onReplace([...commands, command]);
  };

  const valuePickerTypes = ['findReplace', 'fixedValue'].includes(type)
    || (type === 'filter' && !['isEmpty', 'notEmpty'].includes(filterOperator));
  const supportsWhen = ['findReplace', 'splitColumn', 'combineColumns', 'dateConversion', 'numberConversion', 'currencyConversion', 'prefix', 'suffix', 'fixedValue', 'calculatedColumn'].includes(type);
  const inferredSuggestions = type === 'splitColumn'
    ? getSuggestedDelimiters(dataset, columnId)
    : type === 'dateConversion'
      ? detectDateFormats(dataset, columnId)
      : type === 'numberConversion'
        ? [detectDecimalSeparator(dataset, columnId)]
        : [];
  const suggestionListId = `transform-suggestions-${type}`;

  return (
    <div className="transform-layout">
      <section className="transform-form">
        <h3>Adicionar transformação</h3>
        <label>Tipo de transformação
          <select value={type} disabled={busy} onChange={(event) => setType(event.currentTarget.value as typeof type)}>
            {Object.entries(TRANSFORM_LABELS).filter(([commandType]) => commandType !== 'editCell').map(([commandType, label]) => (
              <option value={commandType} key={commandType}>{label}</option>
            ))}
          </select>
        </label>
        <label>Coluna principal
          <select value={columnId} disabled={busy} onChange={(event) => setColumnId(event.currentTarget.value)}>
            {dataset.columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
          </select>
        </label>
        {['combineColumns', 'conditionalRule', 'calculatedColumn'].includes(type) ? (
          <label>Segunda coluna
            <select value={secondColumnId} disabled={busy} onChange={(event) => setSecondColumnId(event.currentTarget.value)}>
              {dataset.columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
        ) : null}
        {type === 'filter' ? (
          <label>Operador do filtro
            <select value={filterOperator} disabled={busy} onChange={(event) => setFilterOperator(event.currentTarget.value as FilterOperator)}>
              <option value="equals">Igual a</option>
              <option value="contains">Contém</option>
              <option value="isEmpty">Está vazio</option>
              <option value="notEmpty">Não está vazio</option>
              <option value="greaterThan">Maior que</option>
              <option value="lessThan">Menor que</option>
            </select>
          </label>
        ) : null}
        {['calculatedColumn'].includes(type) ? (
          <label>Operador suportado
            <select value={operator} disabled={busy} onChange={(event) => setOperator(event.currentTarget.value)}>
              {['+', '-', '*', '/', '==', '!=', '>', '>=', '<', '<=', 'and', 'or'].map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
        ) : null}
        {valuePickerTypes ? (
          <ValuePicker
            dataset={dataset}
            columnId={columnId}
            label={transformValueLabel(type)}
            value={typedValue}
            disabled={busy}
            onChange={setTypedValue}
          />
        ) : type !== 'conditionalRule' ? (
          <label>{transformValueLabel(type)}
            <input list={inferredSuggestions.length > 0 ? suggestionListId : undefined} value={value} disabled={busy} onChange={(event) => setValue(event.currentTarget.value)} />
          </label>
        ) : null}
        {inferredSuggestions.length > 0 ? (
          <datalist id={suggestionListId}>
            {inferredSuggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}
          </datalist>
        ) : null}
        {type === 'findReplace' ? (
          <ValuePicker
            dataset={dataset}
            columnId={columnId}
            label="Substituir por"
            value={typedExtraValue}
            disabled={busy}
            onChange={setTypedExtraValue}
          />
        ) : null}
        {['combineColumns', 'splitColumn', 'calculatedColumn'].includes(type) ? (
          <label>{transformExtraLabel(type)}
            <input value={extra} disabled={busy} onChange={(event) => setExtra(event.currentTarget.value)} />
          </label>
        ) : null}
        {type === 'conditionalRule' ? (
          <>
            <ConditionBuilder dataset={dataset} value={when} required disabled={busy} onChange={setWhen} />
            <ValuePicker
              dataset={dataset}
              columnId={secondColumnId}
              label="Valor a gravar"
              value={typedExtraValue}
              disabled={busy}
              onChange={setTypedExtraValue}
            />
          </>
        ) : null}
        {supportsWhen ? <ConditionBuilder dataset={dataset} value={when} disabled={busy} onChange={setWhen} /> : null}
        {type === 'calculatedColumn' ? <p className="form-help">A expressão é convertida para a AST segura; JavaScript livre não é aceito.</p> : null}
        <button type="button" className="primary-button" disabled={busy || columnId === ''} onClick={add}>Adicionar transformação</button>
      </section>
      <section className="command-stack">
        <div className="command-toolbar">
          <h3>Sequência aplicada</h3>
          <button type="button" disabled={busy || !canUndo} onClick={onUndo}>Desfazer</button>
          <button type="button" disabled={busy || !canRedo} onClick={onRedo}>Refazer</button>
        </div>
        {commands.length === 0 ? <p>Nenhuma transformação adicionada.</p> : (
          <div className="command-table-scroll">
            <table className="command-table" aria-label="Sequência aplicada">
              <caption className="visually-hidden">Parâmetros das transformações aplicadas</caption>
              <thead><tr>
                <th scope="col">#</th>
                <th scope="col">Transformação</th>
                <th scope="col">Coluna-alvo</th>
                <th scope="col">Valores/configurações</th>
                <th scope="col">Condições</th>
                <th scope="col">Ações</th>
              </tr></thead>
              <tbody>
                {commands.map((command, index) => {
                  const details = transformDetails(command, dataset.columns);
                  return (
                    <tr key={`${command.type}-${index}`}>
                      <td><span className="command-index">{index + 1}</span></td>
                      <th scope="row">{TRANSFORM_LABELS[command.type]}</th>
                      <td className="command-target">{details.target}</td>
                      <td><dl className="command-details">{details.parameters.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl></td>
                      <td className="command-condition">{details.condition ?? '—'}</td>
                      <td><div className="command-actions">
                        <button type="button" aria-label={`Mover ${index + 1} para cima`} disabled={busy || index === 0} onClick={() => {
                          const next = [...commands];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          onReplace(next);
                        }}>↑</button>
                        <button type="button" aria-label={`Mover ${index + 1} para baixo`} disabled={busy || index === commands.length - 1} onClick={() => {
                          const next = [...commands];
                          [next[index], next[index + 1]] = [next[index + 1], next[index]];
                          onReplace(next);
                        }}>↓</button>
                        <button type="button" disabled={busy} onClick={() => onReplace(commands.filter((_, current) => current !== index))}>Remover</button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type TransformDetails = {
  target: React.ReactNode;
  parameters: Array<[string, React.ReactNode]>;
  condition?: React.ReactNode;
};

function displayCellValue(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === '') return 'Vazio';
  if (typeof value === 'string') return value;
  return String(value);
}

function columnHeader(columnId: string | undefined, columns: readonly DatasetColumn[]): string {
  return columns.find((column) => column.id === columnId)?.header ?? columnId ?? '—';
}

function conditionLabel(condition: TransformConditionNode | undefined, columns: readonly DatasetColumn[]): string | undefined {
  if (!condition) return undefined;
  if (condition.type === 'group') {
    return condition.children.map((child) => conditionLabel(child, columns) ?? '—').join(condition.operator === 'and' ? ' E ' : ' OU ');
  }
  const operators: Record<TransformConditionOperator, string> = {
    equals: 'Igual a', notEquals: 'Diferente de', contains: 'Contém', isEmpty: 'Está vazio', notEmpty: 'Não está vazio',
    greaterThan: 'Maior que', greaterThanOrEqual: 'Maior ou igual a', lessThan: 'Menor que', lessThanOrEqual: 'Menor ou igual a',
  };
  const operand = condition.operand?.type === 'column'
    ? columnHeader(condition.operand.columnId, columns)
    : displayCellValue(condition.operand?.value);
  return `${columnHeader(condition.columnId, columns)} ${operators[condition.operator]}${condition.operand ? ` ${operand}` : ''}`;
}

function transformDetails(command: TransformCommand, columns: readonly DatasetColumn[]): TransformDetails {
  const target = (() => {
    if (command.type === 'reorderColumns') return command.columnIds.map((id) => columnHeader(id, columns)).join(' → ');
    if (command.type === 'combineColumns' || command.type === 'findReplace') return command.columnIds.map((id) => columnHeader(id, columns)).join(', ');
    if (command.type === 'conditionalRule') return command.updates.map(({ columnId }) => columnHeader(columnId, columns)).join(', ');
    if (command.type === 'calculatedColumn') return command.newColumn.header;
    if (command.type === 'editCell') return columnHeader(command.columnId, columns);
    if (command.type === 'sort') return command.sorts.map(({ columnId }) => columnHeader(columnId, columns)).join(', ');
    if (command.type === 'removeEmptyRows') return (command.columnIds ?? []).map((id) => columnHeader(id, columns)).join(', ') || 'Todas';
    if (command.type === 'deduplicate') return command.columnIds.map((id) => columnHeader(id, columns)).join(', ');
    return columnHeader(command.columnId, columns);
  })();
  const parameters: Array<[string, React.ReactNode]> = [];
  switch (command.type) {
    case 'reorderColumns': parameters.push(['Ordem', target]); break;
    case 'sort': parameters.push(['Direção', command.sorts.map((sort) => sort.direction === 'asc' ? 'Crescente' : 'Decrescente').join(', ')]); break;
    case 'filter': parameters.push(['Operador', command.operator], ['Valor', displayCellValue(command.value)]); break;
    case 'removeEmptyRows': parameters.push(['Colunas', (command.columnIds ?? []).map((id) => columnHeader(id, columns)).join(', ') || 'Todas']); break;
    case 'deduplicate': parameters.push(['Colunas', command.columnIds.map((id) => columnHeader(id, columns)).join(', ')], ['Manter', command.keep === 'first' ? 'Primeiro' : 'Último']); break;
    case 'renameHeader': parameters.push(['Novo cabeçalho', command.header]); break;
    case 'splitColumn': parameters.push(['Delimitador', command.delimiter], ['Novas colunas', command.newColumns.map(({ header }) => header).join(', ')]); break;
    case 'combineColumns': parameters.push(['Separador', command.separator], ['Nova coluna', command.newColumn.header]); break;
    case 'findReplace': parameters.push(['Localizar', displayCellValue(command.find)], ['Substituir por', displayCellValue(command.replace)], ['Sensível a maiúsculas', command.caseSensitive ? 'Sim' : 'Não']); break;
    case 'dateConversion': parameters.push(['Formato', `${command.inputFormat} → ${command.outputFormat}`]); break;
    case 'numberConversion': parameters.push(['Separador decimal', command.decimalSeparator]); break;
    case 'currencyConversion': parameters.push(['Localidade', command.locale], ['Moeda', command.currency]); break;
    case 'prefix': parameters.push(['Prefixo', command.value]); break;
    case 'suffix': parameters.push(['Sufixo', command.value]); break;
    case 'fixedValue': parameters.push(['Valor', displayCellValue(command.value)]); break;
    case 'calculatedColumn': parameters.push(['Expressão', expressionLabel(command.expression, columns)]); break;
    case 'conditionalRule': parameters.push(...command.updates.map(({ columnId, value }) => [`Gravar em ${columnHeader(columnId, columns)}`, displayCellValue(value)] as [string, React.ReactNode])); break;
    case 'editCell': parameters.push(['Valor', displayCellValue(command.value)]); break;
  }
  const condition = 'when' in command ? conditionLabel(command.when, columns) : command.type === 'conditionalRule' ? conditionLabel(command.condition, columns) : undefined;
  return { target, parameters, condition: condition ? `Condição: ${condition}` : undefined };
}

function expressionLabel(expression: Expression, columns: readonly DatasetColumn[]): string {
  if (expression.type === 'literal') return displayCellValue(expression.value);
  if (expression.type === 'column') return columnHeader(expression.columnId, columns);
  if (expression.type === 'unary') return `${expression.operator}(${expressionLabel(expression.operand, columns)})`;
  return `${expressionLabel(expression.left, columns)} ${expression.operator} ${expressionLabel(expression.right, columns)}`;
}

function transformValueLabel(type: Exclude<TransformCommand['type'], 'editCell'>): string {
  if (type === 'findReplace') return 'Localizar';
  if (type === 'renameHeader') return 'Novo cabeçalho';
  if (type === 'splitColumn') return 'Delimitador';
  if (type === 'combineColumns') return 'Separador';
  if (type === 'calculatedColumn') return 'Nome da nova coluna';
  if (type === 'conditionalRule') return 'Valor de comparação';
  if (type === 'filter') return 'Valor do filtro';
  return 'Valor';
}

function transformExtraLabel(type: Exclude<TransformCommand['type'], 'editCell'>): string {
  if (type === 'findReplace') return 'Substituir por';
  if (type === 'splitColumn') return 'Cabeçalhos novos, separados por vírgula';
  if (type === 'combineColumns') return 'Nome da nova coluna';
  if (type === 'calculatedColumn') return 'Valor ou coluna secundária';
  return 'Valor a gravar';
}

function buildTransform(
  type: Exclude<TransformCommand['type'], 'editCell'>,
  form: {
    columnId: string;
    secondColumnId: string;
    value: string;
    extra: string;
    typedValue: CellValue;
    typedExtraValue: CellValue;
    operator: string;
    filterOperator: FilterOperator;
    when?: TransformConditionNode;
  },
  dataset: Dataset,
): TransformCommand | null {
  const newColumn = (header: string) => ({ id: makeColumnId(header || 'Nova coluna', dataset.columns.length), header: header || 'Nova coluna' });
  const withCondition = <T extends object>(command: T): T & { when?: TransformConditionNode } => form.when ? { ...command, when: form.when } : command;
  switch (type) {
    case 'reorderColumns': return { type, columnIds: [form.columnId, ...dataset.columns.map(({ id }) => id).filter((id) => id !== form.columnId)] };
    case 'sort': return { type, sorts: [{ columnId: form.columnId, direction: form.value === 'desc' ? 'desc' : 'asc' }] };
    case 'filter': return { type, columnId: form.columnId, operator: form.filterOperator, value: form.typedValue };
    case 'removeEmptyRows': return { type, columnIds: [form.columnId] };
    case 'deduplicate': return { type, columnIds: [form.columnId], keep: form.value === 'last' ? 'last' : 'first' };
    case 'renameHeader': return { type, columnId: form.columnId, header: form.value || 'Sem título' };
    case 'splitColumn': {
      const headers = form.extra.split(',').map((header) => header.trim()).filter(Boolean);
      const finalHeaders = headers.length > 0 ? headers : ['Parte 1', 'Parte 2'];
      return withCondition({ type, columnId: form.columnId, delimiter: form.value || ' ', newColumns: finalHeaders.map((header, index) => ({ id: makeColumnId(header, dataset.columns.length + index), header })) });
    }
    case 'combineColumns': return withCondition({ type, columnIds: [form.columnId, form.secondColumnId], separator: form.value, newColumn: newColumn(form.extra) });
    case 'findReplace': return withCondition({ type, columnIds: [form.columnId], find: form.typedValue, replace: form.typedExtraValue, caseSensitive: false });
    case 'dateConversion': return withCondition({ type, columnId: form.columnId, inputFormat: 'auto' as const, outputFormat: (form.value === 'dd/MM/yyyy' ? 'dd/MM/yyyy' : 'yyyy-MM-dd') as 'dd/MM/yyyy' | 'yyyy-MM-dd' });
    case 'numberConversion': return withCondition({ type, columnId: form.columnId, decimalSeparator: (form.value === ',' ? ',' : '.') as '.' | ',' });
    case 'currencyConversion': return withCondition({ type, columnId: form.columnId, locale: form.value || 'pt-BR', currency: form.extra || 'BRL' });
    case 'prefix': return withCondition({ type, columnId: form.columnId, value: form.value });
    case 'suffix': return withCondition({ type, columnId: form.columnId, value: form.value });
    case 'fixedValue': return withCondition({ type, columnId: form.columnId, value: form.typedValue });
    case 'calculatedColumn': {
      const command: Extract<TransformCommand, { type: 'calculatedColumn' }> = {
        type,
        newColumn: newColumn(form.value),
        expression: {
          type: 'binary',
          operator: form.operator as '+' | '-' | '*' | '/' | '==' | '!=' | '>' | '>=' | '<' | '<=' | 'and' | 'or',
          left: { type: 'column', columnId: form.columnId },
          right: form.extra === '' ? { type: 'column', columnId: form.secondColumnId } : { type: 'literal', value: Number.isFinite(Number(form.extra)) ? Number(form.extra) : form.extra },
        },
      };
      return form.when ? { ...command, when: form.when } : command;
    }
    case 'conditionalRule': return {
      type,
      condition: form.when ?? { type: 'predicate', columnId: form.columnId, operator: 'equals', operand: { type: 'literal', value: form.typedValue } },
      updates: [{ columnId: form.secondColumnId, value: form.typedExtraValue }],
    };
  }
}

const APP_STYLES = `
  :root { color: #17251f; background: #f2f5f3; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at top right, #dfeee5 0, transparent 32rem), #f2f5f3; }
  button, input, select { font: inherit; }
  button { cursor: pointer; }
  button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .55; }
  .app-shell { width: min(1500px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 48px; }
  .app-header { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
  .brand-mark { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px; color: white; background: #176b45; font-weight: 900; box-shadow: 0 8px 24px #176b4530; }
  .app-header p { margin: 0 0 2px; color: #648074; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
  .app-header h1 { margin: 0; font-size: 23px; letter-spacing: -.03em; }
  .app-header .text-button { margin-left: auto; }
  .text-button { border: 0; color: #176b45; background: transparent; font-weight: 750; }
  .stepper { margin-bottom: 18px; overflow-x: auto; }
  .stepper ol { display: grid; grid-template-columns: repeat(10, minmax(116px, 1fr)); min-width: 1160px; margin: 0; padding: 0; list-style: none; }
  .stepper li { position: relative; }
  .stepper li:not(:last-child)::after { content: ""; position: absolute; z-index: 0; top: 16px; right: -18%; width: 36%; height: 1px; background: #c8d5cf; }
  .stepper button { position: relative; z-index: 1; display: grid; justify-items: center; gap: 7px; width: 100%; border: 0; color: #718078; background: transparent; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .stepper button span { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #bdcac4; border-radius: 50%; background: #f2f5f3; font-size: 10px; }
  .stepper li[data-state="current"] button { color: #124f35; }
  .stepper li[data-state="current"] button span, .stepper li[data-state="visited"] button span { border-color: #176b45; color: white; background: #176b45; }
  .workflow-card { overflow: hidden; border: 1px solid #d9e1dd; border-radius: 22px; background: rgba(255,255,255,.94); box-shadow: 0 20px 70px rgba(28,54,42,.09); }
  .step-heading { padding: 28px 34px 24px; border-bottom: 1px solid #e6ebe8; }
  .step-heading span { color: #32815d; font-size: 11px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
  .step-heading h2 { margin: 6px 0 5px; font-size: 26px; letter-spacing: -.035em; }
  .step-heading p { margin: 0; color: #65766e; }
  .step-content { min-height: 340px; padding: 30px 34px; }
  .workflow-footer { display: flex; justify-content: space-between; padding: 20px 34px; border-top: 1px solid #e6ebe8; background: #fbfcfb; }
  .primary-button, .secondary-button, .mapping-actions button, .mapping-bulk-actions button, .command-toolbar button, .command-stack button, .validation-layout button, .operation-panel button { min-height: 40px; padding: 9px 16px; border-radius: 10px; font-weight: 750; }
  .primary-button { border: 1px solid #176b45; color: white; background: #176b45; box-shadow: 0 5px 13px #176b4524; }
  .secondary-button { border: 1px solid #bac8c1; color: #274538; background: white; }
  .visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .file-drop { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px; padding: 26px; border: 1.5px dashed #a9c2b6; border-radius: 17px; background: #f8fbf9; transition: .2s ease; }
  .file-drop[data-dragging] { border-color: #176b45; background: #edf7f1; transform: translateY(-2px); }
  .file-drop-mark { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; color: #176b45; background: #e2f1e8; font-size: 26px; font-weight: 800; }
  .file-drop strong { display: block; margin-bottom: 4px; }
  .file-drop p { margin: 0; color: #6f7e77; font-size: 13px; }
  .file-drop label { cursor: pointer; }
  .field { display: grid; gap: 7px; max-width: 420px; margin-top: 22px; color: #3c5148; font-size: 13px; font-weight: 750; }
  .field select, .transform-form select, .transform-form input, .mapping-grid select, .mapping-grid input, .inline-form select { width: 100%; min-height: 42px; padding: 8px 11px; border: 1px solid #c9d4cf; border-radius: 9px; color: #17251f; background: white; }
  .selection-note { color: #176b45; font-weight: 700; }
  .dataset-facts, .export-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 22px 0 0; }
  .dataset-facts div, .export-summary div { padding: 17px; border: 1px solid #dfE7e3; border-radius: 13px; background: #fbfcfb; }
  .dataset-facts dt, .export-summary dt { color: #708078; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .dataset-facts dd, .export-summary dd { margin: 6px 0 0; color: #173e2c; font-size: 20px; font-weight: 850; }
  .candidate-list { display: grid; gap: 10px; }
  .candidate-list > label { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; padding: 18px; border: 1px solid #d6dfdb; border-radius: 14px; background: #fff; cursor: pointer; }
  .candidate-list > label[data-selected] { border-color: #2b865e; background: #f0f8f4; box-shadow: 0 0 0 2px #2b865e18; }
  .candidate-list span { display: grid; gap: 3px; }
  .candidate-list small { color: #6d7c75; }
  .candidate-list em { color: #267651; font-size: 12px; font-style: normal; font-weight: 800; }
  .mapping-grid { overflow-x: auto; border: 1px solid #dce4e0; border-radius: 14px; }
  .mapping-header, .mapping-row { display: grid; grid-template-columns: minmax(140px,.8fr) minmax(220px,1.2fr) minmax(130px,.65fr) minmax(330px,1.8fr); align-items: center; min-width: 950px; }
  .mapping-header { color: #6c7a73; background: #f5f8f6; font-size: 11px; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
  .mapping-header > *, .mapping-row > * { padding: 14px; }
  .mapping-row { border-top: 1px solid #e6ebe8; }
  .mapping-row select + input { margin-top: 7px; }
  .confidence { font-size: 12px; font-weight: 750; }
  .confidence-exact, .confidence-high { color: #1c7750; }
  .confidence-medium { color: #9a6819; }
  .confidence-low { color: #a44c46; }
  .mapping-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mapping-actions button { min-height: 32px; padding: 6px 9px; border: 1px solid #cbd6d1; color: #315245; background: white; font-size: 11px; }
  .mapping-bulk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
  .mapping-bulk-actions button { border: 1px solid #cbd6d1; color: #315245; background: white; }
  .status-ok, .status-review { width: 100%; font-size: 11px; font-weight: 850; }
  .status-ok { color: #177048; } .status-review { color: #9a6819; }
  .transform-layout, .validation-layout { display: grid; grid-template-columns: minmax(300px,.8fr) minmax(420px,1.4fr); gap: 22px; align-items: start; }
  .transform-form, .command-stack, .panel-section { padding: 20px; border: 1px solid #dde5e1; border-radius: 14px; background: #fbfcfb; }
  .transform-form { display: grid; gap: 13px; }
  .transform-form h3, .command-stack h3, .panel-section h3 { margin: 0; }
  .transform-form label, .inline-form label { display: grid; gap: 5px; color: #4f6259; font-size: 12px; font-weight: 750; }
  .form-help { margin: 0; color: #708078; font-size: 12px; }
  .form-error { margin: 0; color: #a53a3a; font-size: 12px; }
  .value-picker { display: grid; gap: 4px; }
  .condition-builder, .condition-group, .condition-row { display: grid; gap: 10px; padding: 12px; border: 1px solid #d5e1da; border-radius: 10px; background: #f7faf8; }
  .condition-builder legend, .condition-group legend, .condition-row legend { padding: 0 5px; color: #3d5f4e; font-size: 12px; font-weight: 800; }
  .condition-row { background: white; }
  .condition-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .command-toolbar { display: flex; align-items: center; gap: 7px; }
  .command-toolbar h3 { margin-right: auto; }
  .command-table-scroll { overflow-x: auto; margin-top: 16px; border: 1px solid #e1e8e4; border-radius: 10px; background: white; }
  .command-table { width: 100%; min-width: 900px; border-collapse: collapse; text-align: left; font-size: 12px; }
  .command-table th, .command-table td { padding: 11px 10px; border-bottom: 1px solid #e8eeeb; vertical-align: top; }
  .command-table thead th { color: #6c7a73; background: #f5f8f6; font-size: 10px; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
  .command-table tbody tr:last-child th, .command-table tbody tr:last-child td { border-bottom: 0; }
  .command-table tbody th { color: #274538; font-weight: 800; }
  .command-index { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; color: #176b45; background: #e6f2eb; font-size: 11px; font-weight: 850; }
  .command-target, .command-condition, .command-details dd { overflow-wrap: anywhere; white-space: pre-wrap; }
  .command-details { display: grid; gap: 5px; margin: 0; }
  .command-details div { display: grid; grid-template-columns: max-content minmax(120px, 1fr); gap: 7px; }
  .command-details dt { color: #708078; font-size: 10px; font-weight: 800; }
  .command-details dd { margin: 0; color: #243e32; }
  .command-actions { display: flex; gap: 5px; }
  .command-toolbar button, .command-stack li button { min-height: 32px; padding: 5px 9px; border: 1px solid #cbd5d0; color: #355146; background: white; }
  .command-stack ol { display: grid; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
  .command-stack li { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 9px; padding: 10px; border: 1px solid #e1e8e4; border-radius: 10px; background: white; }
  .command-stack li > span { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; color: #176b45; background: #e6f2eb; font-size: 11px; font-weight: 850; }
  .command-stack li div { display: flex; gap: 5px; }
  .validation-layout { grid-template-columns: 1fr 1fr; }
  .panel-section ul { padding-left: 20px; color: #52655c; }
  .panel-section li { margin: 8px 0; }
  .inline-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-top: 14px; align-items: end; }
  .validation-run { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 16px; border-radius: 12px; background: #eff6f2; }
  .issue-list { grid-column: 1 / -1; display: grid; gap: 7px; }
  .issue-list button { display: grid; grid-template-columns: 100px 160px 1fr; gap: 10px; text-align: left; border: 1px solid #edd2cf; color: #69342e; background: #fff8f7; }
  .issue-list button.warning-issue { border-color: #ecd9a8; color: #735319; background: #fffaf0; }
  .conditional-matrices-section { grid-column: 1 / -1; }
  .matrix-column-picker { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 14px; margin: 14px 0; }
  .matrix-column-picker fieldset { min-width: 0; padding: 12px; border: 1px solid #dce6e0; border-radius: 10px; background: white; }
  .matrix-column-picker legend { padding: 0 5px; color: #4f6259; font-size: 12px; font-weight: 800; }
  .searchable-list-search { display: grid; gap: 5px; color: #52655c; font-size: 11px; font-weight: 800; }
  .searchable-list-search input, .matrix-entry-search input { width: 100%; min-height: 34px; padding: 6px 8px; border: 1px solid #c9d4cf; border-radius: 7px; color: #17251f; background: white; font-size: 12px; }
  .searchable-list-results { display: grid; gap: 7px; margin-top: 8px; color: #708078; font-size: 11px; }
  .searchable-checklist-viewport { display: grid; gap: 7px; height: clamp(180px, 26vh, 260px); overflow-y: auto; padding-right: 5px; }
  .searchable-checklist-viewport label { display: flex; gap: 8px; align-items: center; color: #52655c; font-size: 12px; }
  .matrix-entry-search { display: grid; grid-template-columns: minmax(240px, 1fr) auto; gap: 12px; align-items: end; padding: 10px 0; color: #708078; font-size: 11px; font-weight: 800; }
  .matrix-entry-search label { display: grid; gap: 5px; }
  .matrix-entry-search > span { padding-bottom: 9px; white-space: nowrap; }
  .conditional-matrix-card { display: grid; gap: 12px; margin-top: 18px; padding: 16px; border: 1px solid #d7e3dc; border-radius: 12px; background: white; }
  .matrix-card-heading, .matrix-toolbar, .matrix-actions { display: flex; align-items: center; gap: 9px; }
  .matrix-card-heading strong { margin-right: auto; color: #274538; }
  .matrix-toolbar > div:first-child { margin-right: auto; }
  .matrix-toolbar p { margin: 5px 0 0; font-size: 12px; }
  .matrix-actions { flex-wrap: wrap; }
  .conditional-matrix-scroll { height: clamp(260px, 42vh, 440px); overflow: auto; border: 1px solid #dce6e0; border-radius: 10px; }
  .conditional-matrix-table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 12px; }
  .conditional-matrix-table th { padding: 9px; border-bottom: 1px solid #dce6e0; color: #4f6259; background: #f4f8f5; text-align: left; white-space: nowrap; }
  .conditional-matrix-table td { min-width: 150px; padding: 8px; border-bottom: 1px solid #edf1ef; vertical-align: top; }
  .conditional-matrix-table select, .conditional-matrix-table input { width: 100%; min-height: 34px; margin-bottom: 5px; padding: 6px 8px; border: 1px solid #c9d4cf; border-radius: 7px; color: #17251f; background: white; font-size: 12px; }
  .conditional-matrix-table td:last-child { min-width: 92px; }
  .matrix-range-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .validation-export-choice, .warning-export-choice { display: grid; gap: 8px; margin: 18px 0; padding: 13px; border: 1px solid #dce6e0; border-radius: 10px; color: #4f6259; }
  .validation-export-choice legend, .warning-export-choice legend { padding: 0 5px; font-size: 12px; font-weight: 800; }
  .validation-export-choice label, .warning-export-choice label { display: flex; gap: 8px; align-items: center; font-size: 12px; }
  .data-grid-shell { overflow: hidden; border: 1px solid #d8e1dc; border-radius: 14px; }
  .grid-toolbar { display: flex; justify-content: space-between; padding: 11px 14px; color: #52655c; background: #f5f8f6; font-size: 12px; font-weight: 700; }
  .grid-toolbar label { display: flex; gap: 8px; }
  .data-grid-header, .data-grid-row { display: grid; }
  .data-grid-header { overflow: hidden; color: #44574e; background: #eaf0ed; font-size: 11px; font-weight: 850; }
  .data-grid-header > div, .data-grid-row > div { min-width: 0; padding: 10px; border-right: 1px solid #dde5e1; }
  .data-grid-header-cell { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-box-align: center; -webkit-line-clamp: 3; white-space: normal; }
  .data-grid-viewport { position: relative; height: 360px; overflow: auto; background: white; }
  .data-grid-row { position: absolute; top: 0; left: 0; width: 100%; min-height: 42px; border-bottom: 1px solid #e6ebe8; }
  .data-grid-row > div { padding: 5px 8px; }
  .data-grid-row [role="rowheader"] { color: #728078; background: #f8faf9; font-size: 11px; font-weight: 750; }
  .data-grid-row input { width: 100%; height: 31px; padding: 4px 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; }
  .data-grid-row input:hover, .data-grid-row input:focus { border-color: #8fb7a3; outline: none; background: #f7fbf9; }
  .data-grid-row [data-invalid] { box-shadow: inset 3px 0 #c75b50; background: #fff8f7; }
  .write-mode-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .write-mode-grid > label { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 9px; padding: 18px; border: 1px solid #d7e0dc; border-radius: 14px; cursor: pointer; }
  .write-mode-grid > label[data-selected] { border-color: #277c55; background: #f0f8f4; }
  .write-mode-grid > label span { grid-column: 2; color: #697971; font-size: 12px; line-height: 1.5; }
  .key-columns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 12px; padding: 16px; border: 1px solid #d7e0dc; border-radius: 12px; }
  .key-columns legend { padding: 0 6px; font-weight: 800; }
  .key-columns label { display: flex; gap: 6px; }
  .export-summary { grid-template-columns: repeat(5, 1fr); }
  .export-summary dd { font-size: 28px; }
  .summary-note { margin-top: 18px; color: #66766e; }
  .export-panel { display: grid; justify-items: center; padding: 28px; text-align: center; }
  .export-icon { display: grid; place-items: center; width: 76px; height: 76px; border-radius: 22px; color: white; background: #176b45; font-size: 13px; font-weight: 900; letter-spacing: .08em; box-shadow: 0 14px 30px #176b4538; }
  .export-panel h3 { margin: 18px 0 5px; font-size: 24px; }
  .export-panel p { margin: 0 0 20px; color: #687870; }
  .export-button { min-width: 220px; }
  .operation-panel { display: grid; grid-template-columns: minmax(160px,auto) 1fr 54px auto; align-items: center; gap: 13px; margin: 18px 34px 0; padding: 13px 16px; border: 1px solid #b9d5c7; border-radius: 12px; background: #f0f8f4; }
  .operation-panel div { display: grid; } .operation-panel div span { color: #667870; font-size: 11px; }
  .operation-panel progress { width: 100%; accent-color: #176b45; }
  .operation-panel button { border: 1px solid #b9c8c1; color: #375246; background: white; }
  .error-banner { margin: 18px 34px 0; padding: 13px 16px; border: 1px solid #e6b8b2; border-radius: 11px; color: #7b332d; background: #fff3f2; }
  .matrix-error-details { max-height: clamp(80px, 14vh, 180px); overflow-y: auto; margin-top: 8px; padding-right: 6px; }
  .matrix-error-details p { margin: 5px 0 0; }
  @media (max-width: 900px) {
    .app-shell { width: min(100% - 20px, 1500px); padding-top: 16px; }
    .step-heading, .step-content, .workflow-footer { padding-left: 20px; padding-right: 20px; }
    .file-drop { grid-template-columns: auto 1fr; } .file-drop label { grid-column: 1 / -1; text-align: center; }
    .transform-layout, .validation-layout { grid-template-columns: 1fr; }
    .validation-run, .issue-list { grid-column: 1; }
    .write-mode-grid { grid-template-columns: 1fr; } .key-columns { grid-column: 1; }
    .export-summary { grid-template-columns: repeat(2, 1fr); }
    .operation-panel { grid-template-columns: 1fr auto; } .operation-panel progress { grid-column: 1 / -1; order: 3; }
  }
  @media (max-width: 560px) {
    .app-header p { display: none; }
    .app-header h1 { font-size: 19px; }
    .file-drop { grid-template-columns: 1fr; text-align: center; justify-items: center; }
    .dataset-facts { grid-template-columns: 1fr; }
    .inline-form { grid-template-columns: 1fr; }
    .issue-list button { grid-template-columns: 1fr; }
    .matrix-column-picker { grid-template-columns: 1fr; }
    .matrix-entry-search { grid-template-columns: 1fr; }
    .matrix-entry-search > span { padding-bottom: 0; }
    .matrix-toolbar { align-items: flex-start; flex-direction: column; }
    .matrix-toolbar > div:first-child { margin-right: 0; }
    .workflow-footer { position: sticky; bottom: 0; z-index: 3; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
`;
