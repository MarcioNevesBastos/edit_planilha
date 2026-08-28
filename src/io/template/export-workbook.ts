import type { CellValue } from '../../domain/dataset/types';
import type { MappingSuggestion } from '../../domain/mapping/types';
import type { WriteInsert, WritePlan, WriteUpdate } from '../../domain/merge/types';
import type { ValidationResult } from '../../domain/validation/types';
import { expandDestination } from './model-expander';
import { type OoxmlPackage } from './ooxml-package';
import { addRejectedSheet, type RejectedSheetRow } from './rejected-sheet';
import { preparePackageForExport } from './protection-sanitizer';
import type { DefinedNameIdentity } from './destination-detector';
import { indexWorkbook, type WorksheetIndex } from './workbook-index';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXCEL_MAX_ROW = 1_048_576;

export type ExportRiskSeverity = 'hard' | 'soft';

export interface ExportRisk {
  code: string;
  severity: ExportRiskSeverity;
  message: string;
  partPath?: string;
}

export interface ExportDestinationColumn {
  id: string;
  column: string;
}

export interface ExportDestination {
  sheetName: string;
  range: string;
  dataStartRow: number;
  templateRow: number;
  tablePath?: string;
  definedName?: DefinedNameIdentity;
  columns: readonly ExportDestinationColumn[];
}

export interface ExportInput {
  package: OoxmlPackage;
  destination: ExportDestination;
  mappings: readonly MappingSuggestion[];
  writePlan: WritePlan;
  validationResult: ValidationResult;
  rejectedRows?: readonly RejectedSheetRow[];
  reviewedRiskCodes?: readonly string[];
  reviewedRiskIds?: readonly string[];
}

export type ExportBatchPhase = 'expansion' | 'write' | 'rejected';

export interface ExportBatchProgress {
  completed: number;
  total: number;
  phase: ExportBatchPhase;
}

export interface ExportBatchOptions {
  batchSize: number;
  onProgress(progress: ExportBatchProgress): Promise<void> | void;
}

export class ExportCompatibilityError extends Error {
  constructor(public readonly risks: ExportRisk[]) {
    super(risks.map((risk) => risk.message).join('; '));
    this.name = 'ExportCompatibilityError';
  }
}

export function exportRiskIdentifier(risk: ExportRisk): string {
  return `${risk.code}|${risk.partPath ?? ''}`;
}

interface CellRange {
  startColumn: number;
  startRow: number;
  endColumn: number;
  endRow: number;
}

interface ResolvedMapping {
  sourceColumnId: string;
  destinationColumn: string;
}

interface IndexedCell {
  column: number;
  start: number;
  end: number;
  xml: string;
}

interface IndexedRow {
  raw: string;
  cells: IndexedCell[];
  cellsByColumn: Map<number, IndexedCell>;
  updates: Map<number, string>;
}

interface IndexedWorksheet {
  sheetData: string;
  rows: Map<number, IndexedRow>;
}

type WriteAction = WriteInsert | WriteUpdate;

export async function scanExportRisks(input: ExportInput): Promise<ExportRisk[]> {
  const risks: ExportRisk[] = [];
  const addRisk = (risk: ExportRisk) => {
    if (!risks.some((current) => current.code === risk.code && current.partPath === risk.partPath)) {
      risks.push(risk);
    }
  };

  if (input.package.hasPart('EncryptionInfo') || input.package.hasPart('EncryptedPackage')) {
    addRisk({
      code: 'unsupported-encrypted-package',
      severity: 'hard',
      message: 'Pacotes OOXML criptografados não são suportados.',
    });
  }

  if (input.package.hasPart('[Content_Types].xml')) {
    const contentTypes = decode(input.package.readPart('[Content_Types].xml'));
    if (/macroEnabled|vbaProject/i.test(contentTypes)) {
      addRisk({
        code: 'unsupported-macro-package',
        severity: 'hard',
        message: 'Pastas de trabalho com macro estão fora do formato de exportação suportado.',
        partPath: '[Content_Types].xml',
      });
    }
  }

  const index = await indexWorkbook(input.package);
  const sheet = index.sheets.find(({ name }) => name === input.destination.sheetName);
  if (!sheet) {
    addRisk({
      code: 'destination-sheet-not-found',
      severity: 'hard',
      message: `Aba de destino não encontrada: ${input.destination.sheetName}`,
    });
    return risks;
  }
  if (index.workbookProtected) {
    addRisk({
      code: 'protected-workbook',
      severity: 'hard',
      message: 'A pasta de trabalho de destino está protegida.',
      partPath: index.workbookPath,
    });
  }
  if (sheet.protected) {
    addRisk({
      code: 'protected-destination-sheet',
      severity: 'hard',
      message: `A aba de destino está protegida: ${sheet.name}`,
      partPath: sheet.path,
    });
  }

  scanMappingRisks(input, addRisk);
  scanValidationState(input, addRisk);
  scanPlanRisks(input, addRisk);

  let destinationRange: CellRange | null = null;
  try {
    destinationRange = parseRange(input.destination.range);
  } catch (error) {
    addRisk({
      code: 'invalid-destination-range',
      severity: 'hard',
      message: error instanceof Error ? error.message : String(error),
      partPath: sheet.path,
    });
  }

  if (destinationRange) {
    scanDestinationGeometry(input, destinationRange, addRisk);
    const resolvedMappings = resolveMappings(input);
    for (const mapping of resolvedMappings) {
      const column = columnNumber(mapping.destinationColumn);
      if (column < destinationRange.startColumn || column > destinationRange.endColumn) {
        addRisk({
          code: 'mapping-outside-destination',
          severity: 'hard',
          message: `A coluna mapeada ${mapping.destinationColumn} está fora de ${input.destination.range}.`,
          partPath: sheet.path,
        });
      }
    }
    scanWorksheetRisks(input, sheet, resolvedMappings, addRisk);
    scanTableRisks(input, sheet, resolvedMappings, addRisk);
    scanNamedRangeRisks(input, index.definedNames, destinationRange, addRisk);
  }

  return risks;
}

