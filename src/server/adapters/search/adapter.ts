import type { SearchRequest, NormalizedObservation, Surface } from "../../../contracts/search";

export interface SearchExecution {
  observation: NormalizedObservation;
  rawResponses: unknown[];
  retryable?: boolean;
  ambiguous?: boolean;
}

export interface SearchAdapter {
  readonly surface: Surface;
  search(request: SearchRequest): Promise<SearchExecution>;
}
