import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const sourceRoot = join(process.cwd(), 'src');
const limits = { cyclomatic: 10, cognitive: 15, nesting: 3, lines: 60, parameters: 5 };

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function isFunction(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return '<anonymous>';
}

function decisionWeight(node) {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node)
    || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isCatchClause(node)
    || ts.isCaseClause(node)) return 1;
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return 1;
  return 0;
}

function isNestingNode(node) {
  return ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isForStatement(node)
    || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node)
    || ts.isDoStatement(node) || ts.isCatchClause(node) || ts.isConditionalExpression(node);
}

function measureFunction(sourceFile, node) {
  const result = { cyclomatic: 1, cognitive: 0, nesting: 0 };

  function visit(current, nesting) {
    if (current !== node && isFunction(current)) return;
    const weight = decisionWeight(current);
    if (weight) {
      result.cyclomatic += weight;
      result.cognitive += 1 + nesting;
    }
    const childNesting = nesting + (isNestingNode(current) ? 1 : 0);
    result.nesting = Math.max(result.nesting, childNesting);
    ts.forEachChild(current, (child) => visit(child, childNesting));
  }

  ts.forEachChild(node, (child) => visit(child, 0));
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const end = sourceFile.getLineAndCharacterOfPosition(node.end).line;
  return {
    ...result,
    lines: end - start + 1,
    parameters: node.parameters?.length ?? 0,
    name: functionName(node),
  };
}

function collectFunctions(sourceFile) {
  const functions = [];
  function visit(node) {
    if (isFunction(node)) functions.push(measureFunction(sourceFile, node));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return functions;
}

const measurements = sourceFiles(sourceRoot).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  return collectFunctions(sourceFile).map((measurement) => ({
    ...measurement,
    file: relative(process.cwd(), file),
  }));
});

const maximum = (key) => measurements.reduce((current, item) => item[key] > current[key] ? item : current, measurements[0]);
const cyclomatic = maximum('cyclomatic');
const cognitive = maximum('cognitive');
const nesting = maximum('nesting');
const lines = maximum('lines');
const parameters = maximum('parameters');
const failures = [
  cyclomatic.cyclomatic > limits.cyclomatic && `cyclomatic ${cyclomatic.cyclomatic} em ${cyclomatic.file}:${cyclomatic.name}`,
  cognitive.cognitive > limits.cognitive && `cognitive ${cognitive.cognitive} em ${cognitive.file}:${cognitive.name}`,
  nesting.nesting > limits.nesting && `nesting ${nesting.nesting} em ${nesting.file}:${nesting.name}`,
  lines.lines > limits.lines && `lines ${lines.lines} em ${lines.file}:${lines.name}`,
  parameters.parameters > limits.parameters && `parameters ${parameters.parameters} em ${parameters.file}:${parameters.name}`,
].filter(Boolean);

console.log(`EQC_CYCLOMATIC_MAX=${cyclomatic.cyclomatic} (${cyclomatic.file}:${cyclomatic.name})`);
console.log(`EQC_COGNITIVE_MAX=${cognitive.cognitive} (${cognitive.file}:${cognitive.name})`);
console.log(`EQC_NESTING_MAX=${nesting.nesting} (${nesting.file}:${nesting.name})`);
console.log(`EQC_FUNCTION_MAX_LINES=${lines.lines} (${lines.file}:${lines.name})`);
console.log(`EQC_MAX_PARAMETERS=${parameters.parameters} (${parameters.file}:${parameters.name})`);
if (failures.length) {
  failures.forEach((failure) => console.error(`EQC_COMPLEXITY_FAILURE=${failure}`));
  console.log('EQC_COMPLEXITY=FAIL');
  process.exitCode = 1;
} else {
  console.log('EQC_COMPLEXITY=PASS');
}