export async function exportWorkbook(input: ExportInput, options?: ExportBatchOptions): Promise<Blob> {
  const preparedPackage = await preparePackageForExport(input.package);
  const preparedInput = { ...input, package: preparedPackage };
  const risks = await scanExportRisks(preparedInput);
  const reviewed = new Set(preparedInput.reviewedRiskCodes ?? []);
  const reviewedIds = new Set(preparedInput.reviewedRiskIds ?? []);
  const blockers = risks.filter(
    (risk) => risk.severity === 'hard'
      || (!reviewed.has(risk.code) && !reviewedIds.has(exportRiskIdentifier(risk))),
  );
  if (blockers.length > 0) {
    throw new ExportCompatibilityError(blockers);
  }

  const working = preparedInput.package;
  const index = await indexWorkbook(working);
  const sheet = requireSheet(index.sheets, preparedInput.destination.sheetName);
  const invalidRowIds = validationErrorRowIds(preparedInput.validationResult);
  const writeActions = validWriteActions(preparedInput.writePlan, invalidRowIds);
  const maxDestinationRow = Math.max(
    preparedInput.destination.dataStartRow - 1,
    ...writeActions.map(({ destinationRow }) => destinationRow),
  );
  const destinationRange = parseRange(preparedInput.destination.range);
  const expansionRows = Math.max(0, maxDestinationRow - destinationRange.endRow);
  const writeRows = preparedInput.writePlan.clears.length
    + preparedInput.writePlan.inserts.length
    + preparedInput.writePlan.updates.length;
  const rejectedRows = preparedInput.rejectedRows?.length ?? 0;
  const totalWorkRows = expansionRows + writeRows + rejectedRows;

  if (options) assertExportBatchSize(options.batchSize);
  const reportProgress = options
    ? (phase: ExportBatchPhase, completed: number) => options.onProgress({
      completed: phase === 'expansion'
        ? completed
        : phase === 'write'
          ? expansionRows + completed
          : expansionRows + writeRows + completed,
      total: totalWorkRows,
      phase,
    })
    : undefined;

  await expandDestination(working, {
    worksheetPath: sheet.path,
    destinationRange: preparedInput.destination.range,
    dataStartRow: preparedInput.destination.dataStartRow,
    templateRow: preparedInput.destination.templateRow,
    requiredDataRows: Math.max(
      1,
      maxDestinationRow - preparedInput.destination.dataStartRow + 1,
    ),
    ...(preparedInput.destination.tablePath ? { tablePath: preparedInput.destination.tablePath } : {}),
  }, options && {
    batchSize: options.batchSize,
    onProgress: ({ completed }) => reportProgress?.('expansion', completed),
  });

  const targetLastRow = Math.max(destinationRange.endRow, maxDestinationRow);
  if (preparedInput.destination.definedName && targetLastRow > destinationRange.endRow) {
    updateDefinedName(
      working,
      index.workbookPath,
      preparedInput.destination.definedName,
      targetLastRow,
    );
  }

  const worksheet = decode(working.readPart(sheet.path));
  working.updatePart(
    sheet.path,
    await applyWritePlan(
      worksheet,
      preparedInput,
      resolveMappings(preparedInput),
      invalidRowIds,
      options && {
        batchSize: options.batchSize,
        onProgress: ({ completed }) => reportProgress?.('write', completed),
      },
    ),
  );

  if ((preparedInput.rejectedRows?.length ?? 0) > 0) {
    await addRejectedSheet(working, preparedInput.rejectedRows ?? [], options && {
      batchSize: options.batchSize,
      onProgress: ({ completed }) => reportProgress?.('rejected', completed),
    });
  }

  return new Blob([await working.emit()], { type: XLSX_MIME });
}

