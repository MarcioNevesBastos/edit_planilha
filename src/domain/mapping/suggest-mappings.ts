import type { DatasetColumn } from '../dataset/types';
import { normalizeText } from '../../utils/text-normalize';
import type { MappingConfidence, MappingSuggestion } from './types';

const MINIMUM_SUGGESTION_SCORE = 0.55;

function jaroWinkler(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const matchDistance = Math.max(Math.floor(Math.max(left.length, right.length) / 2) - 1, 0);
  const leftMatches = new Array<boolean>(left.length).fill(false);
  const rightMatches = new Array<boolean>(right.length).fill(false);
  let matches = 0;

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const start = Math.max(0, leftIndex - matchDistance);
    const end = Math.min(leftIndex + matchDistance + 1, right.length);
    for (let rightIndex = start; rightIndex < end; rightIndex += 1) {
      if (!rightMatches[rightIndex] && left[leftIndex] === right[rightIndex]) {
        leftMatches[leftIndex] = true;
        rightMatches[rightIndex] = true;
        matches += 1;
        break;
      }
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let rightIndex = 0;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    if (!leftMatches[leftIndex]) continue;
    while (!rightMatches[rightIndex]) rightIndex += 1;
    if (left[leftIndex] !== right[rightIndex]) transpositions += 1;
    rightIndex += 1;
  }

  const jaro = (matches / left.length + matches / right.length + (matches - transpositions / 2) / matches) / 3;
  let prefixLength = 0;
  while (prefixLength < 4 && left[prefixLength] === right[prefixLength]) prefixLength += 1;
  return jaro + prefixLength * 0.1 * (1 - jaro);
}

function tokenScore(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return leftTokens.size + rightTokens.size === 0 ? 0 : (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function similarity(left: string, right: string): number {
  return Number((0.65 * jaroWinkler(left, right) + 0.35 * tokenScore(left, right)).toFixed(4));
}

function confidenceFor(score: number): MappingConfidence {
  if (score === 1) return 'exact';
  if (score >= 0.85) return 'high';
  if (score >= MINIMUM_SUGGESTION_SCORE) return 'medium';
  return 'low';
}

export function suggestMappings(
  sourceColumns: readonly DatasetColumn[],
  destinationColumns: readonly DatasetColumn[],
): MappingSuggestion[] {
  const sourceHeaderCounts = new Map<string, number>();
  for (const sourceColumn of sourceColumns) {
    const normalizedHeader = normalizeText(sourceColumn.header);
    sourceHeaderCounts.set(normalizedHeader, (sourceHeaderCounts.get(normalizedHeader) ?? 0) + 1);
  }

  return sourceColumns.map((sourceColumn) => {
    const normalizedSource = normalizeText(sourceColumn.header);
    if (normalizedSource === '') {
      return {
        sourceColumnId: sourceColumn.id,
        destinationColumnId: null,
        confidence: 'low',
        score: 0,
        status: 'review-required',
      };
    }

    const candidates = destinationColumns.map((destinationColumn, index) => ({
      destinationColumn,
      index,
      normalizedHeader: normalizeText(destinationColumn.header),
    }));
    const exactCandidates = sourceHeaderCounts.get(normalizedSource) !== 1
      ? []
      : candidates.filter((candidate) => candidate.normalizedHeader === normalizedSource);
    const exact = exactCandidates.length === 1 ? exactCandidates[0] : undefined;

    if (exact) {
      return {
        sourceColumnId: sourceColumn.id,
        destinationColumnId: exact.destinationColumn.id,
        confidence: 'exact',
        score: 1,
        status: 'review-required',
      };
    }

    const best = candidates
      .map((candidate) => ({ ...candidate, score: similarity(normalizedSource, candidate.normalizedHeader) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0];

    if (!best || best.score < MINIMUM_SUGGESTION_SCORE) {
      return {
        sourceColumnId: sourceColumn.id,
        destinationColumnId: null,
        confidence: 'low',
        score: 0,
        status: 'review-required',
      };
    }

    return {
      sourceColumnId: sourceColumn.id,
      destinationColumnId: best.destinationColumn.id,
      confidence: confidenceFor(best.score),
      score: best.score,
      status: 'review-required',
    };
  });
}
