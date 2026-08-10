export type MappingConfidence = 'exact' | 'high' | 'medium' | 'low';

export type MappingStatus = 'accepted' | 'review-required';

export interface MappingSuggestion {
  sourceColumnId: string;
  destinationColumnId: string | null;
  confidence: MappingConfidence;
  score: number;
  status: MappingStatus;
}