function scanMappingRisks(input: ExportInput, addRisk: (risk: ExportRisk) => void): void {
  if (input.mappings.length === 0) {
    addRisk({
      code: 'empty-mappings',
      severity: 'hard',
      message: 'A exportação exige pelo menos um mapeamento revisado ou uma ignorada explícita.',
    });
  }
  const destinationIds = new Set(input.destination.columns.map(({ id }) => id));
  const destinationColumns = new Set<string>();
  const mappingsBySource = new Map<string, number>();
  for (const mapping of input.mappings) {
    mappingsBySource.set(
      mapping.sourceColumnId,
      (mappingsBySource.get(mapping.sourceColumnId) ?? 0) + 1,
    );
    if (mapping.status !== 'accepted') {
      addRisk({
        code: 'unreviewed-mapping',
        severity: 'hard',
        message: `O mapeamento de ${mapping.sourceColumnId} não foi aceito explicitamente.`,
      });
      continue;
    }
    if (mapping.destinationColumnId === null) {
      continue;
    }
    if (!destinationIds.has(mapping.destinationColumnId)) {
      addRisk({
        code: 'unknown-destination-column',
        severity: 'hard',
        message: `Coluna de destino mapeada não encontrada: ${mapping.destinationColumnId}`,
      });
      continue;
    }
    const destination = input.destination.columns.find(({ id }) => (
      id === mapping.destinationColumnId
    ));
    if (!destination || !/^[A-Z]{1,3}$/i.test(destination.column)) {
      addRisk({
        code: 'invalid-destination-column',
        severity: 'hard',
        message: `Coluna de destino inválida para ${mapping.destinationColumnId}.`,
      });
      continue;
    }
    const normalizedColumn = destination.column.toUpperCase();
    if (destinationColumns.has(normalizedColumn)) {
      addRisk({
        code: 'duplicate-destination-mapping',
        severity: 'hard',
        message: `Várias colunas de origem apontam para a coluna de destino ${normalizedColumn}.`,
      });
    }
    destinationColumns.add(normalizedColumn);
  }

  const plannedSourceFields = new Set(
    [...input.writePlan.inserts, ...input.writePlan.updates].flatMap(
      ({ values }) => Object.keys(values),
    ),
  );
  for (const sourceColumnId of plannedSourceFields) {
    const matchingCount = mappingsBySource.get(sourceColumnId) ?? 0;
    const accepted = input.mappings.find((mapping) => (
      mapping.sourceColumnId === sourceColumnId
      && mapping.status === 'accepted'
    ));
    if (matchingCount !== 1 || !accepted) {
      addRisk({
        code: 'missing-planned-source-mapping',
        severity: 'hard',
        message: `O campo de origem planejado ${sourceColumnId} não possui exatamente um mapeamento aceito ou uma ignorada.`,
      });
    }
  }
}

function scanValidationState(input: ExportInput, addRisk: (risk: ExportRisk) => void): void {
  const expectedValidity = input.validationResult.issues.every(({ severity }) => (severity ?? 'error') !== 'error');
  if (input.validationResult.isValid !== expectedValidity) {
    addRisk({
      code: 'inconsistent-validation-state',
      severity: 'hard',
      message: 'O estado de validação não corresponde à lista de problemas.',
    });
  }
}

function validationErrorRowIds(validation: ValidationResult): Set<string> {
  return new Set(validation.issues
    .filter(({ severity }) => (severity ?? 'error') === 'error')
    .map(({ rowId }) => rowId));
}

function scanDestinationGeometry(
  input: ExportInput,
  destinationRange: CellRange,
  addRisk: (risk: ExportRisk) => void,
): void {
  const invalid = destinationRange.startColumn > destinationRange.endColumn
    || destinationRange.startRow > destinationRange.endRow
    || destinationRange.startRow < 1
    || destinationRange.endRow > 1048576
    || input.writePlan.headerRow !== destinationRange.startRow
    || input.destination.dataStartRow <= input.writePlan.headerRow
    || input.destination.dataStartRow > destinationRange.endRow
    || input.destination.templateRow < input.destination.dataStartRow
    || input.destination.templateRow > destinationRange.endRow;
  if (invalid) {
    addRisk({
      code: 'invalid-destination-geometry',
      severity: 'hard',
      message: 'O intervalo de destino, cabeçalho, início dos dados e linhas de modelo são inconsistentes.',
    });
  }

  for (const destination of input.destination.columns) {
    if (!/^[A-Z]{1,3}$/i.test(destination.column)) {
      addRisk({
        code: 'invalid-destination-geometry',
        severity: 'hard',
        message: `Coluna física de destino inválida: ${destination.column}.`,
      });
      continue;
    }
    const column = columnNumber(destination.column);
    if (column < destinationRange.startColumn || column > destinationRange.endColumn) {
      addRisk({
        code: 'invalid-destination-geometry',
        severity: 'hard',
        message: `A coluna de destino ${destination.column} está fora de ${input.destination.range}.`,
      });
    }
  }
}

function scanNamedRangeRisks(
  input: ExportInput,
  definedNames: readonly {
    name: string;
    formula: string;
    localSheetId: number | null;
    sheetName: string | null;
    range: string | null;
  }[],
  destinationRange: CellRange,
  addRisk: (risk: ExportRisk) => void,
): void {
  const targetLastRow = Math.max(
    destinationRange.endRow,
    ...validWriteActions(
      input.writePlan,
      validationErrorRowIds(input.validationResult),
    ).map(({ destinationRow }) => destinationRow),
  );
  const expands = targetLastRow > destinationRange.endRow;
  const matchingNames = definedNames.filter((definedName) => (
    definedName.sheetName === input.destination.sheetName
    && definedName.range !== null
    && normalizeRange(definedName.range) === normalizeRange(input.destination.range)
  ));

  if (input.destination.definedName) {
    const identity = input.destination.definedName;
    const declared = definedNames.find(({ name, localSheetId }) => (
      name === identity.name && localSheetId === identity.localSheetId
    ));
    if (!declared || declared.sheetName !== input.destination.sheetName || !declared.range
      || normalizeRange(declared.range) !== normalizeRange(input.destination.range)) {
      addRisk({
        code: 'invalid-defined-name-metadata',
        severity: 'hard',
        message: `Os metadados de nome definido não identificam ${input.destination.range}.`,
      });
    }
    if (declared?.formula && !canExtendDefinedNameFormula(declared.formula)) {
      addRisk({
        code: 'named-range-formula-unsupported',
        severity: 'hard',
        message: `A fórmula de nome definido não pode ser estendida com segurança: ${identity.name}.`,
      });
    }
    return;
  }

  if (expands && matchingNames.length > 0) {
    addRisk({
      code: 'named-range-expansion-unsupported',
      severity: 'hard',
      message: 'A inclusão em um destino nomeado exige metadados explícitos de nome definido.',
    });
  }
}

function scanPlanRisks(input: ExportInput, addRisk: (risk: ExportRisk) => void): void {
  if (input.writePlan.headerRow >= input.destination.dataStartRow) {
    addRisk({
      code: 'invalid-write-boundary',
      severity: 'hard',
      message: 'O cabeçalho do plano de escrita deve anteceder as linhas de dados de destino.',
    });
  }
  for (const action of [
    ...input.writePlan.clears,
    ...input.writePlan.inserts,
    ...input.writePlan.updates,
  ]) {
    if (!Number.isSafeInteger(action.destinationRow)
      || action.destinationRow < input.destination.dataStartRow) {
      addRisk({
        code: 'write-outside-data-rows',
        severity: 'hard',
        message: `A linha de escrita ${action.destinationRow} está fora das linhas de dados de destino.`,
      });
    }
    if (Number.isSafeInteger(action.destinationRow) && action.destinationRow > EXCEL_MAX_ROW) {
      addRisk({
        code: 'write-row-exceeds-excel-limit',
        severity: 'hard',
        message: `A linha de escrita ${action.destinationRow} excede o máximo de linhas do Excel (${EXCEL_MAX_ROW}).`,
      });
    }
  }
  for (const action of [...input.writePlan.inserts, ...input.writePlan.updates]) {
    for (const value of Object.values(action.values)) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        addRisk({
          code: 'non-finite-cell-value',
          severity: 'hard',
          message: 'Números não finitos não podem ser representados com segurança em células OOXML.',
        });
      }
      if (typeof value === 'string' && containsForbiddenXmlCharacter(value)) {
        addRisk({
          code: 'forbidden-xml-character',
          severity: 'hard',
          message: 'O texto da célula contém um caractere proibido pelo XML 1.0.',
        });
      }
    }
  }
  for (const row of input.rejectedRows ?? []) {
    const values = [
      ...Object.keys(row.originalRelevantFields),
      ...Object.values(row.originalRelevantFields),
      row.errorField,
      row.invalidValue,
      row.rejectionReason,
      row.failedRuleOrTransform,
    ];
    if (values.some((value) => typeof value === 'string' && containsForbiddenXmlCharacter(value))) {
      addRisk({
        code: 'forbidden-xml-character',
        severity: 'hard',
        message: 'O texto da linha rejeitada contém um caractere proibido pelo XML 1.0.',
      });
    }
  }
}

function scanWorksheetRisks(
  input: ExportInput,
  sheet: WorksheetIndex,
  mappings: readonly ResolvedMapping[],
  addRisk: (risk: ExportRisk) => void,
): void {
  const worksheet = decode(input.package.readPart(sheet.path));
  const invalidRowIds = validationErrorRowIds(input.validationResult);
  const writeCells = targetCells(input.writePlan, mappings, invalidRowIds);
  const destinationRange = parseRange(input.destination.range);
  const mergedRanges = [...worksheet.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/?\s*>/g)]
    .flatMap((match) => safeParseRanges(match[1]));

  if (writeCells.some((cell) => mergedRanges.some((range) => containsCell(range, cell)))) {
    addRisk({
      code: 'merged-cell-write-conflict',
      severity: 'hard',
      message: 'Uma escrita planejada cruza um intervalo de células mescladas.',
      partPath: sheet.path,
    });
  }

  if (writeCells.some(({ column, row }) => {
    const reference = `${columnName(column)}${row}`;
    const rowXml = findRow(worksheet, row);
    const existingCell = findCell(rowXml ?? '', reference);
    if (existingCell?.includes('<f')) {
      return true;
    }
    if (row <= destinationRange.endRow && rowXml) {
      return false;
    }
    const templateReference = `${columnName(column)}${input.destination.templateRow}`;
    return findCell(
      findRow(worksheet, input.destination.templateRow) ?? '',
      templateReference,
    )?.includes('<f') ?? false;
  })) {
    addRisk({
      code: 'formula-overwrite',
      severity: 'soft',
      message: 'Um mapeamento revisado sobrescreve uma célula que contém fórmula.',
      partPath: sheet.path,
    });
  }
}

function scanTableRisks(
  input: ExportInput,
  sheet: WorksheetIndex,
  mappings: readonly ResolvedMapping[],
  addRisk: (risk: ExportRisk) => void,
): void {
  const invalidRowIds = validationErrorRowIds(input.validationResult);
  const writeCells = targetCells(input.writePlan, mappings, invalidRowIds);
  const touchedTables = sheet.tables.filter((table) => {
    const range = parseRange(table.range);
    return table.path === input.destination.tablePath
      || writeCells.some((cell) => containsCell(range, cell));
  });
  if (touchedTables.length === 0) {
    return;
  }
  const selected = input.destination.tablePath
    ? touchedTables.find(({ path }) => path === input.destination.tablePath)
    : null;
  if (!selected || normalizeRange(selected.range) !== normalizeRange(input.destination.range)) {
    const queryBacked = touchedTables.some(({ path }) => (
      /(?:\btableType\s*=\s*"queryTable"|\bqueryTableFieldId\b)/i.test(
        decode(input.package.readPart(path)),
      )
    )) || hasRelatedQueryTablePart(input.package, sheet.path);
    addRisk({
      code: queryBacked ? 'unsupported-query-table' : 'unknown-table-structure',
      severity: 'hard',
      message: queryBacked
        ? 'Query-backed tables are not supported for export.'
        : 'The write range touches a table that was not selected as the destination model.',
      partPath: selected?.path ?? touchedTables[0].path,
    });
    return;
  }

  const tableXml = decode(input.package.readPart(selected.path));
  if (/<(?:extLst|queryTable|calculatedColumnFormula|totalsRowFormula|xmlColumnPr)\b/i.test(tableXml)
    || /(?:\btableType\s*=\s*"queryTable"|\bqueryTableFieldId\b)/i.test(tableXml)
    || hasRelatedQueryTablePart(input.package, sheet.path)) {
    addRisk({
      code: /queryTable|queryTableFieldId/i.test(tableXml)
        || hasRelatedQueryTablePart(input.package, sheet.path)
        ? 'unsupported-query-table'
        : 'unknown-table-structure',
      severity: 'hard',
      message: /queryTable|queryTableFieldId/i.test(tableXml)
        || hasRelatedQueryTablePart(input.package, sheet.path)
        ? 'Query-backed tables are not supported for export.'
        : 'The selected table contains structures that cannot be updated safely.',
      partPath: selected.path,
    });
  }
}

function hasRelatedQueryTablePart(pkg: OoxmlPackage, worksheetPath: string): boolean {
  const worksheetRelationshipsPath = relationshipPartPath(worksheetPath);
  if (pkg.hasPart(worksheetRelationshipsPath)) {
    const relationships = decode(pkg.readPart(worksheetRelationshipsPath));
    if (/queryTable/i.test(relationships)) {
      return true;
    }
  }

  return pkg.listParts()
    .filter((path) => /queryTable/i.test(path) || /\.xml$/i.test(path))
    .some((path) => /queryTable/i.test(path) && /queryTable/i.test(decode(pkg.readPart(path))));
}

function canExtendDefinedNameFormula(formula: string): boolean {
  return /^.*!\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+$/i.test(formula);
}

function updateDefinedName(
  pkg: OoxmlPackage,
  workbookPath: string,
  definedName: DefinedNameIdentity,
  targetLastRow: number,
): void {
  const workbook = decode(pkg.readPart(workbookPath));
  const matches = [...workbook.matchAll(/(<definedName\b[^>]*>)([\s\S]*?)(<\/definedName>)/g)];
  const match = matches.find((candidate) => {
    const tag = candidate[1];
    const localSheetId = attribute(tag, 'localSheetId');
    return attribute(tag, 'name') === definedName.name
      && (localSheetId === null ? null : Number(localSheetId)) === definedName.localSheetId;
  });
  if (!match) {
    throw new Error(`Nome definido não encontrado: ${definedName.name}`);
  }
  const formula = match[2];
  const updatedFormula = formula.replace(
    /(\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?)\d+$/i,
    `$1${targetLastRow}`,
  );
  if (updatedFormula === formula) {
    throw new Error(`A fórmula de nome definido não pode ser estendida: ${definedName.name}`);
  }
  pkg.updatePart(workbookPath, workbook.replace(match[0], `${match[1]}${updatedFormula}${match[3]}`));
}

function applyWritePlan(
  worksheet: string,
  input: ExportInput,
  mappings: readonly ResolvedMapping[],
  invalidRowIds: ReadonlySet<string>,
  options?: ExportBatchOptions,
): Promise<string> {
  const indexed = indexWorksheet(worksheet);
  const template = indexed.rows.get(input.destination.templateRow);
  if (!template) {
    throw new Error(`A linha de destino ${input.destination.templateRow} não foi encontrada após a expansão.`);
  }
  const processOperation = (operation: { destinationRow: number; values?: Record<string, CellValue> }) => {
    const row = indexed.rows.get(operation.destinationRow);
    if (!row) {
      throw new Error(`A linha de destino ${operation.destinationRow} não foi encontrada após a expansão.`);
    }
    for (const mapping of mappings) {
      const column = columnNumber(mapping.destinationColumn);
      const existing = row.cellsByColumn.get(column);
      const value = operation.values === undefined
        ? undefined
        : operation.values[mapping.sourceColumnId] ?? null;
      if (value === undefined && !existing) continue;
      row.updates.set(
        column,
        cellXml(
          `${mapping.destinationColumn}${operation.destinationRow}`,
          value,
          existing?.xml ?? template.cellsByColumn.get(column)?.xml,
        ),
      );
    }
  };
  if (!options) {
    for (const clear of input.writePlan.clears) processOperation({ destinationRow: clear.destinationRow });
    for (const action of validWriteActions(input.writePlan, invalidRowIds)) {
      processOperation({ destinationRow: action.destinationRow, values: action.values });
    }
    return Promise.resolve(serializeIndexedWorksheet(worksheet, indexed));
  }
  return processExportWritePlan(input, invalidRowIds, options, processOperation)
    .then(() => serializeIndexedWorksheet(worksheet, indexed));
}

async function processExportWritePlan(
  input: ExportInput,
  invalidRowIds: ReadonlySet<string>,
  options: ExportBatchOptions,
  processRow: (row: { destinationRow: number; values?: Record<string, CellValue> }) => void,
): Promise<void> {
  const total = input.writePlan.clears.length
    + input.writePlan.inserts.length
    + input.writePlan.updates.length;
  let completed = 0;
  completed = await processExportRows(
    input.writePlan.clears,
    completed,
    total,
    options,
    (clear) => processRow({ destinationRow: clear.destinationRow }),
  );
  completed = await processExportRows(
    input.writePlan.inserts,
    completed,
    total,
    options,
    (action) => {
      if (!invalidRowIds.has(action.incomingRowId)) {
        processRow({ destinationRow: action.destinationRow, values: action.values });
      }
    },
  );
  await processExportRows(
    input.writePlan.updates,
    completed,
    total,
    options,
    (action) => {
      if (!invalidRowIds.has(action.incomingRowId)) {
        processRow({ destinationRow: action.destinationRow, values: action.values });
      }
    },
  );
}

async function processExportRows<T>(
  rows: readonly T[],
  initialCompleted: number,
  total: number,
  options: ExportBatchOptions,
  processRow: (row: T) => void,
): Promise<number> {
  let completed = initialCompleted;
  for (let start = 0; start < rows.length; start += options.batchSize) {
    const end = Math.min(rows.length, start + options.batchSize);
    for (let index = start; index < end; index += 1) processRow(rows[index]);
    completed += end - start;
    await options.onProgress({ completed, total, phase: 'write' });
  }
  return completed;
}

function indexWorksheet(worksheet: string): IndexedWorksheet {
  const sheetData = worksheet.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)?.[1];
  if (sheetData === undefined) {
    throw new Error('A planilha não possui o elemento sheetData.');
  }
  const rows = new Map<number, IndexedRow>();
  for (const match of sheetData.matchAll(worksheetRowPattern())) {
    const raw = match[0];
    const cells: IndexedCell[] = [];
    const cellsByColumn = new Map<number, IndexedCell>();
    for (const cellMatch of raw.matchAll(/<c\b[^>]*\/\>|<c\b[^>]*>[\s\S]*?<\/c>/g)) {
      const xml = cellMatch[0];
      const reference = attribute(xml, 'r');
      if (!reference || cellMatch.index === undefined) continue;
      const column = columnNumber(reference.replace(/\d+$/, ''));
      const cell = { column, start: cellMatch.index, end: cellMatch.index + xml.length, xml };
      cells.push(cell);
      cellsByColumn.set(column, cell);
    }
    rows.set(Number(match[1] ?? match[2]), { raw, cells, cellsByColumn, updates: new Map() });
  }
  return { sheetData, rows };
}

function serializeIndexedWorksheet(worksheet: string, indexed: IndexedWorksheet): string {
  const updatedSheetData = indexed.sheetData.replace(
    worksheetRowPattern(),
    (rowXml) => serializeIndexedRow(indexed.rows.get(Number(attribute(rowXml, 'r'))) ?? {
      raw: rowXml,
      cells: [],
      cellsByColumn: new Map(),
      updates: new Map(),
    }),
  );
  return worksheet.replace(indexed.sheetData, updatedSheetData);
}

function worksheetRowPattern(): RegExp {
  return /<row\b(?=[^>]*\br="(\d+)")[^>]*?\/>|<row\b(?=[^>]*\br="(\d+)")[^>]*?>[\s\S]*?<\/row>/g;
}

function serializeIndexedRow(row: IndexedRow): string {
  if (row.updates.size === 0) return row.raw;
  const source = row.raw.endsWith('/>') ? row.raw.replace(/\/>$/, '></row>') : row.raw;
  const additions = [...row.updates.entries()]
    .filter(([column]) => !row.cellsByColumn.has(column))
    .sort(([left], [right]) => left - right);
  let result = '';
  let cursor = 0;
  let additionIndex = 0;
  for (const cell of row.cells) {
    result += source.slice(cursor, cell.start);
    while (additionIndex < additions.length && additions[additionIndex][0] < cell.column) {
      result += additions[additionIndex][1];
      additionIndex += 1;
    }
    result += row.updates.get(cell.column) ?? source.slice(cell.start, cell.end);
    cursor = cell.end;
  }
  const tail = source.slice(cursor);
  const remaining = additions.slice(additionIndex).map(([, xml]) => xml).join('');
  const closingIndex = tail.lastIndexOf('</row>');
  result += closingIndex < 0
    ? tail
    : `${tail.slice(0, closingIndex)}${remaining}${tail.slice(closingIndex)}`;
  return result;
}

function assertExportBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize deve ser um número inteiro positivo.');
  }
}

function cellXml(reference: string, value: CellValue | undefined, model?: string | null): string {
  const preservedAttributes = model
    ? attributes(model).filter(({ name }) => name !== 'r' && name !== 't')
    : [];
  const attributesText = preservedAttributes
    .map(({ name, value: attributeValue }) => ` ${name}="${attributeValue}"`)
    .join('');
  const open = `<c r="${reference}"${attributesText}`;
  if (value === undefined || value === null) {
    return `${open}/>`;
  }
  if (typeof value === 'number') {
    return `${open}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `${open} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const preserveSpace = value.trim() === value ? '' : ' xml:space="preserve"';
  return `${open} t="inlineStr"><is><t${preserveSpace}>${escapeXml(value)}</t></is></c>`;
}

function validWriteActions(
  plan: WritePlan,
  invalidRowIds: ReadonlySet<string>,
): WriteAction[] {
  return [...plan.inserts, ...plan.updates].filter(
    ({ incomingRowId }) => !invalidRowIds.has(incomingRowId),
  );
}

function targetCells(
  plan: WritePlan,
  mappings: readonly ResolvedMapping[],
  invalidRowIds: ReadonlySet<string>,
): Array<{ column: number; row: number }> {
  const rows = [
    ...plan.clears.map(({ destinationRow }) => destinationRow),
    ...validWriteActions(plan, invalidRowIds).map(({ destinationRow }) => destinationRow),
  ];
  return rows.flatMap((row) => mappings.map(({ destinationColumn }) => ({
    column: columnNumber(destinationColumn),
    row,
  })));
}

function resolveMappings(input: ExportInput): ResolvedMapping[] {
  return input.mappings.flatMap((mapping) => {
    if (mapping.status !== 'accepted' || mapping.destinationColumnId === null) {
      return [];
    }
    const destination = input.destination.columns.find(
      ({ id }) => id === mapping.destinationColumnId,
    );
    return destination ? [{
      sourceColumnId: mapping.sourceColumnId,
      destinationColumn: destination.column.toUpperCase(),
    }] : [];
  });
}

function findRow(worksheet: string, rowNumber: number): string | null {
  const rows = worksheet.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) ?? [];
  return rows.find((row) => Number(attribute(row, 'r')) === rowNumber) ?? null;
}

function findCell(row: string, reference: string): string | null {
  const cells = row.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? [];
  return cells.find((cell) => attribute(cell, 'r')?.toUpperCase() === reference.toUpperCase()) ?? null;
}

function attributes(xml: string): Array<{ name: string; value: string }> {
  const openingTag = xml.match(/^<c\b([^>]*)/)?.[1] ?? '';
  return [...openingTag.matchAll(/([\w:.-]+)="([^"]*)"/g)]
    .map((match) => ({ name: match[1], value: match[2] }));
}

function attribute(xml: string, name: string): string | null {
  return xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

function safeParseRanges(value: string): CellRange[] {
  try {
    return [parseRange(value)];
  } catch {
    return [];
  }
}

function parseRange(value: string): CellRange {
  const match = value.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (!match) {
    throw new Error(`Intervalo A1 inválido: ${value}`);
  }
  return {
    startColumn: columnNumber(match[1]),
    startRow: Number(match[2]),
    endColumn: columnNumber(match[3] ?? match[1]),
    endRow: Number(match[4] ?? match[2]),
  };
}

function normalizeRange(value: string): string {
  const range = parseRange(value);
  return `${columnName(range.startColumn)}${range.startRow}:${columnName(range.endColumn)}${range.endRow}`;
}

function rangesOverlap(left: CellRange, right: CellRange): boolean {
  return left.startColumn <= right.endColumn
    && left.endColumn >= right.startColumn
    && left.startRow <= right.endRow
    && left.endRow >= right.startRow;
}

function containsCell(range: CellRange, cell: { column: number; row: number }): boolean {
  return cell.column >= range.startColumn
    && cell.column <= range.endColumn
    && cell.row >= range.startRow
    && cell.row <= range.endRow;
}

function requireSheet(sheets: readonly WorksheetIndex[], name: string): WorksheetIndex {
  const sheet = sheets.find((candidate) => candidate.name === name);
  if (!sheet) {
    throw new Error(`Aba de destino não encontrada: ${name}`);
  }
  return sheet;
}

function relationshipPartPath(sourcePath: string): string {
  const separator = sourcePath.lastIndexOf('/');
  const directory = separator < 0 ? '' : sourcePath.slice(0, separator);
  const basename = sourcePath.slice(separator + 1);
  return `${directory}/_rels/${basename}.rels`.replace(/^\//, '');
}

function columnNumber(letters: string): number {
  const normalized = letters.toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(normalized)) {
    throw new Error(`Coluna inválida: ${letters}`);
  }
  return [...normalized].reduce(
    (column, letter) => column * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function columnName(column: number): string {
  let value = column;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsForbiddenXmlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
      return true;
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function decode(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}
